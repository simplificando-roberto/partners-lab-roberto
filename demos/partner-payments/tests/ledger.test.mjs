import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoLedger } from '../ledger.mjs';

const paid = () => { const l = new DemoLedger(); l.createPayment({ partnerId: 'norte', amountCents: 10001, feePercent: 15 }); l.settle(); return l; };
test('calcula dinero en céntimos y no duplica un webhook', () => {
  const l = paid(); assert.deepEqual(l.balances, { customer: 10001, platform: 1325, partnerPending: 8501, feesProcessed: 175 });
  assert.equal(l.settle().duplicate, true); assert.equal(l.balances.customer, 10001);
});
test('un pago rechazado no contabiliza saldo', () => {
  const l = new DemoLedger(); l.createPayment({ partnerId: 'norte', amountCents: 1000, feePercent: 10 }); l.settle({ outcome: 'rejected' });
  assert.equal(l.balances.customer, 0); assert.equal(l.payment.status, 'rejected');
});
test('refunds parciales acumulan redondeo y coste procesado no se devuelve', () => {
  const l = paid(); l.refund(3333); l.refund(6668);
  assert.equal(l.payment.refundedCents, 10001); assert.equal(l.balances.customer, 0); assert.equal(l.balances.partnerPending, 0);
  assert.equal(l.balances.platform, -175); assert.equal(l.balances.feesProcessed, 175);
});
test('bloquea sobre-reembolso, importe negativo y clave duplicada', () => {
  const l = paid(); assert.throws(() => l.refund(10002)); assert.throws(() => l.refund(-1));
  l.refund(1000, 'demo-ref'); const before = l.balances.customer; assert.equal(l.refund(1000, 'demo-ref').duplicate, true); assert.equal(l.balances.customer, before);
});
test('el alta simulada se expresa fuera del ledger y el adapter inicia limpio', () => {
  const l = new DemoLedger(); assert.equal(l.events.length, 0); assert.equal(l.evidence().simulated, true);
});
test('un pago activo no se reemplaza hasta reiniciar', () => {
  const l = new DemoLedger(); l.createPayment({ partnerId: 'norte', amountCents: 100, feePercent: 10 });
  assert.throws(() => l.createPayment({ partnerId: 'sur', amountCents: 200, feePercent: 10 })); l.reset();
  assert.doesNotThrow(() => l.createPayment({ partnerId: 'sur', amountCents: 200, feePercent: 10 }));
});
test('un replay completo se acepta antes del límite y un importe distinto se rechaza', () => {
  const l = paid(); l.refund(10001, 'full'); assert.equal(l.refund(10001, 'full').duplicate, true);
  assert.throws(() => l.refund(1, 'full'));
});
test('los parciales conservan cada céntimo entre cliente, comisión y transfer', () => {
  const l = new DemoLedger(); l.createPayment({ partnerId: 'norte', amountCents: 11, feePercent: 50, stripeCostCents: 0 }); l.settle();
  for (const amount of [1, 3, 2, 5]) { const before = { ...l.balances }; const r = l.refund(amount, `part-${amount}-${l.payment.refundedCents}`); assert.equal(r.transferReversal + r.feeReturn, amount); assert.equal(before.customer - l.balances.customer, amount); }
  assert.equal(l.balances.customer + l.balances.platform + l.balances.partnerPending, 0);
});
