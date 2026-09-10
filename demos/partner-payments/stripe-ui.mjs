/* Optional Stripe TEST sandbox UI. It is deliberately independent from the simulated ledger. */
const host = document.querySelector('#payments');

if (host) {
  const body = document.querySelector('[data-stripe-body]');
  const description = document.querySelector('[data-stripe-description]');
  const status = document.querySelector('[data-stripe-status]');
  const empty = document.querySelector('[data-stripe-empty]');
  const params = new URLSearchParams(location.search);
  const returnedSession = params.get('session_id');
  let sessionCreated = false;
  let currentPayment = null;
  let pendingCheckout = null;
  let pendingRefund = null;
  let enabled = false;

  const setStatus = (message) => { if (status) status.textContent = message; };
  const pending = (value) => value == null ? 'Pendiente' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value / 100);
  const money = (cents) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  const balanceStatus = (value) => ({ pending: 'Pendiente', available: 'Disponible', not_queried: 'No consultado' }[value] || 'Pendiente');
  const paymentStatus = (value) => ({ succeeded: 'Pagado en pruebas', pending: 'Pendiente de pago', refunded: 'Devuelto en pruebas', failed: 'Fallido en pruebas' }[value] || 'Pendiente');
  const appendRows = (list, rows, grouped = false) => {
    rows.forEach(([label, value]) => {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label;
      dd.textContent = value;
      if (grouped) {
        const wrap = document.createElement('div');
        wrap.append(dt, dd);
        list.append(wrap);
      } else list.append(dt, dd);
    });
  };
  const uuid = () => crypto.randomUUID();
  const safeError = () => 'No se pudo completar la operación con Stripe. Comprueba el sandbox e inténtalo de nuevo.';
  const api = async (url, options = {}) => {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    if (!response.ok) throw new Error('api');
    return response.json();
  };
  const post = (url, payload) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const checkoutId = () => returnedSession && /^cs_test_[A-Za-z0-9_]+$/.test(returnedSession) ? returnedSession : null;
  const amountInput = () => body.querySelector('[data-amount]');
  const percentInput = () => body.querySelector('[data-percent]');

  const updatePreview = () => {
    if (currentPayment) return;
    const euros = Number(amountInput()?.value);
    const percent = Number(percentInput()?.value);
    const amountCents = Math.round(euros * 100);
    if (!Number.isFinite(euros) || !Number.isSafeInteger(amountCents) || euros < 0 || !Number.isFinite(percent)) return;
    const fee = Math.round(amountCents * percent / 100);
    const customer = body.querySelector('[data-preview-customer]');
    const feeEl = body.querySelector('[data-preview-fee]');
    const partnerEl = body.querySelector('[data-preview-partner]');
    const note = body.querySelector('[data-preview-fee-note]');
    const caption = body.querySelector('[data-preview-caption]');
    if (customer) customer.textContent = money(amountCents);
    if (feeEl) feeEl.textContent = money(fee);
    if (partnerEl) partnerEl.textContent = money(amountCents - fee);
    if (note) note.textContent = `Para la plataforma (${percent} %)`;
    if (caption) caption.textContent = 'Vista previa · antes de costes de Stripe';
  };

  const renderPayment = (payment) => {
    currentPayment = payment;
    amountInput().value = payment.amount_cents == null ? '' : String(payment.amount_cents / 100);
    percentInput().value = payment.application_fee_cents == null || !payment.amount_cents ? '' : String(Math.round(payment.application_fee_cents * 100 / payment.amount_cents));
    const remaining = Math.max(0, (payment.amount_cents || 0) - (payment.refunded_cents || 0));
    const refunded = (payment.refunded_cents || 0) > 0 || payment.status === 'refunded';
    const result = body.querySelector('[data-stripe-result]');
    result.replaceChildren();
    const summary = document.createElement('dl');
    summary.className = 'result-grid';
    appendRows(summary, [
      ['Importe', pending(payment.amount_cents)],
      ['Devuelto', pending(payment.refunded_cents)],
      ['Comisión de plataforma', pending(payment.application_fee_cents)],
      ['Comisión Stripe', pending(payment.stripe_fee_cents)],
      ['Neto plataforma', pending(payment.platform_net_cents)],
      ['Pendiente partner', pending(payment.partner_pending_cents)],
      ['Estado', paymentStatus(payment.status)],
    ], true);
    const details = document.createElement('details');
    details.className = 'tech-details';
    const detailsSummary = document.createElement('summary');
    detailsSummary.textContent = 'Detalles técnicos';
    const detailList = document.createElement('dl');
    appendRows(detailList, [
      ['Transferencia bruta', pending(payment.transfer_gross_cents)],
      ['Transferencia revertida', pending(payment.transfer_reversed_cents)],
      ['Comisión de plataforma devuelta', pending(payment.application_fee_refunded_cents)],
      ['Estado de saldo Stripe', balanceStatus(payment.stripe_balance_status)],
      ['Webhook verificado', payment.verified_webhook_event_id || 'Webhook pendiente'],
      ['ID de Checkout', payment.checkout_session_id || 'Pendiente'],
      ['ID de pago', payment.payment_intent_id || 'Pendiente'],
    ]);
    details.append(detailsSummary, detailList);
    result.append(summary, details);
    if (empty) empty.hidden = true;
    const customer = body.querySelector('[data-preview-customer]');
    const feeEl = body.querySelector('[data-preview-fee]');
    const partnerEl = body.querySelector('[data-preview-partner]');
    const feeLabel = body.querySelector('[data-preview-fee-label]');
    const note = body.querySelector('[data-preview-fee-note]');
    const partnerNote = body.querySelector('[data-preview-partner-note]');
    const caption = body.querySelector('[data-preview-caption]');
    if (customer) customer.textContent = pending(payment.amount_cents);
    if (feeEl) feeEl.textContent = pending(payment.application_fee_cents);
    if (partnerEl) partnerEl.textContent = pending(payment.partner_pending_cents);
    const pct = payment.application_fee_cents == null || !payment.amount_cents ? '' : ` (${Math.round(payment.application_fee_cents * 100 / payment.amount_cents)} %)`;
    if (refunded) {
      if (feeLabel) feeLabel.textContent = 'Comisión bruta';
      if (note) note.textContent = `Bruta para la plataforma${pct}`;
      if (partnerNote) partnerNote.textContent = 'Importe restante';
    } else {
      if (feeLabel) feeLabel.textContent = 'Comisión';
      if (note) note.textContent = `Para la plataforma${pct}`;
      if (partnerNote) partnerNote.textContent = 'Importe que recibe';
    }
    if (caption) caption.textContent = payment.stripe_fee_cents == null ? 'Costes de Stripe pendientes' : 'Resultado del pago · comisión antes de costes de Stripe';
    const refundAmount = body.querySelector('[data-refund-amount]');
    const refundButton = body.querySelector('[data-refund]');
    const refundPanel = body.querySelector('[data-stripe-refund-panel]');
    refundAmount.max = String(remaining / 100);
    refundButton.disabled = payment.status !== 'succeeded' || remaining < 1;
    refundPanel.hidden = payment.status !== 'succeeded' || remaining < 1;
  };

  const refresh = async () => {
    const id = checkoutId();
    if (!id) return;
    body.setAttribute('aria-busy', 'true');
    try { renderPayment(await api(`/api/payment?session_id=${encodeURIComponent(id)}`)); setStatus('Información de Stripe actualizada.'); }
    catch (_) { setStatus(safeError()); }
    finally { body.removeAttribute('aria-busy'); }
  };

  const enable = () => {
    if (enabled || !body) return;
    enabled = true;
    if (description) description.textContent = 'Sandbox TEST con partner configurado. Cuenta Custom de prueba; el alta Express no está incluida.';
    const checkout = body.querySelector('[data-checkout]');
    const refund = body.querySelector('[data-refund]');
    const refreshButton = body.querySelector('[data-refresh]');
    const newCheckout = body.querySelector('[data-new-checkout]');
    refund.disabled = true;
    checkout.disabled = Boolean(checkoutId());
    refreshButton.hidden = !checkoutId();
    newCheckout.hidden = !checkoutId();
    amountInput().disabled = Boolean(checkoutId());
    percentInput().disabled = Boolean(checkoutId());
    refreshButton.addEventListener('click', refresh);
    checkout.addEventListener('click', async () => {
      const euros = Number(amountInput().value);
      const percent = Number(percentInput().value);
      const amountCents = Math.round(euros * 100);
      if (!Number.isFinite(euros) || !Number.isSafeInteger(amountCents) || euros < 1 || euros > 500 || !Number.isInteger(percent) || percent < 0 || percent > 30) { setStatus('Revisa el importe y la comisión.'); return; }
      checkout.disabled = true;
      checkout.setAttribute('aria-busy', 'true');
      try {
        if (!sessionCreated) { await post('/api/session', {}); sessionCreated = true; }
        const input = { amount_cents: amountCents, fee_percent: percent };
        const fingerprint = JSON.stringify(input);
        if (pendingCheckout?.fingerprint !== fingerprint) pendingCheckout = { fingerprint, key: uuid() };
        const created = await post('/api/checkout', { ...input, idempotency_key: pendingCheckout.key });
        const url = new URL(created.url);
        if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('url');
        location.assign(url.href);
      } catch (_) { setStatus(safeError()); checkout.disabled = false; }
      finally { checkout.removeAttribute('aria-busy'); }
    });
    refund.addEventListener('click', async () => {
      const id = checkoutId();
      const cents = Math.round(Number(body.querySelector('[data-refund-amount]').value) * 100);
      const remaining = (currentPayment?.amount_cents || 0) - (currentPayment?.refunded_cents || 0);
      if (!id || !Number.isInteger(cents) || cents < 1 || cents > remaining) { setStatus('Indica un importe pendiente válido para devolver.'); return; }
      refund.disabled = true;
      try {
        const fingerprint = `${id}:${cents}:${currentPayment?.refunded_cents || 0}`;
        if (pendingRefund?.fingerprint !== fingerprint) pendingRefund = { fingerprint, key: uuid() };
        await post('/api/refund', { checkout_session_id: id, amount_cents: cents, idempotency_key: pendingRefund.key });
        setStatus('Devolución solicitada a Stripe.');
        await refresh();
      } catch (_) { setStatus(safeError()); }
      finally { refund.disabled = !currentPayment || currentPayment.status !== 'succeeded' || currentPayment.refunded_cents >= currentPayment.amount_cents; }
    });
    if (checkoutId()) refresh();
    if (params.get('cancelled') === '1') setStatus('Checkout cancelado; no se ha realizado ningún cobro.');
  };

  amountInput()?.addEventListener('input', updatePreview);
  percentInput()?.addEventListener('input', updatePreview);
  updatePreview();

  if (location.protocol !== 'file:') {
    setStatus('Comprobando el entorno de pruebas…');
    api('/api/config').then((config) => {
      const testOnly = config.test_only !== false;
      if (config.configured && config.partner_configured && testOnly) {
        const badge = document.querySelector('.badge');
        const scope = document.querySelector('.scope');
        if (badge) badge.textContent = 'Sandbox';
        if (scope) scope.textContent = 'Prueba un cobro en el sandbox de Stripe o explora la simulación local.';
        setStatus('');
        enable();
      } else {
        setStatus('El sandbox no está disponible en este entorno. Puedes usar la simulación local.');
        body.querySelector('[data-checkout]').disabled = true;
      }
    }).catch(() => setStatus('El sandbox no está disponible en este entorno.'));
  }
}
