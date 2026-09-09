# Stripe Destination Charges demo

This is an isolated Stripe **test-mode** FastAPI/Vercel demo for reusable connected partners. It creates Checkout payments on the platform and uses `payment_intent_data.transfer_data.destination` plus `application_fee_amount`; it does not make direct charges with a `Stripe-Account` header.

Set `STRIPE_SECRET_KEY` to a test/restricted-test key, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PARTNER_ACCOUNT_ID` (`acct_...`), `APP_URL`, and a random `DEMO_SESSION_SECRET` of at least 32 characters. Connect must be enabled in the selected sandbox and the connected account must have transfers active. Missing configuration fails closed for checkout while `/api/config` remains safe to call. The published demo has been configured and verified with a Custom test account; see `../partner-payments/DEPLOYMENT.md` for evidence and the separate Express onboarding limitation.

Stripe is the source of truth for amounts, refunds, transfers and payment state. This intentionally has no product database or internal balance/ledger. The webhook only marks the Stripe PaymentIntent metadata with a verified test event id; it does not settle funds or update balances. Production would need an auditable, idempotent ledger and reconciliation design before handling real money.

Vercel serves `api/index.py`; place the separate static frontend in `public/` when integrating.
