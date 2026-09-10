I’ll gate Express on full TEST keys (not `rkcs_test_`), fail closed with the pending-setup copy, and add assertions that claimable keys never hit Stripe.Express now fail-closes on claimable sandbox keys. `express_available` requires `sk_test_` or `rk_test_` (not `rkcs_test_`). Checkout still treats `rkcs_test_` as a TEST key.

When Express is unavailable, config stays secret-free (`express_available: false`), the Partners status is **El alta Express está pendiente de configuración.**, `POST /api/partner/onboarding` returns **503** before Stripe, and `GET /api/partner` is **200 `{account: null}`** after owner checks with no retrieve.

Live blocker (not an Express success): Stripe `PermissionError` on `accounts.create` / `accounts.retrieve` with the current `rkcs_test_` key. Parent still needs to replace `STRIPE_SECRET_KEY` in Vercel with `sk_test_` or a permissioned `rk_test_`. CLI OAuth is not used.

Tests: pytest **30 passed**; selectors **2 passed**.

GROK_EXPRESS_GATE_COMPLETE