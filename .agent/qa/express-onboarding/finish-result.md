I’ll run pytest and the Chromium Node tests first, then only patch failures and write the evidence into the docs.Two test failures: onboarding retries the same Stripe idempotency key, and the Partners copy match was case-sensitive. I’ll fix those and the session-expiry status, then re-run.Pytest is **29 passed**. Node Chromium is **12 passed**. Express onboarding is covered by mocks only; parent still owns live TEST validation and publication.

Failures fixed in this pass:
- Repeated `POST /api/partner/onboarding` now asserts the same Stripe idempotency key (`demo:{session}:express`), then resume-from-cookie without a second create.
- Partners copy match is case-insensitive (`SIMULACIÓN LOCAL` vs `Simulación local`).
- A 403 demo session shows the expiry state instead of an empty Express account.

Docs updated: root `README.md`, `.env.example` (`STRIPE_CONNECT_WEBHOOK_SECRET` name only), and `docs/express/implementation.md` with commands, counts, selectors, and screenshot paths under `.agent/qa/express-onboarding/screenshots/`.

GROK_EXPRESS_COMPLETE