**Verdict: PASS with P2 notes (no P1 payment-state regressions in the provided handler).** Gross/net math, checkout URL gate, and checkout/refund idempotency keys are coherent. The screenshot is readable; wrap on “Comisión de plataforma” is layout, not clipping.

### Payment-state (code)

**Idempotency — OK.** Checkout fingerprints `{amount_cents, fee_percent}` and reuses `pendingCheckout.key` until the fingerprint changes. Refund fingerprints `` `${id}:${cents}:${currentPayment?.refunded_cents || 0}` `` so a later different remainder gets a new key. Double-click on the same payload reuses the same key.

**Unsafe navigation — OK.** `checkoutId()` requires `^cs_test_[A-Za-z0-9_]+$`. Checkout only `location.assign`s after `https:` + `checkout.stripe.com`. Config gate requires `configured && partner_configured && test_only !== false`. Enable is one-shot (`enabled`).

**Rendering — OK, with one stale-control caveat.** `renderPayment` writes gross customer/fee, partner from `partner_pending_cents`, refunded vs live labels, disables refund when `status !== 'succeeded'` or remaining &lt; 1. `updatePreview` bails when `currentPayment` is set so live inputs cannot overwrite a returned session. Inputs disable when a session is in the URL.

Refund `finally` uses `refunded_cents >= amount_cents` rather than remaining &lt; 1; after a failed partial refund the button can stay enabled until `refresh()` succeeds. Not a wrong amount; possible extra click.

**Gross/net — OK vs screenshot.** Preview: 100 € / 10% → fee 10, partner 90, caption “antes de costes de Stripe”. Grid: Importe 100, Devuelto 0, Comisión plataforma 10, Comisión Stripe 3,40, Neto plataforma 6,60, Pendiente partner 90, Estado pagado. `100 - 10 = 90`; `10 - 3,40 = 6,60`. Transfer gross lives under “Detalles técnicos”, not in the preview partner figure.

`pending(null)` → “Pendiente”; `money` only for pre-payment preview.

### Screenshot (objective)

- Amounts fully visible; no truncation of 100,00 / 10,00 / 90,00 / 3,40 / 6,60.
- “Comisión de plataforma” wraps onto two lines in the activity row; values remain aligned and readable.
- Hero scope text wraps “simulación / local” at the right; not overlapping the cards.
- “Estado / Pagado en pruebas” wraps; not clipped.
- Refund field empty but panel shown with succeeded + remaining 100 — matches `hidden` only when remaining &lt; 1.
- “Probar pago con Stripe” still visible with session present; code sets `checkout.disabled = Boolean(checkoutId())`, not hidden — screenshot cannot prove disabled vs enabled (limitation).

### P1 / P2

- **P1:** none from this evidence.
- **P2:** refund `finally` vs remaining &lt; 1 (partial-fail enable). Activity-row label wrap. Checkout CTA still shown after return (disabled in code, not visually confirmed here).

### Limitations

Static screenshot + truncated diff, not Chromium execution. Parent’s real Chromium + backend 19 tests were not re-run here.

GROK_FINAL_REVIEW_COMPLETE