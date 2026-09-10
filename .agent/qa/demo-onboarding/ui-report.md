# Demo onboarding QA

- Parent Chromium evidence before this fix: 13 passed, 1 failed (stale Express recipient-copy assertion). This child environment may skip Chromium because Chrome exits with `SIGTRAP`; skipped runs are not counted as passes.
- Static checks: `node --check demos/partner-payments/app.mjs`, `node --check demos/partner-payments/stripe-ui.mjs`.
- Existing selector and ledger tests pass.
- Coverage intended: initial guide, mobile overflow, keyboard close/reopen, local simulation route, Express route, and return to Cobros.
- Fee clarity coverage added: estimate recalculation, known Stripe fee, pending fee without fallback, and negative platform net after refund. Evidence is in `fees-evidence.json`.

Parent evidence also recorded 32 backend tests passed. Screenshots remain parent-owned under `.agent/qa/demo-onboarding/screenshots`.
