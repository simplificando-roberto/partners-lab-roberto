import hashlib
import hmac
import json
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))
from api import index  # noqa: E402
from api.services import StripeGateway, hosted_onboarding_url, partner_dto  # noqa: E402
from test_api import config, session_cookie

ORIGIN = {"Origin": "https://demo.example"}
CHECKOUT = {"amount_cents": 1200, "fee_percent": 10, "idempotency_key": "17e23e6d-edc9-4e81-a957-80a617d9112d"}


def account_payload(session_id="owner", transfers="active", payouts=False, details=True, due=None, disabled=None, account_id="acct_express"):
    return {
        "id": account_id,
        "type": "express",
        "metadata": {"demo_session_id": session_id},
        "capabilities": {"transfers": transfers, "card_payments": "active"},
        "payouts_enabled": payouts,
        "details_submitted": details,
        "requirements": {"currently_due": due or [], "past_due": [], "disabled_reason": disabled},
    }


class ExpressFake:
    def __init__(self, account=None):
        self.account = account or account_payload()
        self.accounts = {self.account["id"]: self.account, "acct_other": account_payload("someone-else", account_id="acct_other")}
        self.account_creates = []
        self.account_links = []
        self.checkout_params = None
        self.checkout_key = None
        self.refund_args = None
        self.verified = None
        self.link_n = 0
        self.account_retrieves = []
        self.owned = {"id": "cs_test_owned", "payment_intent": "pi_test_1", "metadata": {"demo_session_id": "owner"}}

    def create_express_account(self, demo_session_id):
        self.account_creates.append(f"demo:{demo_session_id}:express")
        created = dict(self.account)
        created["metadata"] = {"demo_session_id": demo_session_id}
        self.accounts[created["id"]] = created
        self.account = created
        return created

    def retrieve_account(self, account_id):
        self.account_retrieves.append(account_id)
        return self.accounts[account_id]

    def create_account_link(self, account_id, refresh_url, return_url):
        self.link_n += 1
        link = {
            "account": account_id,
            "refresh_url": refresh_url,
            "return_url": return_url,
            "url": f"https://connect.stripe.com/setup/s/{self.link_n}",
        }
        self.account_links.append(link)
        return link

    def create_checkout(self, params, idempotency_key):
        self.checkout_params, self.checkout_key = params, idempotency_key
        return {"id": "cs_test_created", "url": "https://checkout.stripe.com/c/pay/cs_test_created"}

    def verify_partner(self, account_id):
        self.verified_partner = account_id
        return True

    def checkout(self, checkout_id):
        return self.owned if checkout_id == "cs_test_owned" else {"id": checkout_id, "metadata": {"demo_session_id": "someone-else"}}

    def refund(self, *args):
        self.refund_args = args
        return {"id": "re_test", "amount": args[1], "status": "succeeded"}

    def payment_intent(self, _):
        return {"id": "pi_test_1", "amount": 1200, "status": "succeeded", "metadata": {}, "latest_charge": {}}

    def mark_verified(self, *args):
        self.verified = args


@pytest.fixture
def express_client(monkeypatch):
    fake = ExpressFake()
    monkeypatch.setattr(index, "settings", lambda: config())
    monkeypatch.setattr(index, "gateway", lambda _: fake)
    return TestClient(index.app, base_url="https://testserver"), fake


def signed_cookie(browser, session_id="owner", account_id=None):
    payload = {"id": session_id, "exp": 4_000_000_000}
    if account_id:
        payload["partner_account_id"] = account_id
    token = index.SessionStore(config().session_secret).serializer.dumps(payload)
    browser.cookies.set("partner_demo_session", token)
    return browser


def test_claimable_key_blocks_onboarding_and_keeps_full_test_keys_available(express_client, monkeypatch):
    browser, fake = express_client
    assert config(stripe_secret_key="sk_test_example").express_available is True
    assert config(stripe_secret_key="rk_test_restricted").express_available is True
    assert config(stripe_secret_key="rkcs_test_claimable").express_available is False
    assert config(stripe_secret_key="rkcs_test_claimable").test_key is True
    assert config(stripe_secret_key="rkcs_test_claimable").partner_configured is True
    assert config(stripe_secret_key="sk_live_nope").express_available is False
    monkeypatch.setattr(index, "settings", lambda: config(stripe_secret_key="rkcs_test_claimable"))
    body = browser.get("/api/config").json()
    assert body["express_available"] is False
    assert body["configured"] is True
    assert body["partner_configured"] is True
    assert "rkcs" not in str(body).lower()
    assert "sk_test" not in str(body).lower()
    signed_cookie(browser, account_id="acct_express")
    assert browser.get("/api/partner").status_code == 200
    assert browser.get("/api/partner").json() == {"account": None}
    assert fake.account_retrieves == []
    assert browser.post("/api/partner/onboarding", json={}, headers=ORIGIN).status_code == 503
    assert fake.account_creates == []
    assert fake.account_links == []


def test_config_reports_express_without_custom_partner(monkeypatch):
    monkeypatch.setattr(index, "settings", lambda: config(partner_account_id=""))
    body = TestClient(index.app).get("/api/config").json()
    assert body["partner_configured"] is False
    assert body["express_available"] is True
    assert body["configured"] is True


def test_session_reuses_valid_cookie_and_keeps_partner(express_client):
    browser, _ = express_client
    signed_cookie(browser, account_id="acct_express")
    first = browser.post("/api/session", json={}, headers=ORIGIN)
    second = browser.post("/api/session", json={}, headers=ORIGIN)
    assert first.status_code == 200
    assert second.json()["expires_at"] == first.json()["expires_at"] == 4_000_000_000
    assert browser.get("/api/partner").json()["account"]["id"] == "acct_express"


def test_onboarding_is_deterministic_and_resumes_new_link(express_client):
    browser, fake = express_client
    session_cookie((browser, fake))
    first = browser.post("/api/partner/onboarding", json={"destination": "acct_evil"}, headers=ORIGIN)
    second = browser.post("/api/partner/onboarding", json={}, headers=ORIGIN)
    assert first.status_code == 200
    assert second.status_code == 200
    assert fake.account_creates == ["demo:owner:express", "demo:owner:express"]
    assert first.json()["account"]["id"] == second.json()["account"]["id"] == "acct_express"
    assert first.json()["url"] != second.json()["url"]
    assert all(item["url"].startswith("https://connect.stripe.com/") for item in fake.account_links)
    assert fake.account_links[0]["return_url"] == "https://demo.example/?partner_return=1"
    assert fake.account_links[0]["refresh_url"] == "https://demo.example/?partner_refresh=1"
    signed_cookie(browser, account_id="acct_express")
    fake.account_creates.clear()
    resumed = browser.post("/api/partner/onboarding", json={}, headers=ORIGIN)
    assert resumed.status_code == 200
    assert fake.account_creates == []
    assert resumed.json()["url"].startswith("https://connect.stripe.com/")


def test_onboarding_rejects_live_key_and_csrf(express_client, monkeypatch):
    browser, fake = express_client
    session_cookie((browser, fake))
    monkeypatch.setattr(index, "settings", lambda: config(stripe_secret_key="sk_live_nope"))
    assert browser.post("/api/partner/onboarding", json={}, headers=ORIGIN).status_code == 503
    monkeypatch.setattr(index, "settings", lambda: config())
    assert browser.post("/api/partner/onboarding", json={}, headers={"Origin": "https://attacker.example"}).status_code == 403
    assert browser.post("/api/partner/onboarding", json={}).status_code == 403
    assert fake.account_creates == []


def test_tampered_or_cross_session_cookie_cannot_use_another_account(express_client):
    browser, fake = express_client
    signed_cookie(browser, session_id="intruder", account_id="acct_express")
    assert browser.get("/api/partner").status_code == 403
    assert browser.post("/api/partner/onboarding", json={}, headers=ORIGIN).status_code == 403
    signed_cookie(browser, session_id="owner", account_id="acct_other")
    assert browser.get("/api/partner").status_code == 403
    assert browser.post("/api/checkout", json=CHECKOUT, headers=ORIGIN).status_code == 403
    assert fake.checkout_params is None


def test_incomplete_express_blocks_checkout_without_custom_fallback(express_client):
    browser, fake = express_client
    fake.account = account_payload(transfers="inactive", details=False, due=["external_account"])
    fake.accounts["acct_express"] = fake.account
    signed_cookie(browser, account_id="acct_express")
    blocked = browser.post("/api/checkout", json=CHECKOUT, headers=ORIGIN)
    assert blocked.status_code == 409
    assert fake.checkout_params is None
    assert not hasattr(fake, "verified_partner")


def test_ready_status_ignores_payouts_and_uses_express_destination(express_client):
    browser, fake = express_client
    fake.account = account_payload(transfers="active", payouts=False, details=True)
    fake.accounts["acct_express"] = fake.account
    signed_cookie(browser, account_id="acct_express")
    dto = browser.get("/api/partner").json()["account"]
    assert dto["status"] == "ready"
    assert dto["transfers_active"] is True
    assert dto["payouts_enabled"] is False
    paid = browser.post("/api/checkout", json=CHECKOUT, headers=ORIGIN)
    assert paid.status_code == 200
    assert fake.checkout_params["payment_intent_data"]["transfer_data"] == {"destination": "acct_express"}


def test_restricted_account_is_not_ready(express_client):
    dto = partner_dto(account_payload(transfers="inactive", details=True, disabled="rejected.other"))
    assert dto["status"] == "restricted"
    assert dto["transfers_active"] is False


def test_gateway_express_params_are_stable(monkeypatch):
    captured = {}

    class Accounts:
        def create(self, params=None, options=None):
            captured["params"] = params
            captured["options"] = options
            return {"id": "acct_x"}

        def retrieve(self, account_id):
            return {"id": account_id}

    class Links:
        def create(self, params=None, options=None):
            captured["link"] = params
            return {"url": "https://connect.stripe.com/setup/s/ok"}

    class Client:
        def __init__(self):
            self.accounts = Accounts()
            self.account_links = Links()

    gateway = StripeGateway("sk_test_example")
    gateway.client = Client()
    gateway.create_express_account("owner")
    assert captured["params"]["type"] == "express"
    assert captured["params"]["country"] == "ES"
    assert captured["params"]["capabilities"]["transfers"]["requested"] is True
    assert captured["params"]["capabilities"]["card_payments"]["requested"] is True
    assert captured["options"] == {"idempotency_key": "demo:owner:express"}
    assert hosted_onboarding_url("https://connect.stripe.com/setup/s/ok") == "https://connect.stripe.com/setup/s/ok"
    with pytest.raises(Exception):
        hosted_onboarding_url("https://evil.example/phish")


def test_webhook_connect_secret_and_rejects_live_or_mismatch(express_client, monkeypatch):
    browser, fake = express_client
    monkeypatch.setattr(index, "settings", lambda: config(stripe_connect_webhook_secret="whsec_connect"))

    def send(secret, livemode=False, account="acct_express", obj_id="acct_express", tamper=False):
        event = {
            "id": "evt_connect",
            "object": "event",
            "livemode": livemode,
            "type": "account.updated",
            "account": account,
            "data": {"object": {"id": obj_id, "metadata": {"demo_session_id": "owner"}}},
        }
        body = json.dumps(event, separators=(",", ":")).encode()
        timestamp = str(int(time.time()))
        signature = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
        return browser.post("/api/webhook", content=body + (b" " if tamper else b""), headers={"stripe-signature": f"t={timestamp},v1={signature}"})

    assert send("whsec_connect", tamper=True).status_code == 400
    assert send("whsec_wrong").status_code == 400
    assert send("whsec_connect", livemode=True).status_code == 400
    assert send("whsec_connect", account="acct_a", obj_id="acct_b").status_code == 400
    accepted = send("whsec_connect")
    assert accepted.status_code == 200
    assert accepted.json() == {"received": True}
    assert fake.verified is None
