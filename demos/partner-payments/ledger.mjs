/** Local payment-lifecycle adapter. Replace its methods with a FastAPI endpoint:
 * createCheckout(input), receiveWebhook(event, signature), createRefund(input).
 * The backend must verify Stripe's signature and persist idempotency keys.
 */
export const euros = cents => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const round = value => Math.round(value);

export class DemoLedger {
  constructor({ now = () => '2026-09-10T10:00:00.000Z' } = {}) { this.now = now; this.reset(); }
  reset() {
    this.events = []; this.payment = null; this.seen = new Set(); this.sequence = 0; this.refundKeys = new Map();
    this.balances = { customer: 0, platform: 0, partnerPending: 0, feesProcessed: 0 };
  }
  record(type, data = {}, key = `${type}_${this.sequence + 1}`) {
    if (this.seen.has(key)) return { duplicate: true, event: this.events.find(e => e.key === key) };
    const event = { id: `demo_evt_${String(++this.sequence).padStart(4, '0')}`, key, type, at: this.now(), ...data };
    this.seen.add(key); this.events.push(event); return { duplicate: false, event };
  }
  createPayment({ partnerId, amountCents, feePercent, stripeCostCents = 175 }) {
    if (this.payment) throw new Error('Ya hay una transacción activa. Reinicia la demo para crear otra.');
    if (!['norte', 'sur'].includes(partnerId)) throw new Error('El partner no pertenece al contrato de esta demo.');
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('El importe debe ser un número entero de céntimos mayor que cero.');
    if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100) throw new Error('La comisión debe estar entre 0 y 100%.');
    if (!Number.isSafeInteger(stripeCostCents) || stripeCostCents < 0) throw new Error('El coste ilustrativo debe ser un número entero no negativo de céntimos.');
    const feeCents = round(amountCents * feePercent / 100);
    const transferCents = amountCents - feeCents;
    this.payment = { id: `demo_pay_${String(this.sequence + 1).padStart(4, '0')}`, partnerId, amountCents, feePercent, feeCents, transferCents, stripeCostCents, refundedCents: 0, status: 'pending' };
    this.record('payment.pending', { paymentId: this.payment.id, amountCents }, `payment:${this.payment.id}:pending`);
    return this.payment;
  }
  settle({ outcome = 'approved', key } = {}) {
    if (!this.payment) throw new Error('Primero crea un cobro.');
    const idempotencyKey = key ?? `payment:${this.payment.id}:settled`;
    if (this.payment.status !== 'pending' && !this.seen.has(idempotencyKey)) throw new Error('Este cobro ya se resolvió.');
    const logged = this.record(outcome === 'approved' ? 'payment.succeeded' : 'payment.rejected', { paymentId: this.payment.id }, idempotencyKey);
    if (logged.duplicate) return { duplicate: true, payment: this.payment };
    if (outcome !== 'approved') { this.payment.status = 'rejected'; return { payment: this.payment }; }
    this.payment.status = 'succeeded';
    this.balances.customer += this.payment.amountCents;
    this.balances.platform += this.payment.feeCents - this.payment.stripeCostCents;
    this.balances.partnerPending += this.payment.transferCents;
    this.balances.feesProcessed += this.payment.stripeCostCents;
    return { payment: this.payment };
  }
  refund(amountCents, key) {
    if (!this.payment || this.payment.status !== 'succeeded') throw new Error('Solo puedes reembolsar un cobro aprobado.');
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('El reembolso debe ser un importe positivo en céntimos.');
    const idempotencyKey = key ?? `refund:${this.payment.id}:${this.payment.refundedCents}:${amountCents}`;
    const prior = this.refundKeys.get(idempotencyKey);
    if (prior) {
      if (prior.amountCents !== amountCents) throw new Error('La misma clave de reembolso no puede reutilizarse con otro importe.');
      return { duplicate: true, payment: this.payment };
    }
    const remaining = this.payment.amountCents - this.payment.refundedCents;
    if (amountCents > remaining) throw new Error(`El máximo reembolsable es ${euros(remaining)}.`);
    const logged = this.record('refund.succeeded', { paymentId: this.payment.id, amountCents }, idempotencyKey);
    if (logged.duplicate) return { duplicate: true, payment: this.payment };
    this.refundKeys.set(idempotencyKey, { amountCents });
    // Cumulative proportional allocation: preserves rounding across partial refunds.
    const before = this.payment.refundedCents;
    const after = before + amountCents;
    const feeReturn = round(this.payment.feeCents * after / this.payment.amountCents) - round(this.payment.feeCents * before / this.payment.amountCents);
    const transferReversal = amountCents - feeReturn;
    this.payment.refundedCents = after;
    this.balances.customer -= amountCents;
    this.balances.partnerPending -= transferReversal;
    this.balances.platform -= feeReturn;
    return { payment: this.payment, transferReversal, feeReturn };
  }
  evidence() { return { simulated: true, payment: this.payment, balances: this.balances, ledger: this.events }; }
}
