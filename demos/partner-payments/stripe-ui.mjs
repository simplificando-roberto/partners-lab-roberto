/* Optional Stripe TEST sandbox UI. It is deliberately independent from the simulated ledger. */
const host = document.querySelector('#payments');

if (host) {
  const details = document.createElement('details');
  details.className = 'inspector';
  details.id = 'stripeSandbox';
  details.hidden = true;
  details.innerHTML = `
    <summary>Stripe sandbox · cobro de prueba separado</summary>
    <div class="stripe-sandbox" data-stripe-body>
      <p data-stripe-description>El recorrido anterior es una simulación local. La conexión con Stripe se habilita al configurar el sandbox.</p>
      <p role="status" aria-live="polite" data-stripe-status></p>
    </div>`;
  host.prepend(details);

  const body = details.querySelector('[data-stripe-body]');
  const description = details.querySelector('[data-stripe-description]');
  const status = details.querySelector('[data-stripe-status]');
  const params = new URLSearchParams(location.search);
  const returnedSession = params.get('session_id');
  let sessionCreated = false;
  let currentPayment = null;
  let pendingCheckout = null;
  let pendingRefund = null;

  const setStatus = (message) => { status.textContent = message; };
  const pending = (value) => value == null ? 'Pendiente' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value / 100);
  const uuid = () => crypto.randomUUID();
  const safeError = () => 'No se pudo completar la operación con Stripe. Comprueba el sandbox e inténtalo de nuevo.';
  const api = async (url, options = {}) => {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    if (!response.ok) throw new Error('api');
    return response.json();
  };
  const post = (url, payload) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const checkoutId = () => returnedSession && /^cs_test_[A-Za-z0-9_]+$/.test(returnedSession) ? returnedSession : null;

  const renderPayment = (payment) => {
    currentPayment = payment;
    const remaining = Math.max(0, (payment.amount_cents || 0) - (payment.refunded_cents || 0));
    const result = body.querySelector('[data-stripe-result]');
    result.replaceChildren();
    const rows = [
      ['Importe', pending(payment.amount_cents)], ['Devuelto', pending(payment.refunded_cents)],
      ['Neto plataforma', pending(payment.platform_net_cents)], ['Pendiente partner', pending(payment.partner_pending_cents)],
      ['Comisión Stripe', pending(payment.stripe_fee_cents)], ['Estado', ({ succeeded: 'Pagado en pruebas', pending: 'Pendiente de pago', refunded: 'Devuelto en pruebas', failed: 'Fallido en pruebas' }[payment.status] || 'Pendiente')],
      ['Webhook verificado', payment.verified_webhook_event_id || 'Webhook pendiente'],
    ];
    const list = document.createElement('dl');
    rows.forEach(([label, value]) => { const dt = document.createElement('dt'); const dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; list.append(dt, dd); });
    result.append(list);
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
    try { renderPayment(await api(`/api/payment?session_id=${encodeURIComponent(id)}`)); setStatus('Información de Stripe actualizada.'); }
    catch (_) { setStatus(safeError()); }
  };

  const enable = () => {
    description.textContent = 'Paga con una tarjeta de prueba y consulta el reparto entre plataforma y partner. Usamos una cuenta Custom de prueba; el alta Express queda fuera de esta demostración.';
    const controls = document.createElement('div');
    controls.innerHTML = `
      <p class="stripe-card-help" id="stripe-card-help"><strong>Tarjeta de prueba:</strong> 4242 4242 4242 4242, una fecha futura y cualquier CVC. No uses datos personales.</p>
      <label>Importe (€) <input data-amount type="number" min="1" max="500" step="0.01" value="25.00" inputmode="decimal"></label>
      <label>Comisión (%) <input data-percent type="number" min="0" max="30" step="1" value="10" inputmode="numeric"></label>
      <div class="actions"><button type="button" data-checkout aria-describedby="stripe-card-help">Ir a Checkout de Stripe (prueba)</button>
      <button type="button" class="secondary" data-refresh>Actualizar resultado</button></div>
      <div data-stripe-result></div>
      <section class="stripe-refund" data-stripe-refund-panel hidden><h3>Reembolso en Stripe sandbox</h3><p>Disponible tras un pago de prueba confirmado. El reembolso se solicita a Stripe, no a la simulación local.</p>
      <label>Devolver (€) <input data-refund-amount type="number" min="0.01" step="0.01" inputmode="decimal"></label>
      <button type="button" data-refund>Devolver importe de prueba</button></section>`;
    body.append(controls);
    const checkout = controls.querySelector('[data-checkout]');
    const refund = controls.querySelector('[data-refund]');
    refund.disabled = true;
    checkout.disabled = Boolean(checkoutId());
    controls.querySelector('[data-refresh]').addEventListener('click', refresh);
    checkout.addEventListener('click', async () => {
      const euros = Number(controls.querySelector('[data-amount]').value);
      const percent = Number(controls.querySelector('[data-percent]').value);
      const amountCents = Math.round(euros * 100);
      if (!Number.isFinite(euros) || !Number.isSafeInteger(amountCents) || euros < 1 || euros > 500 || !Number.isInteger(percent) || percent < 0 || percent > 30) { setStatus('Revisa el importe y la comisión.'); return; }
      checkout.disabled = true;
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
    });
    refund.addEventListener('click', async () => {
      const id = checkoutId();
      const cents = Math.round(Number(controls.querySelector('[data-refund-amount]').value) * 100);
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
    if (checkoutId()) { details.open = true; refresh(); }
    if (params.get('cancelled') === '1') { details.open = true; setStatus('Checkout cancelado; no se ha realizado ningún cobro.'); }
  };

  if (location.protocol !== 'file:') {
    api('/api/config').then((config) => {
      if (config.configured && config.partner_configured) {
        document.querySelector('.badge').textContent = 'Stripe sandbox · sin dinero real';
        document.querySelector('.scope').textContent = 'Prueba un cobro real en el sandbox de Stripe o explora la simulación local.';
        details.hidden = false;
        details.open = true;
        enable();
      }
    }).catch(() => setStatus('El sandbox no está disponible en este entorno.'));
  }
}
