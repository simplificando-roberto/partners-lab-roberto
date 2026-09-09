import os
import time
import uuid
from dataclasses import dataclass
from typing import Any

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
    partner_account_id: str = os.getenv("STRIPE_PARTNER_ACCOUNT_ID", "")
    app_url: str = os.getenv("APP_URL", "").rstrip("/")
    session_secret: str = os.getenv("DEMO_SESSION_SECRET", "")

    @property
    def test_key(self) -> bool:
        return self.stripe_secret_key.startswith(("sk_test_", "rk_test_", "rkcs_test_"))

    @property
    def session_ready(self) -> bool:
        return len(self.session_secret) >= 32

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


class SessionStore:
    def __init__(self, secret: str):
        self.serializer = URLSafeTimedSerializer(secret, salt="partner-payments-demo")

    def issue(self) -> tuple[str, dict[str, Any]]:
        data = {"id": str(uuid.uuid4()), "exp": int(time.time()) + 3600}
        return self.serializer.dumps(data), data

    def read(self, token: str | None) -> dict[str, Any]:
        if not token:
            raise OwnershipError("A demo session is required.")
        try:
            data = self.serializer.loads(token, max_age=3600)
        except BadSignature as exc:
            raise OwnershipError("Invalid demo session.") from exc
        if not isinstance(data, dict) or not isinstance(data.get("id"), str) or data.get("exp", 0) < time.time():
            raise OwnershipError("Expired demo session.")
        return data


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


def require_uuid(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError) as exc:
        raise DemoError("A UUID idempotency key is required.") from exc


def checkout_params(settings: Settings, demo_session_id: str, amount: int, fee_percent: int) -> dict[str, Any]:
    if not settings.configured or not settings.partner_configured:
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
