/* Optional Stripe TEST sandbox UI. It is deliberately independent from the simulated ledger. */
const host = document.querySelector('#payments');

if (host) {
  const body = document.querySelector('[data-stripe-body]');
  const description = document.querySelector('[data-stripe-description]');
  const status = document.querySelector('[data-stripe-status]');
  const empty = document.querySelector('[data-stripe-empty]');
  const expressRoot = document.querySelector('[data-express-root]');
  const params = new URLSearchParams(location.search);
  const partnerReturn = params.get('partner_return') === '1';
  const partnerRefresh = params.get('partner_refresh') === '1';
  const returnedSession = params.get('session_id');
  let sessionCreated = false;
  let currentPayment = null;
  let pendingCheckout = null;
  let pendingRefund = null;
  let pendingOnboarding = null;
  let enabled = false;
  let partnerAccount = null;
  let partnerConfigured = false;
  let expressAvailable = false;
  let sessionExpired = false;
  let mutationsInFlight = 0;
  let resetBusy = false;

  const setStatus = (message) => { if (status) status.textContent = message; };
  const pending = (value) => value == null ? 'Pendiente' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value / 100);
  const money = (cents) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  const balanceStatus = (value) => ({ pending: 'Pendiente', available: 'Disponible', not_queried: 'No consultado' }[value] || 'Pendiente');
  const STRIPE_RATE_BPS = 150;
  const STRIPE_FIXED_CENTS = 25;
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
    if (!response.ok) {
      if (response.status === 401) {
        const next = `${location.pathname}${location.search}`;
        location.replace(`/login?next=${encodeURIComponent(next)}`);
      }
      const error = new Error('api');
      error.status = response.status;
      throw error;
    }
    return response.json();
  };

  document.querySelector('[data-logout]')?.addEventListener('click', async () => {
    try {
      const response = await fetch('/api/logout', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Origin': location.origin},
        credentials: 'same-origin',
        body: JSON.stringify({}),
      });
      if (response.ok || response.status === 401) {
        location.replace('/login');
        return;
      }
      setStatus('No se pudo cerrar la sesión.');
    } catch {
      setStatus('No se pudo cerrar la sesión.');
    }
  });
  const post = (url, payload) => {
    if (resetBusy && url !== '/api/session/reset') {
      const error = new Error('reset');
      error.status = 409;
      return Promise.reject(error);
    }
    return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  };
  const checkoutId = () => returnedSession && /^cs_test_[A-Za-z0-9_]+$/.test(returnedSession) ? returnedSession : null;
  const amountInput = () => body.querySelector('[data-amount]');
  const percentInput = () => body.querySelector('[data-percent]');
  const ensureSession = async () => {
    if (!sessionCreated) {
      await post('/api/session', {});
      sessionCreated = true;
    }
  };
  const hostedOnboarding = (href) => {
    const url = new URL(href);
    return url.protocol === 'https:' && (url.hostname === 'connect.stripe.com' || url.hostname.endsWith('.connect.stripe.com'));
  };
  const stateLabel = (value) => ({
    ready: 'Lista para cobros',
    incomplete: 'Alta incompleta',
    restricted: 'Cuenta restringida',
    pending: 'Pendiente en Stripe',
  }[value] || 'Sin cuenta Express');
  const yesNo = (value) => value ? 'Activas' : 'No activas';
  const openPartners = () => document.querySelector('#tab-partners')?.click();

  const recipientCopy = () => {
    if (partnerAccount) {
      if (partnerAccount.transfers_active) return `Destino del cobro: tu cuenta Express asociada ${partnerAccount.id}. Es una cuenta de prueba de esta sesión TEST; el partner recibe el importe en su saldo de Stripe.`;
      return `Checkout bloqueado: la cuenta Express ${partnerAccount.id} aún no está lista para recibir cobros. Continúa el alta.`;
    }
    if (partnerConfigured) return 'Destino del cobro: cuenta Custom de prueba del sandbox. No es tu cuenta; al activar Express se usará la cuenta asociada de esta sesión.';
    return 'Checkout bloqueado: activa cobros con Stripe en Partners.';
  };

  const syncCheckout = () => {
    const checkout = body?.querySelector('[data-checkout]');
    const recipient = document.querySelector('[data-checkout-recipient]');
    if (recipient) recipient.textContent = recipientCopy();
    if (!checkout || !enabled) return;
    const returned = Boolean(checkoutId());
    const destinationReady = partnerAccount ? partnerAccount.transfers_active === true : partnerConfigured;
    checkout.disabled = returned || !destinationReady;
    amountInput().disabled = returned;
    percentInput().disabled = returned;
  };

  const renderExpress = () => {
    if (!expressRoot) return;
    const statusEl = expressRoot.querySelector('[data-express-status]');
    const details = expressRoot.querySelector('[data-express-details]');
    const activate = expressRoot.querySelector('[data-express-activate]');
    const resume = expressRoot.querySelector('[data-express-continue]');
    const set = (name, value) => { const node = expressRoot.querySelector(`[data-express-${name}]`); if (node) node.textContent = value; };
    if (!expressAvailable) {
      if (statusEl) statusEl.textContent = 'El alta Express está pendiente de configuración.';
      if (activate) activate.disabled = true;
      if (resume) resume.hidden = true;
      if (details) details.hidden = true;
      return;
    }
    if (sessionExpired) {
      if (statusEl) statusEl.textContent = 'La sesión de demo caducó. Recarga la página para empezar otra.';
      if (activate) activate.disabled = true;
      if (resume) resume.hidden = true;
      if (details) details.hidden = true;
      return;
    }
    if (!partnerAccount) {
      if (statusEl) statusEl.textContent = 'Aún no hay cuenta Express en esta sesión. Stripe recogerá los datos TEST.';
      if (details) details.hidden = true;
      if (activate) { activate.hidden = false; activate.disabled = false; }
      if (resume) resume.hidden = true;
      return;
    }
    if (statusEl) statusEl.textContent = partnerAccount.transfers_active
      ? 'Cuenta lista para recibir transferencias de prueba. Los payouts bancarios son independientes y no se prueban aquí.'
      : 'Alta empezada. Vuelve a Stripe si el enlace caducó o faltan requisitos.';
    if (details) details.hidden = false;
    set('id', partnerAccount.id || 'Pendiente');
    set('state', stateLabel(partnerAccount.status));
    set('transfers', yesNo(partnerAccount.transfers_active));
    set('payouts', partnerAccount.payouts_enabled ? 'Habilitados' : 'No habilitados');
    set('requirements', String(partnerAccount.requirements_due ?? 0));
    if (activate) activate.hidden = true;
    if (resume) {
      resume.hidden = partnerAccount.transfers_active === true;
      resume.disabled = false;
    }
  };

  const loadPartner = async () => {
    try {
      await ensureSession();
      const data = await api('/api/partner');
      partnerAccount = data.account || null;
      sessionExpired = false;
    } catch (error) {
      if (error.status === 403) {
        sessionExpired = true;
        partnerAccount = null;
      } else throw error;
    }
    renderExpress();
    syncCheckout();
  };

  const startOnboarding = async () => {
    const activate = expressRoot?.querySelector('[data-express-activate]');
    const resume = expressRoot?.querySelector('[data-express-continue]');
    const statusEl = expressRoot?.querySelector('[data-express-status]');
    if (resetBusy) {
      if (statusEl) statusEl.textContent = 'Espera a que termine el reinicio de la demo.';
      return;
    }
    if (activate) activate.disabled = true;
    if (resume) resume.disabled = true;
    mutationsInFlight += 1;
    try {
      await ensureSession();
      if (!pendingOnboarding) pendingOnboarding = { key: uuid() };
      const created = await post('/api/partner/onboarding', {});
      partnerAccount = created.account || partnerAccount;
      renderExpress();
      syncCheckout();
      if (!hostedOnboarding(created.url)) throw new Error('url');
      location.assign(created.url);
    } catch (error) {
      const message = error.status === 403
        ? 'La sesión de demo caducó. Recarga la página para empezar otra.'
        : safeError();
      if (statusEl) statusEl.textContent = message;
      if (activate) activate.disabled = false;
      if (resume) resume.disabled = false;
    } finally {
      mutationsInFlight = Math.max(0, mutationsInFlight - 1);
    }
  };

  const updatePreview = () => {
    if (currentPayment) return;
    const euros = Number(amountInput()?.value);
    const percent = Number(percentInput()?.value);
    const amountCents = Math.round(euros * 100);
    if (!Number.isFinite(euros) || !Number.isSafeInteger(amountCents) || euros < 0 || !Number.isFinite(percent)) return;
    const fee = Math.round(amountCents * percent / 100);
    const stripeEstimate = Math.round(amountCents * STRIPE_RATE_BPS / 10000) + STRIPE_FIXED_CENTS;
    const customer = body.querySelector('[data-preview-customer]');
    const feeEl = body.querySelector('[data-preview-fee]');
    const partnerEl = body.querySelector('[data-preview-partner]');
    const stripeEl = body.querySelector('[data-preview-stripe]');
    const stripeLabel = body.querySelector('[data-preview-stripe-label]');
    const netEl = body.querySelector('[data-preview-net]');
    const note = body.querySelector('[data-preview-fee-note]');
    const caption = body.querySelector('[data-preview-caption]');
    if (customer) customer.textContent = money(amountCents);
    if (feeEl) feeEl.textContent = money(fee);
    if (partnerEl) partnerEl.textContent = money(amountCents - fee);
    if (stripeEl) stripeEl.textContent = money(stripeEstimate);
    if (stripeLabel) stripeLabel.textContent = 'Coste Stripe estimado';
    if (netEl) netEl.textContent = money(fee - stripeEstimate);
    if (note) note.textContent = `Comisión que gana la plataforma (${percent} %)`;
    if (caption) caption.textContent = 'Vista previa · incluye una estimación del coste Stripe';
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
      ['Importe bruto cliente', pending(payment.amount_cents)],
      ['Devuelto', pending(payment.refunded_cents)],
      ['Comisión plataforma bruta', pending(payment.application_fee_cents)],
      ['Comisión Stripe', pending(payment.stripe_fee_cents)],
      ['Neto plataforma', pending(payment.platform_net_cents)],
      ['Importe partner', pending(payment.partner_pending_cents)],
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
    const stripeEl = body.querySelector('[data-preview-stripe]');
    const stripeNote = body.querySelector('[data-preview-stripe-note]');
    const stripeLabel = body.querySelector('[data-preview-stripe-label]');
    const netEl = body.querySelector('[data-preview-net]');
    const netNote = body.querySelector('[data-preview-net-note]');
    const assumption = body.querySelector('[data-preview-assumption]');
    const caption = body.querySelector('[data-preview-caption]');
    if (customer) customer.textContent = pending(payment.amount_cents);
    if (feeEl) feeEl.textContent = pending(payment.application_fee_cents);
    if (partnerEl) partnerEl.textContent = pending(payment.partner_pending_cents);
    if (stripeEl) stripeEl.textContent = pending(payment.stripe_fee_cents);
    if (stripeLabel) stripeLabel.textContent = payment.stripe_fee_cents == null ? 'Coste Stripe pendiente' : 'Coste Stripe confirmado';
    if (netEl) netEl.textContent = pending(payment.platform_net_cents);
    if (stripeNote) stripeNote.textContent = payment.stripe_fee_cents == null ? 'Coste real aún no informado' : 'Coste real informado por Stripe';
    if (netNote) netNote.textContent = payment.platform_net_cents == null ? 'Comisión y coste aún pendientes' : refunded ? 'Comisión bruta − comisión devuelta − coste Stripe' : 'Comisión bruta − coste real Stripe';
    const pct = payment.application_fee_cents == null || !payment.amount_cents ? '' : ` (${Math.round(payment.application_fee_cents * 100 / payment.amount_cents)} %)`;
    if (refunded) {
      if (feeLabel) feeLabel.textContent = 'Comisión bruta';
      if (note) note.textContent = `Comisión plataforma original${pct}; comisión de aplicación devuelta`;
      if (partnerNote) partnerNote.textContent = 'Importe restante en el saldo del partner';
    } else {
      if (feeLabel) feeLabel.textContent = 'Comisión';
      if (note) note.textContent = `Comisión plataforma original${pct}`;
      if (partnerNote) partnerNote.textContent = 'Importe en el saldo del partner';
    }
    if (caption) caption.textContent = payment.stripe_fee_cents == null ? 'Resultado del pago · costes de Stripe pendientes' : 'Resultado del pago · coste real informado por Stripe';
    if (assumption) assumption.innerHTML = payment.stripe_fee_cents == null
      ? 'Stripe todavía no ha informado el coste real de esta operación. Actualiza el resultado para consultarlo.'
      : 'Coste real de Stripe para esta operación, no una estimación. Las tarifas pueden variar por tarjeta, divisa, cuenta y Connect.';
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
    if (description) description.textContent = 'Sandbox TEST. Destino Express de esta sesión si existe; si no, cuenta Custom de prueba.';
    const checkout = body.querySelector('[data-checkout]');
    const refund = body.querySelector('[data-refund]');
    const refreshButton = body.querySelector('[data-refresh]');
    const newCheckout = body.querySelector('[data-new-checkout]');
    refund.disabled = true;
    refreshButton.hidden = !checkoutId();
    newCheckout.hidden = !checkoutId();
    refreshButton.addEventListener('click', refresh);
    checkout.addEventListener('click', async () => {
      if (resetBusy) { setStatus('Espera a que termine el reinicio de la demo.'); return; }
      if (partnerAccount && !partnerAccount.transfers_active) {
        setStatus('Checkout bloqueado hasta que tu cuenta Express esté lista para recibir cobros.');
        return;
      }
      const euros = Number(amountInput().value);
      const percent = Number(percentInput().value);
      const amountCents = Math.round(euros * 100);
      if (!Number.isFinite(euros) || !Number.isSafeInteger(amountCents) || euros < 1 || euros > 500 || !Number.isInteger(percent) || percent < 0 || percent > 30) { setStatus('Revisa el importe y la comisión.'); return; }
      checkout.disabled = true;
      checkout.setAttribute('aria-busy', 'true');
      mutationsInFlight += 1;
      try {
        await ensureSession();
        const input = { amount_cents: amountCents, fee_percent: percent };
        const fingerprint = JSON.stringify(input);
        if (pendingCheckout?.fingerprint !== fingerprint) pendingCheckout = { fingerprint, key: uuid() };
        const created = await post('/api/checkout', { ...input, idempotency_key: pendingCheckout.key });
        const url = new URL(created.url);
        if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('url');
        location.assign(url.href);
      } catch (error) {
        setStatus(error.status === 409 ? 'Checkout bloqueado: continúa el alta Express en Partners.' : safeError());
        syncCheckout();
      }
      finally {
        mutationsInFlight = Math.max(0, mutationsInFlight - 1);
        checkout.removeAttribute('aria-busy');
      }
    });
    refund.addEventListener('click', async () => {
      if (resetBusy) { setStatus('Espera a que termine el reinicio de la demo.'); return; }
      const id = checkoutId();
      const cents = Math.round(Number(body.querySelector('[data-refund-amount]').value) * 100);
      const remaining = (currentPayment?.amount_cents || 0) - (currentPayment?.refunded_cents || 0);
      if (!id || !Number.isInteger(cents) || cents < 1 || cents > remaining) { setStatus('Indica un importe pendiente válido para devolver.'); return; }
      refund.disabled = true;
      mutationsInFlight += 1;
      try {
        const fingerprint = `${id}:${cents}:${currentPayment?.refunded_cents || 0}`;
        if (pendingRefund?.fingerprint !== fingerprint) pendingRefund = { fingerprint, key: uuid() };
        await post('/api/refund', { checkout_session_id: id, amount_cents: cents, idempotency_key: pendingRefund.key });
        setStatus('Devolución solicitada a Stripe.');
        await refresh();
      } catch (_) { setStatus(safeError()); }
      finally {
        mutationsInFlight = Math.max(0, mutationsInFlight - 1);
        refund.disabled = !currentPayment || currentPayment.status !== 'succeeded' || currentPayment.refunded_cents >= currentPayment.amount_cents;
      }
    });
    syncCheckout();
    if (checkoutId()) refresh();
    if (params.get('cancelled') === '1') setStatus('Checkout cancelado; no se ha realizado ningún cobro.');
  };

  const bindExpress = () => {
    if (!expressRoot || expressRoot.dataset.bound) return;
    expressRoot.dataset.bound = 'true';
    expressRoot.querySelector('[data-express-activate]')?.addEventListener('click', startOnboarding);
    expressRoot.querySelector('[data-express-continue]')?.addEventListener('click', startOnboarding);
  };

  amountInput()?.addEventListener('input', updatePreview);
  percentInput()?.addEventListener('input', updatePreview);
  updatePreview();

  if (partnerReturn || partnerRefresh) openPartners();

  if (location.protocol !== 'file:') {
    setStatus('Comprobando el entorno de pruebas…');
    api('/api/config').then(async (config) => {
      const testOnly = config.test_only !== false;
      partnerConfigured = config.partner_configured === true;
      expressAvailable = config.express_available === true && testOnly;
      const paymentsReady = config.configured && testOnly && (partnerConfigured || expressAvailable);
      bindExpress();
      renderExpress();
      if (paymentsReady) {
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
      if (expressAvailable) {
        try {
          if (partnerRefresh) {
            openPartners();
            await startOnboarding();
            return;
          }
          await loadPartner();
          if (partnerReturn) openPartners();
        } catch (_) {
          const statusEl = expressRoot?.querySelector('[data-express-status]');
          if (statusEl) statusEl.textContent = safeError();
        }
      } else {
        syncCheckout();
      }
      if (partnerReturn || partnerRefresh) {
        const clean = new URL(location.href);
        clean.searchParams.delete('partner_return');
        clean.searchParams.delete('partner_refresh');
        history.replaceState({}, '', `${clean.pathname}${clean.search}${clean.hash}`);
      }
    }).catch(() => setStatus('El sandbox no está disponible en este entorno.'));
  }

  const resetCopy = 'Se borra la sesión de demo de este navegador, la asociación Express y la simulación local. Stripe conserva las cuentas y los pagos; los reembolsos no son automáticos. Si has pagado, reembolsa antes: al reiniciar perderás el acceso al resultado de esta sesión.';
  const resetButton = document.querySelector('[data-reset-demo]');
  const resetStatus = document.querySelector('[data-reset-status]');
  const showResetStatus = (message) => {
    if (resetStatus) {
      resetStatus.hidden = !message;
      resetStatus.textContent = message || '';
    }
    const live = document.querySelector('#live');
    if (live && message) live.textContent = message;
    setStatus(message);
  };
  if (resetButton && resetButton.dataset.resetBound !== 'true') {
  resetButton.dataset.resetBound = 'true';
  resetButton.addEventListener('click', async () => {
    if (resetBusy) return;
    if (mutationsInFlight > 0) {
      showResetStatus('Espera a que termine el cobro, la devolución o el alta Express en curso. Luego puedes reiniciar la demo.');
      return;
    }
    resetBusy = true;
    if (!window.confirm(resetCopy)) {
      resetBusy = false;
      return;
    }
    resetButton.disabled = true;
    try {
      if (location.protocol === 'file:') {
        location.reload();
        return;
      }
      await post('/api/session/reset', {});
      location.replace('/');
    } catch (_) {
      showResetStatus('No se pudo reiniciar la demo. El estado se ha conservado; inténtalo de nuevo.');
      resetBusy = false;
      resetButton.disabled = false;
    }
  });
  }
}
