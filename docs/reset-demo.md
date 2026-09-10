# Reiniciar demo

Demo-only session reset. Stripe accounts, payments, and refunds are not mutated.

## Behaviour

- Header control `Reiniciar demo` is visible on every tab.
- Native `confirm()` explains: this browser session, Express association, and local simulation are cleared; Stripe keeps accounts and payments; refunds are not automatic; refund before reset if you still need result access.
- Confirmed reset: `POST /api/session/reset` (same-origin JSON, size/content/origin guards, session secret required) issues a **new** signed cookie (`HttpOnly`, `Secure`, `SameSite=Lax`) without `partner_account_id`, even if the previous cookie is missing, expired, or invalid. Never calls Stripe.
- `POST /api/session` still reuses a valid cookie.
- Then `location.replace('/')` drops checkout/cancel/onboarding query and hash and reloads memory/simulation.
- Error: state kept, actionable status, button re-enabled. Double click: one POST.
- Reset is blocked while checkout, refund, or Express onboarding is in flight.
- `file://`: reload without API.

## Tests

```bash
/tmp/insaidr-stripe-demo-venv/bin/python -m pytest -q demos/partner-payments-stripe/tests --tb=short
node --test demos/partner-payments/tests/*.test.mjs
```

Playwright: first `require('playwright')`, then `/home/roberto/src/autonomous-coding-v2/node_modules/playwright`.

## Results (2026-09-10)

- pytest: **32 passed**, 2 warnings, 1.58s
- node --test: **13 passed**, 0 failed, 9.92s
- Screenshots: `.agent/qa/reset-demo/screenshots/desktop-1440-reset-control.png`, `mobile-390-reset-control.png`

## Changed files

`demos/partner-payments-stripe/api/index.py`, `demos/partner-payments-stripe/tests/test_api.py`, `demos/partner-payments/index.html`, `demos/partner-payments/styles.css`, `demos/partner-payments/stripe-ui.mjs`, `demos/partner-payments/tests/reset.browser.test.mjs`, `demos/partner-payments/tests/selectors.test.mjs`, `README.md`, `docs/reset-demo.md`, `.agent/qa/reset-demo/report.md`, `.agent/qa/reset-demo/screenshots/*.png`
