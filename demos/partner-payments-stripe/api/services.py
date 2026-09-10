import os
import time
import uuid
import hashlib
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import stripe
from itsdangerous import BadSignature, URLSafeTimedSerializer


MAX_BODY_BYTES = 16_384


class DemoError(Exception):
    pass


class OwnershipError(DemoError):
    pass


def _value(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


@dataclass(frozen=True)
class Settings:
    stripe_secret_key: str = os.getenv("STRIPE_SECRET_KEY", "")
    stripe_webhook_secret: str = os.getenv("STRIPE_WEBHOOK_SECRET", "")
    stripe_connect_webhook_secret: str = os.getenv("STRIPE_CONNECT_WEBHOOK_SECRET", "")
    partner_account_id: str = os.getenv("STRIPE_PARTNER_ACCOUNT_ID", "")
    app_url: str = os.getenv("APP_URL", "").rstrip("/")
    session_secret: str = os.getenv("DEMO_SESSION_SECRET", "")
    access_username: str = os.getenv("DEMO_ACCESS_USERNAME", "")
    access_password: str = os.getenv("DEMO_ACCESS_PASSWORD", "")

    @property
    def test_key(self) -> bool:
        return self.stripe_secret_key.startswith(("sk_test_", "rk_test_", "rkcs_test_"))

    @property
    def express_key(self) -> bool:
        # Claimable sandbox keys (rkcs_test_) cannot create or retrieve Connect accounts.
        return self.stripe_secret_key.startswith(("sk_test_", "rk_test_")) and not self.stripe_secret_key.startswith("rkcs_test_")

    @property
    def session_ready(self) -> bool:
        return len(self.session_secret) >= 32

    @property
    def access_ready(self) -> bool:
        return bool(self.app_url and len(self.session_secret) >= 32 and self.access_username and self.access_password)

    @property
    def configured(self) -> bool:
        return bool(self.test_key and self.stripe_webhook_secret and self.app_url and self.session_ready)

    @property
    def partner_ready(self) -> bool:
        # Account capabilities are verified by StripeGateway.verify_partner at runtime.
        return False

    @property
    def partner_configured(self) -> bool:
        return self.test_key and self.partner_account_id.startswith("acct_")

    @property
    def express_available(self) -> bool:
        return bool(self.express_key and self.app_url and self.session_ready)


class SessionStore:
    def __init__(self, secret: str):
        self.serializer = URLSafeTimedSerializer(secret, salt="partner-payments-demo")

    def issue(self, data: dict[str, Any] | None = None) -> tuple[str, dict[str, Any]]:
        payload = dict(data) if data is not None else {"id": str(uuid.uuid4()), "exp": int(time.time()) + 3600}
        return self.serializer.dumps(payload), payload

    def read(self, token: str | None) -> dict[str, Any]:
        if not token:
            raise OwnershipError("A demo session is required.")
        try:
            data = self.serializer.loads(token, max_age=3600)
        except BadSignature as exc:
            raise OwnershipError("Invalid demo session.") from exc
        account_id = data.get("partner_account_id") if isinstance(data, dict) else None
        if account_id is not None and (not isinstance(account_id, str) or not account_id.startswith("acct_")):
            raise OwnershipError("Invalid demo session.")
        if not isinstance(data, dict) or not isinstance(data.get("id"), str) or data.get("exp", 0) < time.time():
            raise OwnershipError("Expired demo session.")
        return data


AUTH_COOKIE = "partner_demo_auth"
AUTH_MAX_AGE = 8 * 60 * 60


def credential_fingerprint(username: str, password: str) -> str:
    return hashlib.sha256(f"{username}\0{password}".encode()).hexdigest()


class AccessStore:
    def __init__(self, secret: str):
        self.serializer = URLSafeTimedSerializer(secret, salt="partner-payments-demo-auth-v1")

    def issue(self, username: str, password: str) -> str:
        now = int(time.time())
        return self.serializer.dumps({"v": 1, "purpose": "demo-access", "fp": credential_fingerprint(username, password), "iat": now, "exp": now + AUTH_MAX_AGE})

    def read(self, token: str | None, username: str, password: str) -> bool:
        if not token:
            return False
        try:
            data = self.serializer.loads(token, max_age=AUTH_MAX_AGE)
        except BadSignature:
            return False
        return isinstance(data, dict) and data.get("v") == 1 and data.get("purpose") == "demo-access" and data.get("exp", 0) >= time.time() and hmac_compare(data.get("fp"), credential_fingerprint(username, password))


def hmac_compare(left: Any, right: str) -> bool:
    import hmac
    if not isinstance(left, str) or not isinstance(right, str):
        return False
    try:
        return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))
    except UnicodeEncodeError:
        return False


class StripeGateway:
    """Small boundary around Stripe; Stripe remains the financial source of truth."""
    def __init__(self, key: str):
        self.client = stripe.StripeClient(key)

    def create_checkout(self, params: dict[str, Any], idempotency_key: str):
        return self.client.checkout.sessions.create(params=params, options={"idempotency_key": idempotency_key})

    def verify_partner(self, account_id: str) -> bool:
        """Confirm that the configured Connect account can receive transfers."""
        account = self.client.accounts.retrieve(account_id)
        capabilities = _value(account, "capabilities", {}) or {}
        # Destination Charges are created on the platform. The destination only
        # needs the transfers capability; it can validly be transfers-only.
        return _value(capabilities, "transfers") == "active"

    def checkout(self, checkout_id: str):
        return self.client.checkout.sessions.retrieve(checkout_id)

    def payment_intent(self, payment_intent_id: str):
        return self.client.payment_intents.retrieve(
            payment_intent_id,
            params={"expand": ["latest_charge.balance_transaction", "latest_charge.transfer", "latest_charge.application_fee", "latest_charge.refunds"]},
        )

    def refund(self, payment_intent_id: str, amount: int, idempotency_key: str):
        return self.client.refunds.create(
            params={"payment_intent": payment_intent_id, "amount": amount, "reverse_transfer": True, "refund_application_fee": True},
            options={"idempotency_key": idempotency_key},
        )

    def mark_verified(self, payment_intent_id: str, event_id: str):
        return self.client.payment_intents.update(payment_intent_id, params={"metadata": {"demo_verified_event_id": event_id}})

    def create_express_account(self, demo_session_id: str):
        return self.client.accounts.create(
            params={
                "type": "express",
                "country": "ES",
                "capabilities": {"card_payments": {"requested": True}, "transfers": {"requested": True}},
                "metadata": {"demo_session_id": demo_session_id},
            },
            options={"idempotency_key": f"demo:{demo_session_id}:express"},
        )

    def retrieve_account(self, account_id: str):
        return self.client.accounts.retrieve(account_id)

    def create_account_link(self, account_id: str, refresh_url: str, return_url: str):
        return self.client.account_links.create(
            params={"account": account_id, "refresh_url": refresh_url, "return_url": return_url, "type": "account_onboarding"},
        )


def require_uuid(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError) as exc:
        raise DemoError("A UUID idempotency key is required.") from exc


def checkout_params(settings: Settings, demo_session_id: str, amount: int, fee_percent: int) -> dict[str, Any]:
    if not settings.configured or not settings.partner_account_id.startswith("acct_"):
        raise DemoError("Demo payment configuration is unavailable.")
    if type(amount) is not int or not 100 <= amount <= 50_000:
        raise DemoError("Amount must be between EUR 1 and EUR 500.")
    if type(fee_percent) is not int or not 0 <= fee_percent <= 30:
        raise DemoError("Fee must be a whole percentage from 0 to 30.")
    # Round half-up to cents; this is the same rule displayed by the demo UI.
    fee = (amount * fee_percent + 50) // 100
    return {
        "mode": "payment",
        "success_url": f"{settings.app_url}/?session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{settings.app_url}/?cancelled=1",
        "line_items": [{"price_data": {"currency": "eur", "product_data": {"name": "Partner payment demo"}, "unit_amount": amount}, "quantity": 1}],
        "payment_intent_data": {"application_fee_amount": fee, "transfer_data": {"destination": settings.partner_account_id}, "metadata": {"demo_session_id": demo_session_id}},
        "metadata": {"demo_session_id": demo_session_id},
    }


def assert_owned_account(account: Any, demo_session_id: str) -> None:
    metadata = _value(account, "metadata", {}) or {}
    if _value(metadata, "demo_session_id") != demo_session_id:
        raise OwnershipError("That Connect account does not belong to this demo session.")


def hosted_onboarding_url(url: str) -> str:
    if not isinstance(url, str):
        raise DemoError("Stripe onboarding is unavailable.")
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not (host == "connect.stripe.com" or host.endswith(".connect.stripe.com")):
        raise DemoError("Stripe onboarding is unavailable.")
    return url


def partner_dto(account: Any) -> dict[str, Any]:
    capabilities = _value(account, "capabilities", {}) or {}
    transfers_active = _value(capabilities, "transfers") == "active"
    requirements = _value(account, "requirements", {}) or {}
    currently_due = _value(requirements, "currently_due") or []
    past_due = _value(requirements, "past_due") or []
    due_items = {item for item in list(currently_due) + list(past_due) if isinstance(item, str)}
    disabled_reason = _value(requirements, "disabled_reason")
    details_submitted = _value(account, "details_submitted") is True
    if transfers_active:
        status = "ready"
    elif disabled_reason:
        status = "restricted"
    elif due_items or not details_submitted:
        status = "incomplete"
    else:
        status = "pending"
    return {
        "id": _value(account, "id"),
        "type": _value(account, "type") or "express",
        "status": status,
        "transfers_active": transfers_active,
        "payouts_enabled": _value(account, "payouts_enabled") is True,
        "details_submitted": details_submitted,
        "requirements_due": len(due_items),
    }


def verify_signed_event(payload: bytes, signature: str | None, settings: Settings):
    secrets = [secret for secret in (settings.stripe_webhook_secret, settings.stripe_connect_webhook_secret) if secret]
    last_error: Exception | None = None
    for secret in secrets:
        try:
            return stripe.Webhook.construct_event(payload, signature, secret, tolerance=300)
        except (ValueError, stripe.SignatureVerificationError) as exc:
            last_error = exc
    if last_error is not None:
        raise last_error
    raise stripe.SignatureVerificationError("Invalid webhook signature.", signature)


def belongs_to(checkout: Any, demo_session_id: str) -> None:
    metadata = _value(checkout, "metadata", {}) or {}
    if _value(metadata, "demo_session_id") != demo_session_id:
        raise OwnershipError("That checkout does not belong to this demo session.")


def payment_dto(checkout: Any, intent: Any) -> dict[str, Any]:
    charge = _value(intent, "latest_charge", {}) or {}
    fee = _value(charge, "application_fee", {}) or {}
    transfer = _value(charge, "transfer", {}) or {}
    balance_transaction = _value(charge, "balance_transaction", {}) or {}
    gross = _value(transfer, "amount")
    reversed_cents = _value(transfer, "amount_reversed")
    fee_cents = _value(fee, "amount")
    fee_refunded_cents = _value(fee, "amount_refunded")
    partner_pending_cents = None
    platform_net_cents = None
    if all(type(value) is int for value in (gross, reversed_cents, fee_cents, fee_refunded_cents)):
        partner_pending_cents = gross - reversed_cents - (fee_cents - fee_refunded_cents)
    stripe_fee_cents = _value(balance_transaction, "fee")
    if all(type(value) is int for value in (fee_cents, fee_refunded_cents, stripe_fee_cents)):
        platform_net_cents = fee_cents - fee_refunded_cents - stripe_fee_cents
    return {
        "checkout_session_id": _value(checkout, "id"),
        "payment_intent_id": _value(intent, "id"),
        "currency": "eur",
        "amount_cents": _value(intent, "amount"),
        "status": "refunded" if _value(charge, "refunded") is True else _value(intent, "status"),
        # Stripe charge aggregates remain exact even when refunds.data is paginated.
        "refunded_cents": _value(charge, "amount_refunded"),
        "transfer_gross_cents": gross,
        "transfer_reversed_cents": reversed_cents,
        "application_fee_cents": fee_cents,
        "application_fee_refunded_cents": fee_refunded_cents,
        "partner_pending_cents": partner_pending_cents,
        "stripe_fee_cents": stripe_fee_cents,
        "platform_net_cents": platform_net_cents,
        "stripe_balance_status": _value(balance_transaction, "status", "not_queried") if balance_transaction else "not_queried",
        "verified_webhook_event_id": _value(_value(intent, "metadata", {}) or {}, "demo_verified_event_id"),
    }
