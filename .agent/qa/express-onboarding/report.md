# Express onboarding QA

**BLOCKED** for the full hosted sandbox journey. Source implementation and local regression checks passed; do not interpret mocked readiness as a completed Stripe onboarding.

30 backend tests and 12 Node tests cover signed-session preservation, owned Express account, same idempotency key on retries, CSRF, cross-session rejection, incomplete-account checkout blocking, separate transfer/payout readiness, Connect webhook signatures, return/refresh, errors and expiry. Real Chromium screenshots at 390/768/1440 are in screenshots/. Independent Grok4.6 security review is attached. First implementation hit its900s deadline; continuation completed with valid marker.

Actual Stripe API denied the initial claimable sandbox key on accounts.create/retrieve. Express now excludes that key type and shows “El alta Express está pendiente de configuración.” It returns503 before creating accounts. Replace STRIPE_SECRET_KEY in Vercel with an appropriately permissioned TEST key, redeploy, then finish hosted onboarding, destination payment and refund. CLI OAuth is intentionally not deployed.

Connect account.updated webhook we_1UEB8GAWy6B5PVpGTQiy8Qsp is TEST-only and its signing secret is configured in Vercel; no secret is in this repo. The endpoint reads Stripe account state on demand rather than maintaining a production ledger.

Public automated browser hit Vercel Security Checkpoint code29; API requests were challenged too. Firewall overview: attack mode off, no custom firewall, system mitigations active. No bypass or protection changes. Local real-browser UI is available, but the hosted critical path is not reported as passed.

One Express account per one-hour signed demo session. Losing/expiring that cookie prevents recovering that account through this demo. Production partner identity/persistence, live-money payments and bank payouts remain excluded.
