import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))
from api import index  # noqa: E402
from api.services import Settings, StripeGateway, checkout_params, payment_dto  # noqa: E402


def config(**overrides):
    values = dict(stripe_secret_key="sk_test_example", stripe_webhook_secret="whsec_test", partner_account_id="acct_partner", app_url="https://demo.example", session_secret="x" * 32)
    values.update(overrides)
    return Settings(**values)


class FakeStripe:
    def __init__(self):
        self.checkout_params = None
        self.checkout_key = None
        self.refund_args = None
        self.owned = {"id": "cs_test_owned", "payment_intent": "pi_test_1", "metadata": {"demo_session_id": "owner"}}

    def create_checkout(self, params, idempotency_key):
        self.checkout_params, self.checkout_key = params, idempotency_key
        return {"id": "cs_test_created", "url": "https://checkout.stripe.test/created"}

    def verify_partner(self, _):
        return True

    def checkout(self, checkout_id):
        return self.owned if checkout_id == "cs_test_owned" else {"id": checkout_id, "payment_intent": "pi_other", "metadata": {"demo_session_id": "someone-else"}}

    def refund(self, payment_intent_id, amount, idempotency_key):
        self.refund_args = (payment_intent_id, amount, idempotency_key)
        return {"id": "re_test", "amount": amount, "status": "succeeded"}

    def payment_intent(self, _):
        return {"id": "pi_test_1", "amount": 1200, "status": "succeeded", "metadata": {}, "latest_charge": {"refunds": {"data": []}, "application_fee": {"amount": 120}, "transfer": {"amount": 1080}}}

    def mark_verified(self, *args):
        self.verified = args


@pytest.fixture
def client(monkeypatch):
    fake = FakeStripe()
    monkeypatch.setattr(index, "settings", lambda: config())
    monkeypatch.setattr(index, "gateway", lambda _: fake)
    return TestClient(index.app), fake


def session_cookie(client):
    browser, _ = client
    response = browser.post("/api/session", json={}, headers={"Origin": "https://demo.example"})
    assert response.status_code == 200
    # Make the signed cookie represent the checkout owner, without weakening the endpoint test.
    token = index.SessionStore(config().session_secret).serializer.dumps({"id": "owner", "exp": 4_000_000_000})
    browser.cookies.set("partner_demo_session", token)
    return browser


def test_live_key_is_never_configured(monkeypatch):
    monkeypatch.setattr(index, "settings", lambda: config(stripe_secret_key="sk_live_nope"))
    response = TestClient(index.app).get("/api/config")
    assert response.json() == {"configured": False, "test_only": False, "partner_configured": False, "partner_ready": None, "partner_checked": False, "express_available": False, "currency": "eur"}
    assert "sk_live" not in response.text


def test_checkout_uses_destination_charge_and_session_scoped_idempotency(client):
    browser = session_cookie(client)
    response = browser.post("/api/checkout", json={"amount_cents": 1200, "fee_percent": 10, "idempotency_key": "17e23e6d-edc9-4e81-a957-80a617d9112d"}, headers={"Origin": "https://demo.example"})
    assert response.status_code == 200
    fake = client[1]
    assert fake.checkout_params["payment_intent_data"]["transfer_data"] == {"destination": "acct_partner"}
    assert fake.checkout_params["payment_intent_data"]["application_fee_amount"] == 120
    assert fake.checkout_params["metadata"] == {"demo_session_id": "owner"}
    assert fake.checkout_key == "demo:owner:17e23e6d-edc9-4e81-a957-80a617d9112d"
    assert "Stripe-Account" not in str(fake.checkout_params)
    repeat = browser.post("/api/checkout", json={"amount_cents": 1200, "fee_percent": 10, "idempotency_key": "17e23e6d-edc9-4e81-a957-80a617d9112d"}, headers={"Origin": "https://demo.example"})
    assert repeat.status_code == 200
    assert fake.checkout_key == "demo:owner:17e23e6d-edc9-4e81-a957-80a617d9112d"


def test_payment_and_refund_enforce_cookie_ownership(client):
    browser = session_cookie(client)
    denied = browser.get("/api/payment?session_id=cs_test_other")
    assert denied.status_code == 403
    refunded = browser.post("/api/refund", json={"checkout_session_id": "cs_test_owned", "amount_cents": 200, "idempotency_key": "5d4ed25d-cd72-4b15-ae8a-cd9b275e9ff6"}, headers={"Origin": "https://demo.example"})
    assert refunded.status_code == 200
    assert client[1].refund_args == ("pi_test_1", 200, "demo:owner:5d4ed25d-cd72-4b15-ae8a-cd9b275e9ff6")


def test_webhook_rejects_bad_signature_and_marks_signed_test_event(client, monkeypatch):
    browser, fake = client
    invalid = browser.post("/api/webhook", content=b"{}", headers={"stripe-signature": "bad"})
    assert invalid.status_code == 400
    monkeypatch.setattr(index.stripe.Webhook, "construct_event", lambda *args, **kwargs: {"id": "evt_test", "livemode": False, "type": "payment_intent.succeeded", "data": {"object": {"id": "pi_test_1", "metadata": {"demo_session_id": "owner"}}}})
    accepted = browser.post("/api/webhook", content=b"signed", headers={"stripe-signature": "valid"})
    assert accepted.status_code == 200
    assert fake.verified == ("pi_test_1", "evt_test")


def test_payment_dto_uses_charge_refunded_total_and_correct_destination_amounts():
    dto = payment_dto({"id": "cs_test_owned"}, {"id": "pi_test_1", "amount": 1000, "status": "succeeded", "metadata": {}, "latest_charge": {"amount_refunded": 600, "refunds": {"data": [{"amount": 100}]}, "transfer": {"amount": 1000, "amount_reversed": 600}, "application_fee": {"amount": 125, "amount_refunded": 75}, "balance_transaction": {"fee": 44, "status": "pending"}}})
    assert dto["refunded_cents"] == 600
    assert dto["transfer_gross_cents"] == 1000
    assert dto["partner_pending_cents"] == 350
    assert dto["platform_net_cents"] == 6
    assert dto["stripe_balance_status"] == "pending"


def test_checkout_fee_rounds_half_up_and_validates_bounds():
    params = checkout_params(config(), "owner", 105, 10)
    assert params["payment_intent_data"]["application_fee_amount"] == 11
    with pytest.raises(Exception):
        checkout_params(config(), "owner", 99, 10)
    with pytest.raises(Exception):
        checkout_params(config(), "owner", 100, 31)


def test_destination_partner_can_be_transfers_only():
    class Accounts:
        def __init__(self, response): self.response = response
        def retrieve(self, _): return self.response
    class V1:
        def __init__(self, response): self.accounts = Accounts(response)
    class Client:
        def __init__(self, response): self.accounts = Accounts(response)
    gateway = StripeGateway("sk_test_example")
    gateway.client = Client({"charges_enabled": False, "capabilities": {"transfers": "active"}})
    assert gateway.verify_partner("acct_partner") is True
    gateway.client = Client({"charges_enabled": True, "capabilities": {"transfers": "inactive"}})
    assert gateway.verify_partner("acct_partner") is False


def test_installed_stripe_sdk_exposes_gateway_resources():
    gateway = StripeGateway("sk_test_example")
    assert callable(gateway.client.accounts.retrieve)
    assert callable(gateway.client.accounts.create)
    assert callable(gateway.client.account_links.create)
    assert callable(gateway.client.checkout.sessions.create)
    assert callable(gateway.client.payment_intents.retrieve)
    assert callable(gateway.client.payment_intents.update)
    assert callable(gateway.client.refunds.create)


def test_fully_refunded_payment_has_refunded_display_status():
    dto = payment_dto({}, {"amount": 10000, "status": "succeeded", "latest_charge": {"refunded": True, "amount_refunded": 10000}})
    assert dto["status"] == "refunded"
    assert dto["refunded_cents"] == 10000
