import json
import time
from pathlib import Path
from dataclasses import replace
from typing import Any
from urllib.parse import quote

import stripe
from fastapi import Cookie, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from api.services import (
    DemoError,
    MAX_BODY_BYTES,
    OwnershipError,
    SessionStore,
    Settings,
    StripeGateway,
    assert_owned_account,
    belongs_to,
    checkout_params,
    hosted_onboarding_url,
    partner_dto,
    payment_dto,
    require_uuid,
    verify_signed_event,
    _value,
    AccessStore,
    AUTH_COOKIE,
    AUTH_MAX_AGE,
)

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
SITE = Path(__file__).parent / "site"
ASSETS = {"index.html", "styles.css", "app.mjs", "ledger.mjs", "stripe-ui.mjs", "release.json", "robots.txt"}


@app.middleware("http")
async def private_demo_responses(request: Request, call_next):
    config = settings()
    path = request.url.path
    anonymous = (path == "/login" and request.method == "GET") or (path == "/api/login" and request.method == "POST") or (path == "/api/webhook" and request.method == "POST")
    authenticated = config.access_ready and AccessStore(config.session_secret).read(request.cookies.get(AUTH_COOKIE), config.access_username, config.access_password)
    if not anonymous and not authenticated:
        if path.startswith("/api/") or path == "/api":
            return JSONResponse({"detail": "Authentication required."}, status_code=401, headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"})
        if path != "/login":
            next_url = safe_next(str(request.url.path) + (f"?{request.url.query}" if request.url.query else ""))
            location = "/login" + (f"?next={quote(next_url, safe='')}" if next_url else "")
            from fastapi.responses import RedirectResponse
            return RedirectResponse(location, status_code=303, headers={"Cache-Control": "no-store"})
    response = await call_next(request)
    response.headers.setdefault("Cache-Control", "no-store")
    response.headers.setdefault("X-Robots-Tag", "noindex")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    return response


def safe_next(value: str | None) -> str:
    path = value.split("?", 1)[0].split("#", 1)[0] if isinstance(value, str) else ""
    if not isinstance(value, str) or not value.startswith("/") or value.startswith("//") or "\\" in value or any(ord(c) < 32 for c in value) or len(value) > 2048 or any(part in {".", ".."} for part in path.split("/")):
        return "/"
    return value


def settings() -> Settings:
    return Settings()


def gateway(config: Settings) -> StripeGateway:
    return StripeGateway(config.stripe_secret_key)


def no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex"


def require_json(request: Request, config: Settings) -> None:
    if request.headers.get("content-type", "").split(";", 1)[0] != "application/json":
        raise HTTPException(415, "JSON is required.")
    if request.headers.get("origin") != config.app_url:
        raise HTTPException(403, "Invalid request origin.")
    try:
        length = int(request.headers.get("content-length", "0") or 0)
    except ValueError:
        raise HTTPException(400, "Invalid content length.")
    if length > MAX_BODY_BYTES:
        raise HTTPException(413, "Request is too large.")


async def body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        raise HTTPException(413, "Request is too large.")
    try:
        value = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "Invalid JSON.") from exc
    if not isinstance(value, dict):
        raise HTTPException(400, "JSON object required.")
    return value


def owner(cookie: str | None, config: Settings) -> dict[str, Any]:
    if not config.session_ready:
        raise HTTPException(503, "Demo session configuration is unavailable.")
    try:
        return SessionStore(config.session_secret).read(cookie)
    except OwnershipError as exc:
        raise HTTPException(403, str(exc)) from exc


def require_test_key(config: Settings) -> None:
    # Do not let an accidental live key reach a Stripe API request.
    if not config.test_key:
        raise HTTPException(503, "Test-mode payment configuration is unavailable.")


def set_session_cookie(response: Response, token: str, exp: int) -> None:
    response.set_cookie(
        "partner_demo_session",
        token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=max(1, int(exp - time.time())),
        path="/",
    )


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(AUTH_COOKIE, token, httponly=True, secure=True, samesite="lax", max_age=AUTH_MAX_AGE, path="/")


def login_page(_: str = "/") -> str:
    return '''<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acceso · Partners Lab</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f5f7;color:#222;font:16px system-ui,sans-serif}main{width:min(360px,calc(100% - 40px));padding:32px;background:#fff;border:1px solid #d9dce2;border-radius:14px;box-shadow:0 12px 30px #18203314}h1{margin:0 0 8px;font-size:1.5rem}p{color:#5c6472;line-height:1.45}label{display:block;margin:18px 0 6px;font-weight:600}input{width:100%;padding:11px;border:1px solid #b9bfca;border-radius:8px;font:inherit}button{width:100%;margin-top:22px;padding:12px;border:0;border-radius:8px;background:#635bff;color:#fff;font-weight:700;font:inherit;cursor:pointer}[role=status]{min-height:1.4em;color:#a21d35}</style></head><body><main><h1>Partners Lab</h1><p>Acceso privado a la demo de sandbox.</p><form id="login" novalidate><label for="username">Usuario</label><input id="username" name="username" autocomplete="username" required><label for="password">Contraseña</label><input id="password" name="password" type="password" autocomplete="current-password" required><p id="error" role="status" aria-live="polite"></p><button>Entrar</button></form></main><script>const next=new URLSearchParams(location.search).get('next')||'/';const form=document.querySelector('#login'),error=document.querySelector('#error');form.addEventListener('submit',async e=>{e.preventDefault();error.textContent='';try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json','Origin':location.origin},credentials:'same-origin',body:JSON.stringify({username:form.username.value,password:form.password.value,next})});if(r.ok){const d=await r.json();location.replace(d.next||'/')}else error.textContent='Usuario o contraseña no válidos.'}catch{error.textContent='No se pudo conectar. Inténtalo de nuevo.'}});</script></body></html>'''


@app.get("/login")
def login(next: str = "/"):
    return Response(login_page(next), media_type="text/html", headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"})


@app.post("/api/login")
async def do_login(request: Request, response: Response):
    config = settings()
    if not config.access_ready:
        raise HTTPException(503, "Demo access configuration is unavailable.")
    require_json(request, config)
    data = await body(request)
    username, password = data.get("username"), data.get("password")
    import hmac
    def encoded(value: Any) -> bytes:
        try:
            return value.encode("utf-8") if isinstance(value, str) else b"\x00"
        except UnicodeEncodeError:
            return b"\x00"
    username_ok = hmac.compare_digest(encoded(username), encoded(config.access_username))
    password_ok = hmac.compare_digest(encoded(password), encoded(config.access_password))
    valid = config.access_ready and username_ok and password_ok
    if not valid:
        raise HTTPException(401, "Invalid credentials.")
    set_auth_cookie(response, AccessStore(config.session_secret).issue(config.access_username, config.access_password))
    no_store(response)
    return {"ok": True, "next": safe_next(data.get("next"))}


@app.post("/api/logout")
async def logout(request: Request, response: Response):
    config = settings()
    require_json(request, config)
    await body(request)
    response.delete_cookie(AUTH_COOKIE, path="/")
    response.delete_cookie("partner_demo_session", path="/")
    no_store(response)
    return {"ok": True}


def owned_express_account(stripe_gateway: StripeGateway, session: dict[str, Any]):
    account_id = session.get("partner_account_id")
    if isinstance(account_id, str) and account_id.startswith("acct_"):
        account = stripe_gateway.retrieve_account(account_id)
    else:
        account = stripe_gateway.create_express_account(session["id"])
    assert_owned_account(account, session["id"])
    return account


@app.exception_handler(DemoError)
async def demo_error(_: Request, exc: DemoError):
    return JSONResponse({"detail": str(exc)}, status_code=400, headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"})


@app.get("/api/config")
def config(response: Response):
    config = settings()
    no_store(response)
    # Do not contact Stripe from this safe status endpoint. Checkout verifies the
    # Connect account immediately before a payment is created and fails closed.
    return {
        "configured": config.configured,
        "test_only": config.test_key,
        "partner_configured": config.partner_configured,
        "partner_ready": None,
        "partner_checked": False,
        "express_available": config.express_available,
        "currency": "eur",
    }


@app.post("/api/session")
async def create_session(request: Request, response: Response, partner_demo_session: str | None = Cookie(default=None)):
    config = settings()
    require_json(request, config)
    await body(request)
    if not config.session_ready:
        raise HTTPException(503, "Demo session configuration is unavailable.")
    store = SessionStore(config.session_secret)
    try:
        data = store.read(partner_demo_session)
    except OwnershipError:
        token, data = store.issue()
        set_session_cookie(response, token, data["exp"])
    no_store(response)
    return {"expires_at": data["exp"]}


@app.post("/api/session/reset")
async def reset_session(request: Request, response: Response):
    config = settings()
    require_json(request, config)
    await body(request)
    if not config.session_ready:
        raise HTTPException(503, "Demo session configuration is unavailable.")
    # Always mint a fresh demo session with no Express association. Never call Stripe.
    token, data = SessionStore(config.session_secret).issue()
    set_session_cookie(response, token, data["exp"])
    no_store(response)
    return {"expires_at": data["exp"]}


@app.get("/api/partner")
def partner(response: Response, partner_demo_session: str | None = Cookie(default=None)):
    config = settings()
    require_test_key(config)
    session = owner(partner_demo_session, config)
    no_store(response)
    if not config.express_available:
        return {"account": None}
    account_id = session.get("partner_account_id")
    if not isinstance(account_id, str) or not account_id.startswith("acct_"):
        return {"account": None}
    try:
        account = gateway(config).retrieve_account(account_id)
        assert_owned_account(account, session["id"])
    except OwnershipError as exc:
        raise HTTPException(403, str(exc)) from exc
    except stripe.StripeError as exc:
        raise HTTPException(502, "Payment provider unavailable.") from exc
    return {"account": partner_dto(account)}


@app.post("/api/partner/onboarding")
async def partner_onboarding(request: Request, response: Response, partner_demo_session: str | None = Cookie(default=None)):
    config = settings()
    require_test_key(config)
    require_json(request, config)
    await body(request)
    session = owner(partner_demo_session, config)
    if not config.express_available:
        raise HTTPException(503, "Express onboarding is unavailable.")
    try:
        stripe_gateway = gateway(config)
        account = owned_express_account(stripe_gateway, session)
        account_id = _value(account, "id")
        created = stripe_gateway.create_account_link(
            account_id,
            f"{config.app_url}/?partner_refresh=1",
            f"{config.app_url}/?partner_return=1",
        )
        url = hosted_onboarding_url(_value(created, "url"))
    except OwnershipError as exc:
        raise HTTPException(403, str(exc)) from exc
    except stripe.StripeError as exc:
        raise HTTPException(502, "Payment provider unavailable.") from exc
    token, data = SessionStore(config.session_secret).issue({**session, "partner_account_id": account_id})
    set_session_cookie(response, token, data["exp"])
    no_store(response)
    return {"url": url, "account": partner_dto(account)}


@app.post("/api/checkout")
async def checkout(request: Request, partner_demo_session: str | None = Cookie(default=None)):
    config = settings()
    require_json(request, config)
    data = await body(request)
    session = owner(partner_demo_session, config)
    key = require_uuid(data.get("idempotency_key"))
    # Namespace prevents a key copied from another browser session being reused.
    scoped_key = f"demo:{session['id']}:{key}"
    try:
        stripe_gateway = gateway(config)
        account_id = session.get("partner_account_id")
        if isinstance(account_id, str) and account_id.startswith("acct_"):
            account = stripe_gateway.retrieve_account(account_id)
            assert_owned_account(account, session["id"])
            dto = partner_dto(account)
            if not dto["transfers_active"]:
                raise HTTPException(409, "El partner de esta sesión aún no puede recibir transferencias. Continúa el alta en Stripe.")
            checkout_settings = replace(config, partner_account_id=dto["id"])
        else:
            if not config.configured or not config.partner_configured:
                raise HTTPException(503, "Partner payment configuration is unavailable.")
            if not stripe_gateway.verify_partner(config.partner_account_id):
                raise HTTPException(503, "Partner payment configuration is unavailable.")
            checkout_settings = config
        if not checkout_settings.configured:
            raise HTTPException(503, "Partner payment configuration is unavailable.")
        created = stripe_gateway.create_checkout(checkout_params(checkout_settings, session["id"], data.get("amount_cents"), data.get("fee_percent")), scoped_key)
    except OwnershipError as exc:
        raise HTTPException(403, str(exc)) from exc
    except stripe.StripeError as exc:
        raise HTTPException(502, "Payment provider unavailable.") from exc
    return JSONResponse({"checkout_session_id": _value(created, "id"), "url": _value(created, "url")}, headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"})


@app.post("/api/refund")
async def refund(request: Request, partner_demo_session: str | None = Cookie(default=None)):
    config = settings()
    require_test_key(config)
    require_json(request, config)
    data = await body(request)
    session = owner(partner_demo_session, config)
    checkout_id, key, amount = data.get("checkout_session_id"), require_uuid(data.get("idempotency_key")), data.get("amount_cents")
    if not isinstance(checkout_id, str) or not checkout_id.startswith("cs_test_") or type(amount) is not int or amount < 1:
        raise HTTPException(400, "Invalid refund request.")
    try:
        checkout_object = gateway(config).checkout(checkout_id)
        belongs_to(checkout_object, session["id"])
        payment_intent = _value(checkout_object, "payment_intent")
        if not isinstance(payment_intent, str):
            raise HTTPException(400, "Checkout has no payment intent.")
        refunded = gateway(config).refund(payment_intent, amount, f"demo:{session['id']}:{key}")
    except OwnershipError as exc:
        raise HTTPException(403, str(exc)) from exc
    except stripe.StripeError as exc:
        raise HTTPException(502, "Payment provider unavailable.") from exc
    return JSONResponse({"refund_id": _value(refunded, "id"), "amount_cents": _value(refunded, "amount"), "status": _value(refunded, "status")}, headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"})


@app.get("/api/payment")
def payment(session_id: str, partner_demo_session: str | None = Cookie(default=None)):
    config = settings()
    require_test_key(config)
    session = owner(partner_demo_session, config)
    if not session_id.startswith("cs_test_"):
        raise HTTPException(400, "Invalid checkout session.")
    try:
        checkout_object = gateway(config).checkout(session_id)
        belongs_to(checkout_object, session["id"])
        pi_id = _value(checkout_object, "payment_intent")
        if not isinstance(pi_id, str):
            raise HTTPException(400, "Checkout has no payment intent.")
        dto = payment_dto(checkout_object, gateway(config).payment_intent(pi_id))
    except OwnershipError as exc:
        raise HTTPException(403, str(exc)) from exc
    except stripe.StripeError as exc:
        raise HTTPException(502, "Payment provider unavailable.") from exc
    return JSONResponse(dto, headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"})


@app.post("/api/webhook")
async def webhook(request: Request, stripe_signature: str | None = Header(default=None)):
    config = settings()
    require_test_key(config)
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        raise HTTPException(413, "Request is too large.")
    try:
        event = verify_signed_event(raw, stripe_signature, config)
    except (ValueError, stripe.SignatureVerificationError) as exc:
        raise HTTPException(400, "Invalid webhook signature.") from exc
    if _value(event, "livemode") is not False:
        raise HTTPException(400, "Live webhooks are not accepted.")
    event_type = _value(event, "type")
    if event_type == "account.updated":
        obj = _value(_value(event, "data", {}) or {}, "object", {}) or {}
        obj_id = _value(obj, "id")
        if _value(event, "account") != obj_id or not isinstance(obj_id, str) or not obj_id.startswith("acct_"):
            raise HTTPException(400, "Invalid Connect account event.")
        return JSONResponse({"received": True}, headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"})
    if event_type in {"checkout.session.completed", "payment_intent.succeeded", "charge.refunded"}:
        obj = _value(_value(event, "data", {}), "object", {})
        metadata = _value(obj, "metadata", {}) or {}
        demo_session_id = _value(metadata, "demo_session_id")
        pi_id = _value(obj, "payment_intent") if event_type != "payment_intent.succeeded" else _value(obj, "id")
        if demo_session_id and isinstance(pi_id, str):
            try:
                gateway(config).mark_verified(pi_id, _value(event, "id"))
            except stripe.StripeError:
                raise HTTPException(502, "Payment provider unavailable.")
    return JSONResponse({"received": True}, headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"})


@app.get("/")
def home():
    return serve_asset("index.html")


@app.get("/{path:path}")
def static_asset(path: str):
    # Only the bundled allowlist is reachable; arbitrary source paths stay 404.
    if path.startswith("api/") or path.startswith("public/") or "/" in path or path not in ASSETS:
        raise HTTPException(404, "Not found")
    return serve_asset(path)


def serve_asset(name: str):
    if name not in ASSETS:
        raise HTTPException(404, "Not found")
    file = (SITE / name).resolve()
    if SITE.resolve() not in file.parents or not file.is_file():
        raise HTTPException(404, "Not found")
    from fastapi.responses import FileResponse
    return FileResponse(file)
