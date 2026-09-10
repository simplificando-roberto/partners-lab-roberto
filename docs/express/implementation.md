# Stripe Express hosted onboarding

Public demo integration. No production user database. Parent retains secrets, Connect webhook subscription, live TEST verification, and publication.

## Contracts

### Session
- Cookie: `partner_demo_session` HttpOnly, Secure, SameSite=Lax, path `/`, 1 hour.
- Payload: `{id, exp, partner_account_id?}`. Adding a partner keeps the same `id` and `exp`.
- `POST /api/session` reuses a valid cookie. It must not rotate the session or drop `partner_account_id` (the frontend posts this before checkout).
- One Express account per session. Stripe account metadata `demo_session_id` is the owner map.
- Recovery limit: an expired or lost cookie cannot list previous Connect accounts. A new session creates a new Express account via a new idempotency key. Idempotent retries of the same session (`demo:{session_id}:express`) do not duplicate accounts on Stripe.

### Config `GET /api/config`
- Existing: `configured`, `test_only`, `partner_configured`, `partner_ready`, `partner_checked`, `currency`.
- New: `express_available` (`sk_test_` or `rk_test_` + `APP_URL` + session secret). Independent of `STRIPE_PARTNER_ACCOUNT_ID`. Claimable `rkcs_test_` keys stay TEST for Checkout but `express_available` is false (Stripe PermissionError on `accounts.create` / `accounts.retrieve`).

### Partner
- `POST /api/partner/onboarding` same-origin JSON, TEST key, signed owner. Empty body. No destination/account_id input.
- Creates or resumes the owned Express account (`country=ES`, `type=express`, requested `transfers` + `card_payments`).
- Idempotency key: `demo:{session_id}:express`.
- Returns one-use Account Link. `return_url` = `{APP_URL}/?partner_return=1`, `refresh_url` = `{APP_URL}/?partner_refresh=1`.
- Link host allowlist: `https` + `connect.stripe.com` or `*.connect.stripe.com`.
- `GET /api/partner` owner cookie, fresh Stripe retrieve, safe DTO only:
  `{id, type, status, transfers_active, payouts_enabled, details_submitted, requirements_due}`
- `status=ready` iff `capabilities.transfers == active`. Return URL is not completion. Payouts are separate.

### Checkout
- Destination is never taken from the client.
- If the session cookie has an Express `partner_account_id`, that account is the destination after owner metadata check. Pending/restricted/incomplete → actionable error, no Custom fallback.
- If the session has no Express account, the configured Custom TEST partner remains the destination.

### Webhook `POST /api/webhook`
- Platform secret `STRIPE_WEBHOOK_SECRET` and optional Connect secret `STRIPE_CONNECT_WEBHOOK_SECRET`.
- Verify signature, `livemode === false`.
- `account.updated`: `event.account` must equal `data.object.id`; never `accounts.update` in the handler.
- Parent configured the Connect TEST endpoint for `account.updated` and holds `STRIPE_CONNECT_WEBHOOK_SECRET`. TEST only; no bank payouts.

## Selectors
- `data-express-root`, `data-express-activate`, `data-express-continue`, `data-express-status`, `data-express-details`, `data-express-id`, `data-express-state`, `data-express-transfers`, `data-express-payouts`, `data-express-requirements`, `data-checkout-recipient`
- Existing simulation ids unchanged (`onboard`, `surState`, `localSimulation`, …).

## Test commands
```bash
/tmp/insaidr-stripe-demo-venv/bin/python -m pytest -q demos/partner-payments-stripe/tests
node --test demos/partner-payments/tests/*.test.mjs
```
Playwright: package `playwright`, fallback `/home/roberto/src/autonomous-coding-v2/node_modules/playwright`.

## Results

Mock vs live: pytest/Chromium mock Stripe. They are not a live Express success. Parent live probe: the deployed `rkcs_test_` claimable sandbox key is rejected on Connect `accounts.retrieve` / `accounts.create` (`PermissionError`: claimable sandbox key limited permissions; claim sandbox get full API key). CLI OAuth is ephemeral and is not a website credential. Express stays fail-closed (`express_available=false`, UI “El alta Express está pendiente de configuración.”, onboarding 503 before Stripe) until parent replaces `STRIPE_SECRET_KEY` in Vercel with `sk_test_` or a permissioned `rk_test_`. Quick Custom Checkout keeps accepting `rkcs_test_` as a TEST key. Independent security review: PASS (artifact held by parent).

| Suite | Command | Result |
|---|---|---|
| Backend | `/tmp/insaidr-stripe-demo-venv/bin/python -m pytest -q demos/partner-payments-stripe/tests` | **29 passed** (existing 19 + Express: session reuse, idempotent create/resume, live key, CSRF, cross-session/tampered cookie, incomplete block, ready vs payouts, Connect webhook secret/bad signature/live/mismatch) |
| Frontend | `node --test demos/partner-payments/tests/*.test.mjs` | **12 passed** (existing 11 + Chromium Express: initial/started/incomplete/ready/restricted/providererror/sessionexpiry/return/resume) |

Chromium screenshots (actual UI): `.agent/qa/express-onboarding/screenshots/`
- 1440: initial, started, incomplete, ready, restricted, providererror, sessionexpiry, return
- 768 and 390: initial, incomplete, ready
- resume navigates to allowlisted `https://connect.stripe.com/...`

Fixes in this verification pass: onboarding retry asserts the same Stripe idempotency key; Partners copy match is case-insensitive; 403 session shows the expiry state instead of an empty Express account.
