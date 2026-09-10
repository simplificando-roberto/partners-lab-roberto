import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const stripe = readFileSync(join(root, 'stripe-ui.mjs'), 'utf8');
const app = readFileSync(join(root, 'app.mjs'), 'utf8');

test('el HTML conserva los selectores de la simulación y de Stripe', () => {
  const ids = ['partner', 'amount', 'fee', 'formError', 'simulate', 'reject', 'blocker', 'totalLabel', 'total', 'platformLabel', 'platform', 'commission', 'partnerLabel', 'partnerBalance', 'balanceNote', 'paymentState', 'payload', 'copyPayload', 'refundAmount', 'refund', 'refundAll', 'refundRepeat', 'events', 'repeat', 'download', 'reset', 'surState', 'onboard', 'live', 'contact', 'payments', 'partners', 'launch', 'tab-payments', 'tab-partners', 'tab-launch', 'localSimulation', 'stripeSandbox'];
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`));
  const attrs = ['data-amount', 'data-percent', 'data-checkout', 'data-refresh', 'data-new-checkout', 'data-stripe-result', 'data-stripe-refund-panel', 'data-refund-amount', 'data-refund', 'data-stripe-body', 'data-stripe-description', 'data-stripe-status'];
  for (const attr of attrs) assert.match(html, new RegExp(attr));
  assert.match(html, /class="badge"/);
  assert.match(html, /class="scope/);
  assert.match(html, /class="tabs"/);
  assert.match(html, /https:\/\/github.com\/simplificando-roberto\/partners-lab-roberto/);
  assert.match(html, /4242 4242 4242 4242/);
  assert.match(html, /Detalles técnicos/);
  assert.doesNotMatch(html, /historial inventado/);
  assert.doesNotMatch(html, /stripe-reference-v2\.png/);
  assert.match(html, /Cuentas, roles y accesos/);
  assert.match(html, /INSAIDR/);
  assert.match(html, /Proposia/);
  assert.match(html, /Facturación IA/);
});

test('Stripe UI conserva sesión, idempotencia, allowlist y DTO', () => {
  assert.match(stripe, /\/api\/config/);
  assert.match(stripe, /\/api\/session/);
  assert.match(stripe, /\/api\/checkout/);
  assert.match(stripe, /\/api\/refund/);
  assert.match(stripe, /\/api\/payment/);
  assert.match(stripe, /crypto\.randomUUID/);
  assert.match(stripe, /checkout\.stripe\.com/);
  assert.match(stripe, /idempotency_key/);
  assert.match(stripe, /platform_net_cents/);
  assert.match(stripe, /partner_pending_cents/);
  assert.match(stripe, /application_fee_refunded_cents/);
  assert.match(stripe, /verified_webhook_event_id/);
  assert.match(stripe, /stripe_balance_status/);
  assert.match(stripe, /No consultado/);
  assert.match(stripe, /Disponible/);
  assert.match(stripe, /Detalles técnicos/);
  assert.match(stripe, /comisión antes de costes de Stripe/);
  assert.match(stripe, /test_only/);
  assert.match(app, /localSimulation/);
  assert.match(app, /openSim/);
});
