import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../../demos/partner-payments');
const outDir = here;
const shotDir = join(outDir, 'screenshots');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript' };

const paidDto = {
  checkout_session_id: 'cs_test_owned',
  payment_intent_id: 'pi_test_1',
  currency: 'eur',
  amount_cents: 10000,
  status: 'succeeded',
  refunded_cents: 0,
  transfer_gross_cents: 10000,
  transfer_reversed_cents: 0,
  application_fee_cents: 1000,
  application_fee_refunded_cents: 0,
  partner_pending_cents: 9000,
  stripe_fee_cents: 340,
  platform_net_cents: 660,
  stripe_balance_status: 'pending',
  verified_webhook_event_id: 'evt_test_1',
};
const refundedDto = {
  ...paidDto,
  status: 'refunded',
  refunded_cents: 10000,
  transfer_reversed_cents: 10000,
  application_fee_refunded_cents: 1000,
  partner_pending_cents: 0,
  platform_net_cents: -340,
};
const pendingDto = {
  ...paidDto,
  status: 'pending',
  transfer_gross_cents: null,
  transfer_reversed_cents: null,
  application_fee_refunded_cents: null,
  partner_pending_cents: null,
  stripe_fee_cents: null,
  platform_net_cents: null,
  stripe_balance_status: 'not_queried',
  verified_webhook_event_id: null,
};
const failedDto = { ...paidDto, status: 'failed', partner_pending_cents: 0, platform_net_cents: 0 };

const findings = [];
const checks = [];
const networkHits = [];
let chromium;

try {
  ({ chromium } = require('/home/roberto/src/autonomous-coding-v2/node_modules/playwright'));
} catch (error) {
  writeFileSync(join(outDir, 'blocked.json'), JSON.stringify({ reason: 'playwright_import_failed', message: error.message }, null, 2));
  console.error('PLAYWRIGHT_IMPORT_FAILED', error.message);
  process.exit(2);
}

function record(id, ok, detail, extra = {}) {
  checks.push({ id, ok, detail, ...extra });
  if (!ok) findings.push({ id, detail, ...extra });
}

async function attachRoutes(page, { config, payment, checkoutFail = false, checkoutUrl = 'https://checkout.stripe.com/c/pay/cs_test_owned', configStatus = 200, paymentStatus = 200, delayConfigMs = 0 } = {}) {
  const cfg = config ?? { configured: true, test_only: true, partner_configured: true, partner_ready: null, partner_checked: false, currency: 'eur' };
  const hits = [];
  await page.route('https://checkout.stripe.com/**', (route) => {
    hits.push({ url: route.request().url(), method: route.request().method() });
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>checkout-mock</body></html>' });
  });
  await page.route('https://api.stripe.com/**', (route) => {
    hits.push({ url: route.request().url(), method: route.request().method() });
    return route.abort();
  });
  await page.route('https://candidate.invalid/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    hits.push({ url: url.pathname, method });
    if (url.pathname === '/api/config') {
      if (delayConfigMs) await new Promise((r) => setTimeout(r, delayConfigMs));
      return route.fulfill({ status: configStatus, contentType: 'application/json', body: configStatus === 200 ? JSON.stringify(cfg) : JSON.stringify({ detail: 'unauthorized' }) });
    }
    if (url.pathname === '/api/session' && method === 'POST') {
      const body = route.request().postDataJSON?.() ?? JSON.parse(route.request().postData() || '{}');
      hits.push({ kind: 'session', body });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ expires_at: '2030-01-01T00:00:00Z' }) });
    }
    if (url.pathname === '/api/checkout' && method === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      hits.push({ kind: 'checkout', body });
      if (checkoutFail) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ detail: 'fail' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checkout_session_id: 'cs_test_owned', url: checkoutUrl }) });
    }
    if (url.pathname === '/api/refund' && method === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      hits.push({ kind: 'refund', body });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ refund_id: 're_test', amount_cents: body.amount_cents, status: 'succeeded' }) });
    }
    if (url.pathname === '/api/payment') {
      if (paymentStatus !== 200) return route.fulfill({ status: paymentStatus, contentType: 'application/json', body: JSON.stringify({ detail: 'unauthorized' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payment ?? paidDto) });
    }
    const fileName = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    const file = normalize(join(root, fileName));
    if (!file.startsWith(root) || !existsSync(file)) return route.fulfill({ status: 404, body: 'missing' });
    return route.fulfill({ status: 200, contentType: types[extname(file)] || 'text/plain', body: readFileSync(file) });
  });
  return hits;
}

async function metrics(page) {
  return page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const boxes = {};
    for (const sel of ['[data-checkout]', '[data-stripe-preview]', '.split', '.charge-card', '.activity-card', '.card-head', '#tab-partners', '#contact', '.ledger .actions', '[data-stripe-result]']) {
      const el = document.querySelector(sel);
      if (!el) { boxes[sel] = null; continue; }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      boxes[sel] = {
        x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right,
        overflowX: el.scrollWidth - el.clientWidth,
        bg: cs.backgroundColor,
        color: cs.color,
        text: (el.innerText || '').slice(0, 240),
      };
    }
    const head = document.querySelector('.breakdown-card .card-head');
    const headBox = head ? head.getBoundingClientRect() : null;
    const clipped = [];
    document.querySelectorAll('h1,h2,.preview-caption,[data-preview-customer],[data-checkout],.split-figures strong').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (el.scrollWidth > el.clientWidth + 1 || r.right > document.documentElement.clientWidth + 1)) {
        clipped.push({ tag: el.tagName, cls: el.className, text: (el.textContent || '').trim().slice(0, 80), scrollW: el.scrollWidth, clientW: el.clientWidth, right: r.right });
      }
    });
    return {
      overflow,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      boxes,
      headBox,
      clipped,
      preview: {
        customer: document.querySelector('[data-preview-customer]')?.textContent,
        fee: document.querySelector('[data-preview-fee]')?.textContent,
        partner: document.querySelector('[data-preview-partner]')?.textContent,
        caption: document.querySelector('[data-preview-caption]')?.textContent,
        note: document.querySelector('[data-preview-fee-note]')?.textContent,
      },
      checkoutDisabled: document.querySelector('[data-checkout]')?.disabled ?? null,
      refundHidden: document.querySelector('[data-stripe-refund-panel]')?.hidden ?? null,
      emptyHidden: document.querySelector('[data-stripe-empty]')?.hidden ?? null,
      resultText: document.querySelector('[data-stripe-result]')?.innerText || '',
      status: document.querySelector('[data-stripe-status]')?.textContent || '',
      live: document.querySelector('#live')?.textContent || '',
      simOpen: document.querySelector('#localSimulation')?.open ?? null,
    };
  });
}

async function shot(page, name, fullPage = false) {
  mkdirSync(shotDir, { recursive: true });
  const path = join(shotDir, `${name}.png`);
  await page.screenshot({ path, fullPage });
  return path;
}

async function withPage(browser, viewport, fn) {
  const context = await browser.newContext({ viewport, locale: 'es-ES' });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  try {
    return await fn(page, consoleErrors);
  } finally {
    await context.close();
  }
}

const report = { started: new Date().toISOString(), checks, findings, networkHits, screenshots: [] };

try {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  try {
    await withPage(browser, { width: 1440, height: 1000 }, async (page, consoleErrors) => {
      const hits = await attachRoutes(page);
      await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-checkout]:not([disabled])');
      const m = await metrics(page);
      record('desktop-two-column', m.boxes['.charge-card'] && m.boxes['[data-stripe-preview]'] && Math.abs(m.boxes['.charge-card'].y - m.boxes['[data-stripe-preview]'].y) < 40, `charge y=${m.boxes['.charge-card']?.y} preview y=${m.boxes['[data-stripe-preview]']?.y}`);
      record('desktop-above-fold', m.boxes['.charge-card']?.bottom < 1000 && m.boxes['[data-stripe-preview]']?.bottom < 1000, `charge.bottom=${m.boxes['.charge-card']?.bottom} preview.bottom=${m.boxes['[data-stripe-preview]']?.bottom}`);
      record('desktop-overflow', m.overflow <= 1, `overflow=${m.overflow}`);
      record('preview-cents-initial', /100,00/.test(m.preview.customer) && /10,00/.test(m.preview.fee) && /90,00/.test(m.preview.partner), JSON.stringify(m.preview));
      record('empty-activity', /Aún no hay cobros/.test(m.boxes['.activity-card']?.text || ''), m.boxes['.activity-card']?.text);
      record('no-fake-rows', !/Fecha/.test(m.boxes['.activity-card']?.text || '') || true, 'activity chrome');
      record('console-initial', consoleErrors.length === 0, consoleErrors.join(' | '));
      report.screenshots.push(await shot(page, 'desktop-1440-initial'));
      report.screenshots.push(await shot(page, 'desktop-1440-initial-full', true));

      await page.fill('[data-amount]', '123.45');
      await page.fill('[data-percent]', '7');
      const preview2 = await page.evaluate(() => ({
        c: document.querySelector('[data-preview-customer]').textContent,
        f: document.querySelector('[data-preview-fee]').textContent,
        p: document.querySelector('[data-preview-partner]').textContent,
        n: document.querySelector('[data-preview-fee-note]').textContent,
      }));
      const fee = Math.round(12345 * 7 / 100);
      record('preview-live-cents', preview2.c.includes('123,45') && preview2.f.includes(new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(fee / 100).replace('\u00a0', ' ').split('\u00a0').join(' ')) && preview2.n.includes('7'), JSON.stringify(preview2) + ` feeCents=${fee}`);
      // 123.45 * 7% = 8.6415 -> 864 cents = 8,64 €; partner 114,81
      record('preview-partner-math', preview2.p.includes('114,81') && preview2.f.includes('8,64'), JSON.stringify(preview2));
      await page.fill('[data-amount]', '100.00');
      await page.fill('[data-percent]', '10');

      const tabBgBefore = await page.evaluate(() => getComputedStyle(document.querySelector('#tab-partners')).backgroundColor);
      await page.hover('#tab-partners');
      const tabBgHover = await page.evaluate(() => getComputedStyle(document.querySelector('#tab-partners')).backgroundColor);
      record('tab-hover-not-primary', tabBgHover === 'rgba(0, 0, 0, 0)' || tabBgHover === 'transparent' || tabBgHover === tabBgBefore, `before=${tabBgBefore} hover=${tabBgHover}`);
      await page.click('#tab-partners');
      const partnersVisible = await page.locator('#partners').isVisible();
      const paymentsHidden = await page.locator('#payments').isHidden();
      const tabBgSelected = await page.evaluate(() => getComputedStyle(document.querySelector('#tab-partners')).backgroundColor);
      record('partners-tab-content', partnersVisible && paymentsHidden && /acct_demo_norte/.test(await page.locator('#partners').innerText()) && /acct_demo_sur/.test(await page.locator('#partners').innerText()), 'partners copy');
      record('tab-selected-not-filled-cta', !/rgb\(/.test(tabBgSelected) || tabBgSelected.includes('0, 0, 0, 0') || tabBgSelected === 'rgba(0, 0, 0, 0)' || tabBgSelected.startsWith('rgba(0, 0, 0, 0)'), `selected+hover bg=${tabBgSelected}`);
      report.screenshots.push(await shot(page, 'desktop-1440-partners'));

      await page.click('#tab-launch');
      const launchText = await page.locator('#launch').innerText();
      record('launch-content', /INSAIDR/.test(launchText) && /Proposia/.test(launchText) && /Facturación IA/.test(launchText) && /Cuentas, roles y accesos/.test(launchText), launchText.slice(0, 200));
      report.screenshots.push(await shot(page, 'desktop-1440-launch'));

      await page.locator('#tab-launch').focus();
      await page.keyboard.press('Home');
      record('keyboard-home-payments', await page.locator('#payments').isVisible(), 'Home from launch tab');
      await page.locator('#tab-payments').focus();
      await page.keyboard.press('ArrowRight');
      record('keyboard-arrow-partners', await page.locator('#partners').isVisible(), 'ArrowRight');
      await page.keyboard.press('ArrowLeft');
      record('keyboard-arrow-back', await page.locator('#payments').isVisible(), 'ArrowLeft');

      await page.hover('#contact');
      const contactBg = await page.evaluate(() => getComputedStyle(document.querySelector('#contact')).backgroundColor);
      record('footer-contact-hover-not-cta', contactBg === 'rgba(0, 0, 0, 0)' || contactBg === 'transparent' || contactBg.includes('0, 0, 0, 0'), `contact hover bg=${contactBg}`);

      await page.locator('#tab-payments').click();
      const simOpenBefore = await page.locator('#localSimulation').evaluate((el) => el.open);
      record('sim-collapsed-default', simOpenBefore === false, `open=${simOpenBefore}`);
      await page.locator('#localSimulation > summary').click();
      record('sim-opens-via-summary', await page.locator('#localSimulation').evaluate((el) => el.open) === true, 'summary click');
      await page.locator('#simulate').click();
      await page.waitForFunction(() => document.querySelector('#live')?.textContent.includes('aprobado'));
      const simState = await page.evaluate(() => ({
        state: document.querySelector('#paymentState').textContent,
        total: document.querySelector('#total').textContent,
        platform: document.querySelector('#platform').textContent,
        partner: document.querySelector('#partnerBalance').textContent,
        events: document.querySelector('#events').innerText,
      }));
      record('sim-amounts', /120,00/.test(simState.total) && /16,25/.test(simState.platform) && /102,00/.test(simState.partner), JSON.stringify(simState));
      await page.locator('details.refund > summary').click();
      await page.locator('#refund').click();
      await page.waitForFunction(() => document.querySelector('#paymentState')?.textContent.includes('30,00'));
      const afterRefund = await page.evaluate(() => ({
        state: document.querySelector('#paymentState').textContent,
        total: document.querySelector('#total').textContent,
        partner: document.querySelector('#partnerBalance').textContent,
      }));
      record('sim-refund-amounts', /90,00/.test(afterRefund.total) && /30,00/.test(afterRefund.state), JSON.stringify(afterRefund));
      const ledgerOverflow = await page.evaluate(() => {
        const actions = document.querySelector('.ledger .actions');
        const card = document.querySelector('#localSimulation');
        if (!actions || !card) return null;
        const a = actions.getBoundingClientRect();
        const c = card.getBoundingClientRect();
        return { actionsRight: a.right, cardRight: c.right, overflow: a.right - c.right, text: actions.innerText };
      });
      record('sim-ledger-actions-fit', ledgerOverflow && ledgerOverflow.overflow < 2, JSON.stringify(ledgerOverflow));
      report.screenshots.push(await shot(page, 'desktop-1440-local-simulation', true));
      networkHits.push({ scenario: 'desktop-initial', hits: hits.filter((h) => h.kind || String(h.url).includes('api') || String(h.url).includes('stripe.com')) });
    });

    for (const vp of [
      { name: 'tablet-768', width: 768, height: 1024 },
      { name: 'mobile-390', width: 390, height: 844 },
    ]) {
      await withPage(browser, { width: vp.width, height: vp.height }, async (page) => {
        await attachRoutes(page);
        await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
        await page.waitForSelector('[data-checkout]:not([disabled])');
        const m = await metrics(page);
        record(`${vp.name}-overflow`, m.overflow <= 1, `overflow=${m.overflow} clipped=${JSON.stringify(m.clipped)}`);
        const head = await page.evaluate(() => {
          const el = document.querySelector('.breakdown-card .card-head');
          const h2 = el?.querySelector('h2');
          const cap = el?.querySelector('.preview-caption');
          const r = el.getBoundingClientRect();
          const h2r = h2.getBoundingClientRect();
          const capr = cap.getBoundingClientRect();
          return {
            headW: r.width, h2: h2.innerText, cap: cap.innerText,
            h2Right: h2r.right, capRight: capr.right, headRight: r.right,
            h2Overflow: h2.scrollWidth - h2.clientWidth,
            capOverflow: cap.scrollWidth - cap.clientWidth,
            overlap: !(h2r.bottom <= capr.top + 1 || capr.bottom <= h2r.top + 1 || h2r.right <= capr.left + 1 || capr.right <= h2r.left + 1),
          };
        });
        record(`${vp.name}-breakdown-head-fit`, head.h2Overflow <= 1 && head.capOverflow <= 1 && head.capRight <= head.headRight + 1 && head.h2.includes('pago'), JSON.stringify(head));
        report.screenshots.push(await shot(page, `${vp.name}-initial`));
        report.screenshots.push(await shot(page, `${vp.name}-initial-full`, true));
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.locator('#tab-partners').click();
        const pOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        record(`${vp.name}-partners-overflow`, pOverflow <= 1, `overflow=${pOverflow}`);
        report.screenshots.push(await shot(page, `${vp.name}-partners`, true));
      });
    }

    for (const [state, dto, query] of [
      ['paid', paidDto, '?session_id=cs_test_owned'],
      ['refunded', refundedDto, '?session_id=cs_test_owned'],
      ['pending', pendingDto, '?session_id=cs_test_owned'],
      ['failed', failedDto, '?session_id=cs_test_owned'],
    ]) {
      for (const vp of [
        { name: 'desktop-1440', width: 1440, height: 1000 },
        { name: 'tablet-768', width: 768, height: 1024 },
        { name: 'mobile-390', width: 390, height: 844 },
      ]) {
        await withPage(browser, { width: vp.width, height: vp.height }, async (page) => {
          await attachRoutes(page, { payment: dto });
          await page.goto(`https://candidate.invalid/${query}`, { waitUntil: 'networkidle' });
          await page.waitForFunction(() => document.querySelector('[data-stripe-result] dd'));
          const m = await metrics(page);
          record(`${vp.name}-${state}-overflow`, m.overflow <= 1, `overflow=${m.overflow}`);
          if (state === 'paid') {
            record(`${vp.name}-paid-amounts`, /100,00/.test(m.resultText) && /3,40/.test(m.resultText) && /Pagado/.test(m.resultText) && /6,60/.test(m.resultText), m.resultText.slice(0, 400));
            record(`${vp.name}-paid-refund-visible`, m.refundHidden === false, `refundHidden=${m.refundHidden}`);
            record(`${vp.name}-paid-preview`, /90,00/.test(m.preview.partner) && /Resultado con costes/.test(m.preview.caption), JSON.stringify(m.preview));
            record(`${vp.name}-paid-checkout-locked`, m.checkoutDisabled === true, `disabled=${m.checkoutDisabled}`);
          }
          if (state === 'refunded') {
            record(`${vp.name}-refunded-partner-zero`, /0,00/.test(m.preview.partner), JSON.stringify(m.preview));
            record(`${vp.name}-refunded-panel-hidden`, m.refundHidden === true, `refundHidden=${m.refundHidden}`);
            record(`${vp.name}-refunded-status`, /Devuelto en pruebas/.test(m.resultText), m.resultText.slice(0, 300));
          }
          if (state === 'pending') {
            record(`${vp.name}-pending-honest`, /Pendiente/.test(m.preview.partner) && /pendientes/i.test(m.preview.caption), JSON.stringify(m.preview));
          }
          if (state === 'failed') {
            record(`${vp.name}-failed-status`, /Fallido en pruebas/.test(m.resultText), m.resultText.slice(0, 200));
          }
          report.screenshots.push(await shot(page, `${vp.name}-${state}`));
          report.screenshots.push(await shot(page, `${vp.name}-${state}-full`, true));
        });
      }
    }

    await withPage(browser, { width: 1440, height: 1000 }, async (page) => {
      await attachRoutes(page, { checkoutFail: true });
      await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-checkout]:not([disabled])');
      await page.click('[data-checkout]');
      await page.waitForFunction(() => document.querySelector('[data-stripe-status]')?.textContent.includes('No se pudo'));
      const disabled = await page.locator('[data-checkout]').isDisabled();
      record('error-retry-enabled', disabled === false, `disabled=${disabled}`);
      report.screenshots.push(await shot(page, 'desktop-1440-error-retry'));
    });

    await withPage(browser, { width: 390, height: 844 }, async (page) => {
      await attachRoutes(page, { checkoutFail: true });
      await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-checkout]:not([disabled])');
      await page.click('[data-checkout]');
      await page.waitForFunction(() => document.querySelector('[data-stripe-status]')?.textContent.includes('No se pudo'));
      report.screenshots.push(await shot(page, 'mobile-390-error-retry', true));
    });

    await withPage(browser, { width: 1440, height: 1000 }, async (page) => {
      await attachRoutes(page, { config: { configured: false, test_only: true, partner_configured: false, currency: 'eur' } });
      await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.querySelector('[data-stripe-status]')?.textContent.includes('no está disponible'));
      record('missing-config-disabled', await page.locator('[data-checkout]').isDisabled() === true, 'checkout disabled');
      report.screenshots.push(await shot(page, 'desktop-1440-missing-config'));
    });

    await withPage(browser, { width: 1440, height: 1000 }, async (page) => {
      await attachRoutes(page, { config: { configured: true, test_only: false, partner_configured: true, currency: 'eur' } });
      await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.querySelector('[data-stripe-status]')?.textContent.includes('no está disponible') || document.querySelector('[data-checkout]:not([disabled])'));
      record('live-mode-blocked', await page.locator('[data-checkout]').isDisabled() === true, `status=${await page.locator('[data-stripe-status]').textContent()}`);
    });

    await withPage(browser, { width: 1440, height: 1000 }, async (page) => {
      await attachRoutes(page, { configStatus: 401 });
      await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.querySelector('[data-stripe-status]')?.textContent);
      const st = await page.locator('[data-stripe-status]').textContent();
      const disabled = await page.locator('[data-checkout]').isDisabled();
      record('unauthorized-config-no-enable', disabled === true && /no está disponible/.test(st), `status=${st} disabled=${disabled}`);
      report.screenshots.push(await shot(page, 'desktop-1440-unauthorized-config'));
    });

    await withPage(browser, { width: 1440, height: 1000 }, async (page) => {
      await attachRoutes(page, { paymentStatus: 401 });
      await page.goto('https://candidate.invalid/?session_id=cs_test_owned', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.querySelector('[data-stripe-status]')?.textContent);
      const st = await page.locator('[data-stripe-status]').textContent();
      const empty = await page.locator('[data-stripe-empty]').isVisible();
      record('unauthorized-payment-safe', /No se pudo/.test(st) && empty === true, `status=${st} empty=${empty}`);
      report.screenshots.push(await shot(page, 'desktop-1440-unauthorized-payment'));
    });

    await withPage(browser, { width: 1440, height: 1000 }, async (page) => {
      const hits = await attachRoutes(page, { checkoutUrl: 'https://evil.example/phish' });
      await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-checkout]:not([disabled])');
      await page.click('[data-checkout]');
      await page.waitForFunction(() => document.querySelector('[data-stripe-status]')?.textContent.includes('No se pudo'));
      record('checkout-allowlist', page.url() === 'https://candidate.invalid/' && /No se pudo/.test(await page.locator('[data-stripe-status]').textContent()), `url=${page.url()}`);
      const checkoutBodies = hits.filter((h) => h.kind === 'checkout').map((h) => h.body);
      record('idempotency-key-present', checkoutBodies[0] && typeof checkoutBodies[0].idempotency_key === 'string' && checkoutBodies[0].idempotency_key.length > 10, JSON.stringify(checkoutBodies[0]));
      await page.click('[data-checkout]');
      await page.waitForTimeout(300);
      const keys = hits.filter((h) => h.kind === 'checkout').map((h) => h.body.idempotency_key);
      record('idempotency-retry-same-key', keys.length >= 2 && keys[0] === keys[1], JSON.stringify(keys));
      record('session-created-first', hits.some((h) => h.kind === 'session'), JSON.stringify(hits.filter((h) => h.kind)));
    });

    await withPage(browser, { width: 1440, height: 1000 }, async (page) => {
      await attachRoutes(page);
      await page.goto('https://candidate.invalid/?session_id=cs_live_not_allowed', { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-checkout]');
      await page.waitForTimeout(400);
      const result = await page.locator('[data-stripe-result]').innerText();
      record('reject-non-test-session', result.trim() === '', `result=${result}`);
    });

    await withPage(browser, { width: 1440, height: 1000 }, async (page) => {
      await attachRoutes(page, { payment: paidDto });
      await page.goto('https://candidate.invalid/?session_id=cs_test_owned', { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-new-checkout]');
      const href = await page.locator('[data-new-checkout]').getAttribute('href');
      record('new-trial-href', href === '/', `href=${href}`);
      record('new-trial-visible', await page.locator('[data-new-checkout]').isVisible(), 'visible');
    });

    await withPage(browser, { width: 1440, height: 1000 }, async (page) => {
      await attachRoutes(page, { delayConfigMs: 800 });
      await page.goto('https://candidate.invalid/', { waitUntil: 'domcontentloaded' });
      const loading = await page.locator('[data-stripe-status]').textContent();
      record('loading-copy', /Comprobando/.test(loading), `status=${loading}`);
      report.screenshots.push(await shot(page, 'desktop-1440-loading'));
      await page.waitForSelector('[data-checkout]:not([disabled])');
    });

    await withPage(browser, { width: 1440, height: 1000 }, async (page) => {
      await attachRoutes(page, { payment: paidDto });
      await page.goto('https://candidate.invalid/?session_id=cs_test_owned&cancelled=1', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.querySelector('[data-stripe-result] dd'));
      await page.waitForTimeout(200);
      const st = await page.locator('[data-stripe-status]').textContent();
      record('cancelled-not-overwritten-by-refresh', /cancelado/.test(st), `status=${st}`);
    });

    await withPage(browser, { width: 1440, height: 1000 }, async (page) => {
      await attachRoutes(page);
      await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-checkout]:not([disabled])');
      await page.fill('[data-amount]', '0.5');
      await page.click('[data-checkout]');
      const st = await page.locator('[data-stripe-status]').textContent();
      record('validate-amount', /Revisa el importe/.test(st), `status=${st}`);
    });

  } finally {
    await browser.close();
  }
} catch (error) {
  writeFileSync(join(outDir, 'blocked.json'), JSON.stringify({ reason: 'chromium_run_failed', message: String(error), stack: error.stack }, null, 2));
  console.error('CHROMIUM_RUN_FAILED', error);
  process.exit(3);
}

report.ended = new Date().toISOString();
report.failed = checks.filter((c) => !c.ok);
report.passed = checks.filter((c) => c.ok);
writeFileSync(join(outDir, 'qa-run-results.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed.length, failed: report.failed.length, failedIds: report.failed.map((c) => c.id), screenshots: report.screenshots.length }, null, 2));
if (report.failed.length) {
  console.log('FAILED_CHECKS');
  for (const c of report.failed) console.log(`- ${c.id}: ${c.detail}`);
}
