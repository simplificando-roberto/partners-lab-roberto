"""Negative paths for the public, test-only browser session boundary."""
import hashlib
import hmac
import json
import time

import pytest

from test_api import client, config, index, session_cookie

ORIGIN = {"Origin": "https://demo.example"}
REFUND = {"checkout_session_id": "cs_test_owned", "amount_cents": 100, "idempotency_key": "5d4ed25d-cd72-4b15-ae8a-cd9b275e9ff6"}


def test_distinct_valid_session_cannot_read_or_refund_another_payment(client):
    browser, fake = client
    token = index.SessionStore(config().session_secret).serializer.dumps({"id": "second-person", "exp": int(time.time()) + 3600})
    browser.cookies.set("partner_demo_session", token)
    assert browser.get("/api/payment?session_id=cs_test_owned").status_code == 403
    assert browser.post("/api/refund", json=REFUND, headers=ORIGIN).status_code == 403
    assert fake.refund_args is None


@pytest.mark.parametrize("token", [None, "invalid-signature", "expired"])
def test_missing_invalid_or_expired_session_is_rejected(client, token):
    browser, fake = client
    if token == "expired":
        token = index.SessionStore(config().session_secret).serializer.dumps({"id": "owner", "exp": 1})
    if token:
        browser.cookies.set("partner_demo_session", token)
    assert browser.get("/api/payment?session_id=cs_test_owned").status_code == 403
    assert browser.post("/api/refund", json=REFUND, headers=ORIGIN).status_code == 403
    assert fake.refund_args is None


@pytest.mark.parametrize("origin", [None, "https://attacker.example"])
def test_missing_or_foreign_origin_cannot_mutate(client, origin):
    browser = session_cookie(client)
    headers = {"Origin": origin} if origin else {}
    assert browser.post("/api/refund", json=REFUND, headers=headers).status_code == 403
    assert client[1].refund_args is None


@pytest.mark.parametrize("payload,status", [(b"{", 400), (b"[]", 400), (b"x" * 70000, 413)])
def test_malformed_and_oversized_json_are_rejected(client, payload, status):
    browser = session_cookie(client)
    response = browser.post("/api/checkout", content=payload, headers={**ORIGIN, "Content-Type": "application/json"})
    assert response.status_code == status
    assert client[1].checkout_params is None


def test_real_webhook_signature_accepts_test_event_but_rejects_live_and_tampering(client):
    browser, fake = client
    def send(livemode=False, tamper=False):
        event = {"id": "evt_signed_test", "object": "event", "livemode": livemode, "type": "payment_intent.succeeded", "data": {"object": {"id": "pi_test_1", "metadata": {"demo_session_id": "owner"}}}}
        body = json.dumps(event, separators=(",", ":")).encode()
        timestamp = str(int(time.time()))
        signature = hmac.new(config().stripe_webhook_secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
        return browser.post("/api/webhook", content=body + (b" " if tamper else b""), headers={"stripe-signature": f"t={timestamp},v1={signature}"})
    assert send(tamper=True).status_code == 400
    assert send(livemode=True).status_code == 400
    assert not hasattr(fake, "verified")
    assert send().status_code == 200
    assert fake.verified == ("pi_test_1", "evt_signed_test")
    assert send().status_code == 200
    assert fake.verified == ("pi_test_1", "evt_signed_test")
