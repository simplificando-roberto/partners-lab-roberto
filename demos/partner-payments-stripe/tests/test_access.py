import sys
import time
from http.cookies import SimpleCookie
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))
from api import index  # noqa: E402
from api.services import AccessStore, Settings  # noqa: E402


def cfg(**overrides):
    values = dict(
        app_url="https://demo.example",
        session_secret="s" * 32,
        access_username="demo",
        access_password="päss",
        stripe_secret_key="sk_test_example",
        stripe_webhook_secret="whsec_test",
    )
    values.update(overrides)
    return Settings(**values)


def browser(monkeypatch, **overrides):
    monkeypatch.setattr(index, "settings", lambda: cfg(**overrides))
    return TestClient(index.app, base_url="https://demo.example")


def auth_cookie(client, config=None):
    config = config or cfg()
    client.cookies.set(index.AUTH_COOKIE, AccessStore(config.session_secret).issue(config.access_username, config.access_password))


def test_anonymous_api_is_closed_without_gateway_calls(monkeypatch):
    client = browser(monkeypatch)
    monkeypatch.setattr(index, "gateway", lambda _: (_ for _ in ()).throw(AssertionError("gateway called")))
    for path in ("/api", "/api/config", "/api/session", "/api/payment", "/api/partner"):
        assert client.get(path).status_code == 401
    origin = {"Origin": cfg().app_url}
    for path in ("/api/session/reset", "/api/checkout", "/api/refund", "/api/partner/onboarding"):
        assert client.post(path, json={}, headers=origin).status_code == 401
    client.cookies.set(index.AUTH_COOKIE, "forged")
    assert client.get("/api/config").status_code == 401
    for path in ("/", "/index.html", "/styles.css", "/legacy/index.html"):
        assert client.get(path, follow_redirects=False).status_code == 303


def test_login_page_never_interpolates_query_into_script(monkeypatch):
    client = browser(monkeypatch)
    payload = "/</script><script>document.body.dataset.xss=1</script>"
    response = client.get("/login", params={"next": payload})
    assert response.status_code == 200
    assert payload not in response.text
    assert "new URLSearchParams(location.search)" in response.text


def test_login_unicode_invalid_is_generic_401_and_valid_sets_flags(monkeypatch):
    client = browser(monkeypatch)
    bad = client.post("/api/login", json={"username": "nope", "password": "noñ"}, headers={"Origin": cfg().app_url})
    assert bad.status_code == 401
    ok = client.post("/api/login", json={"username": "demo", "password": "päss", "next": "//evil"}, headers={"Origin": cfg().app_url})
    assert ok.status_code == 200 and ok.json()["next"] == "/"
    cookie = ok.headers["set-cookie"].lower()
    assert "httponly" in cookie and "secure" in cookie and "samesite=lax" in cookie and "path=/" in cookie


def test_login_missing_config_fails_closed(monkeypatch):
    for overrides in ({"session_secret": "short"}, {"access_username": ""}, {"access_password": ""}):
        client = browser(monkeypatch, **overrides)
        assert client.post("/api/login", json={}, headers={"Origin": cfg().app_url}).status_code == 503


def test_access_tokens_reject_forgery_expiry_purpose_and_rotation():
    store = AccessStore("a" * 32)
    token = store.issue("u", "p")
    assert store.read(token, "u", "p")
    assert not store.read(token, "u", "changed")
    assert not AccessStore("b" * 32).read(token, "u", "p")
    expired = store.serializer.dumps({"v": 1, "purpose": "demo-access", "fp": "x", "exp": int(time.time()) - 1})
    assert not store.read(expired, "u", "p")
    wrong = store.serializer.dumps({"v": 1, "purpose": "other", "fp": "x", "exp": int(time.time()) + 100})
    assert not store.read(wrong, "u", "p")


def test_cross_origin_login_logout_and_logout_clears_both(monkeypatch):
    client = browser(monkeypatch)
    assert client.post("/api/login", json={"username": "demo", "password": "päss"}, headers={"Origin": "https://evil.example"}).status_code == 403
    auth_cookie(client)
    client.cookies.set("partner_demo_session", "demo-session")
    assert client.post("/api/logout", json={}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.get("/api/config").status_code == 200
    response = client.post("/api/logout", json={}, headers={"Origin": cfg().app_url})
    assert response.status_code == 200
    cookies = SimpleCookie()
    cookies.load(response.headers["set-cookie"])
    assert cookies[index.AUTH_COOKIE]["max-age"] == "0"
    assert cookies["partner_demo_session"]["max-age"] == "0"


def test_reset_retains_auth_and_safe_next(monkeypatch):
    client = browser(monkeypatch)
    auth_cookie(client)
    assert client.post("/api/session/reset", json={}, headers={"Origin": cfg().app_url}).status_code == 200
    assert index.safe_next("/checkout?x=1") == "/checkout?x=1"
    assert index.safe_next("/../../etc/passwd") == "/"
    assert index.safe_next("//evil.example") == "/"


def test_webhook_still_requires_signature(monkeypatch):
    client = browser(monkeypatch)
    assert client.post("/api/webhook", content=b"{}", headers={}).status_code == 400


def test_site_allowlist_uses_real_files(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("ok")
    (tmp_path / "styles.css").write_text("body{}")
    monkeypatch.setattr(index, "SITE", tmp_path)
    client = browser(monkeypatch)
    auth_cookie(client)
    assert client.get("/").text == "ok"
    assert client.get("/styles.css").text == "body{}"
    assert client.get("/secret.txt").status_code == 404
