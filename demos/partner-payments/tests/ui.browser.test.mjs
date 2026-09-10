import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotDir = join(root, '../../.agent/qa/redesign-v2/screenshots');
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
  refunded_cents: 0,
  transfer_gross_cents: null,
  transfer_reversed_cents: null,
  application_fee_cents: 1000,
  application_fee_refunded_cents: null,
  partner_pending_cents: null,
  stripe_fee_cents: null,
  platform_net_cents: null,
  stripe_balance_status: 'not_queried',
  verified_webhook_event_id: null,
};

let chromium;
try {
  ({ chromium } = require('/home/roberto/src/autonomous-coding-v2/node_modules/playwright'));
} catch (error) {
  chromium = null;
  console.error('Playwright no está disponible:', error.message);
}

async function attachRoutes(page, { config, payment, checkoutFail = false, checkoutUrl = 'https://checkout.stripe.com/c/pay/cs_test_owned' } = {}) {
  const cfg = config ?? { configured: true, test_only: true, partner_configured: true, partner_ready: null, partner_checked: false, currency: 'eur' };
  await page.route('https://checkout.stripe.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>checkout</body></html>' }));
  await page.route('https://candidate.invalid/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/config') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cfg) });
    }
    if (url.pathname === '/api/session' && method === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ expires_at: '2030-01-01T00:00:00Z' }) });
    }
    if (url.pathname === '/api/checkout' && method === 'POST') {
      if (checkoutFail) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ detail: 'fail' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checkout_session_id: 'cs_test_owned', url: checkoutUrl }) });
    }
    if (url.pathname === '/api/refund' && method === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ refund_id: 're_test', amount_cents: 3000, status: 'succeeded' }) });
    }
    if (url.pathname === '/api/payment') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payment ?? paidDto) });
    }
    const fileName = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    const file = normalize(join(root, fileName));
    if (!file.startsWith(root) || !existsSync(file)) return route.fulfill({ status: 404, body: 'missing' });
    return route.fulfill({ status: 200, contentType: types[extname(file)] || 'text/plain', body: readFileSync(file) });
  });
}

async function shot(page, name) {
  mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: false });
}

test('redesign browser: estados, pestañas, simulación y recortes', { skip: !chromium, timeout: 180000 }, async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();

    await attachRoutes(page);
    await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-checkout]:not([disabled])');
    assert.equal(await page.locator('h1').first().textContent(), 'Cobros que llegan a cada partner.');
    assert.equal(await page.locator('[data-amount]').inputValue(), '100.00');
    assert.equal(await page.locator('[data-percent]').inputValue(), '10');
    assert.match(await page.locator('[data-preview-customer]').innerText(), /100,00/);
    assert.match(await page.locator('[data-preview-fee]').innerText(), /10,00/);
    assert.match(await page.locator('[data-preview-partner]').innerText(), /90,00/);
    assert.match(await page.locator('[data-stripe-empty]').innerText(), /Aún no hay cobros/);
    assert.doesNotMatch(await page.locator('[data-stripe-empty]').innerText(), /historial inventado/);
    assert.match(await page.locator('#stripe-card-help').innerText(), /4242 4242 4242 4242/);
    assert.doesNotMatch(await page.locator('#stripe-card-help').innerText(), /Custom/);
    const checkoutBox = await page.locator('[data-checkout]').boundingBox();
    const breakdownBox = await page.locator('[data-stripe-preview]').boundingBox();
    assert.ok(checkoutBox && checkoutBox.y + checkoutBox.height < 1000);
    assert.ok(breakdownBox && breakdownBox.y + breakdownBox.height < 1000);
    await shot(page, 'desktop-1440x1000-initial');

    await page.setViewportSize({ width: 768, height: 1024 });
    await shot(page, 'tablet-768x1024-initial');

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `overflow ${overflow}`);
    await shot(page, 'mobile-390x844-initial');
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.locator('#tab-partners').click();
    assert.equal(await page.locator('#partners').isVisible(), true);
    assert.equal(await page.locator('#payments').isHidden(), true);
    await shot(page, 'desktop-1440x1000-partners');
    await page.locator('#tab-launch').click();
    assert.match(await page.locator('#launch').innerText(), /INSAIDR/);
    assert.match(await page.locator('#launch').innerText(), /Proposia/);
    assert.match(await page.locator('#launch').innerText(), /Facturación IA/);
    await shot(page, 'desktop-1440x1000-launch');
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#payments').isVisible(), true);

    await page.locator('#localSimulation > summary').click();
    assert.equal(await page.locator('#localSimulation').evaluate((el) => el.open), true);
    await page.locator('#simulate').click();
    await page.waitForFunction(() => document.querySelector('#live')?.textContent.includes('aprobado'));
    await page.locator('#repeat').click();
    await page.waitForFunction(() => document.querySelector('#live')?.textContent.includes('repetido') || document.querySelector('#live')?.textContent.includes('ignorado'));
    await page.locator('details.refund > summary').click();
    await page.locator('#refund').click();
    await page.waitForFunction(() => !document.querySelector('#refundRepeat')?.disabled);
    await page.locator('#refundRepeat').click();
    assert.equal(await page.locator('#localSimulation').evaluate((el) => el.open), true);
    await shot(page, 'desktop-1440x1000-local-simulation');
    await page.locator('#reset').click();
    assert.match(await page.locator('#live').innerText(), /reiniciada/);
    assert.equal(await page.locator('#amount').isDisabled(), false);

    await page.locator('[data-checkout]').click();
    await page.waitForURL(/checkout\.stripe\.com/);
  } finally {
    await browser.close();
  }

  const browser2 = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await (await browser2.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
    await attachRoutes(page, { payment: paidDto });
    await page.goto('https://candidate.invalid/?session_id=cs_test_owned', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('[data-stripe-result] dd'));
    assert.equal(await page.locator('[data-amount]').isDisabled(), true);
    assert.equal(await page.locator('[data-checkout]').isDisabled(), true);
    assert.equal(await page.locator('[data-new-checkout]').isVisible(), true);
    assert.match(await page.locator('[data-stripe-result]').innerText(), /Pagado en pruebas/);
    assert.match(await page.locator('[data-stripe-result]').innerText(), /3,40/);
    assert.doesNotMatch(await page.locator('[data-stripe-result]').innerText(), /\bpending\b/);
    assert.match(await page.locator('[data-preview-caption]').innerText(), /comisión antes de costes de Stripe/);
    assert.equal(await page.locator('[data-stripe-refund-panel]').isVisible(), true);
    await shot(page, 'desktop-1440x1000-paid');
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, 'mobile-390x844-paid');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[data-stripe-result] details.tech-details summary').click();
    assert.match(await page.locator('[data-stripe-result] details.tech-details').innerText(), /Pendiente/);
    assert.match(await page.locator('[data-stripe-result] details.tech-details').innerText(), /cs_test_owned/);
    assert.match(await page.locator('[data-stripe-result] details.tech-details').innerText(), /Transferencia bruta/);
  } finally {
    await browser2.close();
  }

  const browser3 = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await (await browser3.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
    await attachRoutes(page, { payment: refundedDto });
    await page.goto('https://candidate.invalid/?session_id=cs_test_owned', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('[data-stripe-result]')?.innerText.includes('Devuelto'));
    assert.equal(await page.locator('[data-stripe-refund-panel]').isHidden(), true);
    assert.match(await page.locator('[data-preview-fee-label]').innerText(), /Comisión bruta/);
    assert.match(await page.locator('[data-preview-partner-note]').innerText(), /restante/i);
    assert.match(await page.locator('[data-preview-caption]').innerText(), /comisión antes de costes de Stripe/);
    await shot(page, 'desktop-1440x1000-refunded');
  } finally {
    await browser3.close();
  }

  const browser4 = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await (await browser4.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
    await attachRoutes(page, { payment: pendingDto });
    await page.goto('https://candidate.invalid/?session_id=cs_test_owned', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('[data-stripe-result]')?.innerText.includes('Pendiente'));
    assert.match(await page.locator('[data-preview-caption]').innerText(), /pendientes/i);
    await shot(page, 'desktop-1440x1000-pending');
  } finally {
    await browser4.close();
  }

  const browser5 = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await (await browser5.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
    await attachRoutes(page, { checkoutFail: true });
    await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-checkout]:not([disabled])');
    await page.locator('[data-checkout]').click();
    await page.waitForFunction(() => document.querySelector('[data-stripe-status]')?.textContent.includes('No se pudo'));
    assert.equal(await page.locator('[data-checkout]').isDisabled(), false);
    await shot(page, 'desktop-1440x1000-error-retry');
    await page.locator('[data-checkout]').click();
    await page.waitForFunction(() => document.querySelector('[data-stripe-status]')?.textContent.includes('No se pudo'));
  } finally {
    await browser5.close();
  }

  const browser6 = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await (await browser6.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
    await attachRoutes(page, { config: { configured: false, test_only: true, partner_configured: false, currency: 'eur' } });
    await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('[data-stripe-status]')?.textContent.includes('no está disponible'));
    assert.equal(await page.locator('[data-checkout]').isDisabled(), true);
    await shot(page, 'desktop-1440x1000-missing-config');
  } finally {
    await browser6.close();
  }
});
