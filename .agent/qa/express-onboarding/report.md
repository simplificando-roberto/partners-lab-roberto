# Express onboarding QA

**BLOCKED** for the full hosted sandbox journey. Source implementation and local regression checks passed; do not interpret mocked readiness as a completed Stripe onboarding.

30 backend tests and 12 Node tests cover signed-session preservation, owned Express account, same idempotency key on retries, CSRF, cross-session rejection, incomplete-account checkout blocking, separate transfer/payout readiness, Connect webhook signatures, return/refresh, errors and expiry. Real Chromium screenshots at 390/768/1440 are in screenshots/. Independent Grok4.6 security review is attached. First implementation hit its900s deadline; continuation completed with valid marker.

Actual Stripe API denied the initial claimable sandbox key on accounts.create/retrieve. Express now excludes that key type and shows “El alta Express está pendiente de configuración.” It returns503 before creating accounts. This was the stale local test credential, not evidence that Vercel needs a new key. Final public /api/config returns configured=true, test_only=true, express_available=true. No API-key replacement is currently requested. Hosted onboarding, destination payment and refund remain unverified because the automation environment is challenged. CLI OAuth is intentionally not deployed.

Connect account.updated webhook we_1UEB8GAWy6B5PVpGTQiy8Qsp is TEST-only and its signing secret is configured in Vercel; no secret is in this repo. The endpoint reads Stripe account state on demand rather than maintaining a production ledger.

Public automated browser hit Vercel Security Checkpoint code29; API requests were challenged too. Firewall overview: attack mode off, no custom firewall, system mitigations active. No bypass or protection changes. Local real-browser UI is available, but the hosted critical path is not reported as passed.

One Express account per one-hour signed demo session. Losing/expiring that cookie prevents recovering that account through this demo. Production partner identity/persistence, live-money payments and bank payouts remain excluded.

## Deployment readback

Vercel READY `dpl_2HvUGW32KSw3SPYF9nxq6V9QF8E4`, source `e6ea998cf30118e07482fadcfec8c8b050928907`. Public release.json matches; index.html/styles.css/stripe-ui.mjs match source bytes. GET api/config succeeded with Express available. Browser navigation and POST api/session still receive Vercel Security Checkpoint. Official vercel curl generated an automation deployment-protection token, but the system challenge remained; no firewall/system mitigation setting was changed. Successful GETs are not evidence of a successful mutation.

The initial request to replace the API key was withdrawn after public config readback distinguished the stale local credential from the Vercel deployment. Remaining blocker: obtain a successful hosted browser journey from an environment Vercel accepts.
