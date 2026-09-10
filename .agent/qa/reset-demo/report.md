# QA: reset demo

Date: 2026-09-10

## Commands

```bash
/tmp/insaidr-stripe-demo-venv/bin/python -m pytest -q demos/partner-payments-stripe/tests --tb=short
node --test demos/partner-payments/tests/*.test.mjs
```

Playwright: `require('playwright')`, fallback `/home/roberto/src/autonomous-coding-v2/node_modules/playwright`.

## Results

| Suite | Result |
| --- | --- |
| pytest `demos/partner-payments-stripe/tests` | **32 passed**, 2 warnings (Starlette deprecations), 1.58s |
| `node --test demos/partner-payments/tests/*.test.mjs` | **13 passed**, 0 failed, 9.92s |

Reset Chromium cases: cancel does nothing; confirm POSTs then `/` empty; 502 keeps paid result and re-enables the button; double click → one POST; checkout in-flight blocks confirm; desktop/mobile snapshots of the header control.

## Screenshots

- `.agent/qa/reset-demo/screenshots/desktop-1440-reset-control.png`
- `.agent/qa/reset-demo/screenshots/mobile-390-reset-control.png`

## Guards checked

- No Stripe calls on `POST /api/session/reset` (fake gateway unused).
- Origin/JSON/size: 403 / 415 / 413.
- `POST /api/session` still reuses a valid cookie.
- Reset blocked while checkout/refund/onboarding mutation is in flight.

## Changed files

- `demos/partner-payments-stripe/api/index.py`
- `demos/partner-payments-stripe/tests/test_api.py`
- `demos/partner-payments/index.html`
- `demos/partner-payments/styles.css`
- `demos/partner-payments/stripe-ui.mjs`
- `demos/partner-payments/tests/reset.browser.test.mjs`
- `demos/partner-payments/tests/selectors.test.mjs`
- `README.md`
- `docs/reset-demo.md`
- `.agent/qa/reset-demo/report.md`
- `.agent/qa/reset-demo/screenshots/*.png`
