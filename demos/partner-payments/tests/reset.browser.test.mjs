import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotDir = join(root, '../../.agent/qa/reset-demo/screenshots');
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

const readyPartner = {
  id: 'acct_express',
  type: 'express',
  status: 'ready',
  transfers_active: true,
  payouts_enabled: false,
  details_submitted: true,
  requirements_due: 0,
};

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  try {
    ({ chromium } = require('/home/roberto/src/autonomous-coding-v2/node_modules/playwright'));
  } catch (error) {
    chromium = null;
    console.error('Playwright no está disponible:', error.message);
  }
}

async function attachRoutes(page, { resetStatus = 200, delayResetMs = 0, delayCheckoutMs = 0, partner = readyPartner } = {}) {
  const cfg = { configured: true, test_only: true, partner_configured: true, partner_ready: null, partner_checked: false, express_available: true, currency: 'eur' };
  const counts = { reset: 0, session: 0, checkout: 0, onboarding: 0, refund: 0 };
  let account = partner;
  await page.route('https://checkout.stripe.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>checkout</body></html>' }));
  await page.route('https://connect.stripe.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>onboarding</body></html>' }));
  await page.route('https://candidate.invalid/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/config') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cfg) });
    }
    if (url.pathname === '/api/session' && method === 'POST') {
      counts.session += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ expires_at: 4000000000 }) });
    }
    if (url.pathname === '/api/session/reset' && method === 'POST') {
      counts.reset += 1;
      if (delayResetMs) await new Promise((resolve) => setTimeout(resolve, delayResetMs));
      if (resetStatus !== 200) return route.fulfill({ status: resetStatus, contentType: 'application/json', body: JSON.stringify({ detail: 'fail' }) });
      account = null;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ expires_at: 4000000000 }) });
    }
    if (url.pathname === '/api/partner' && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ account }) });
    }
    if (url.pathname === '/api/partner/onboarding' && method === 'POST') {
      counts.onboarding += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://connect.stripe.com/setup/s/test', account: partner }) });
    }
    if (url.pathname === '/api/checkout' && method === 'POST') {
      counts.checkout += 1;
      if (delayCheckoutMs) await new Promise((resolve) => setTimeout(resolve, delayCheckoutMs));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checkout_session_id: 'cs_test_owned', url: 'https://checkout.stripe.com/c/pay/cs_test_owned' }) });
    }
    if (url.pathname === '/api/refund' && method === 'POST') {
      counts.refund += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ refund_id: 're_test', amount_cents: 1000, status: 'succeeded' }) });
    }
    if (url.pathname === '/api/payment') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(paidDto) });
    }
    const fileName = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    const file = normalize(join(root, fileName));
    if (!file.startsWith(root) || !existsSync(file)) return route.fulfill({ status: 404, body: 'missing' });
    return route.fulfill({ status: 200, contentType: types[extname(file)] || 'text/plain', body: readFileSync(file) });
  });
  return counts;
}

async function shot(page, name) {
  mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: false });
}

async function withPage(run) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
    await run(page);
  } finally {
    await browser.close();
  }
}

async function clickReset(page) {
  await page.evaluate(() => document.querySelector('[data-reset-demo]')?.click());
}

test('reset demo: cancel, confirm, error, no double POST, snapshots', { skip: !chromium, timeout: 180000 }, async () => {
  await withPage(async (page) => {
    const counts = await attachRoutes(page);
    page.on('dialog', (dialog) => dialog.dismiss());
    await page.goto('https://candidate.invalid/?session_id=cs_test_owned', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-stripe-result] dl');
    await page.locator('#localSimulation > summary').click();
    await page.locator('#simulate').click();
    await page.waitForFunction(() => document.querySelector('#live')?.textContent.includes('aprobado'));
    await page.locator('#tab-partners').click();
    assert.equal(await page.locator('[data-reset-demo]').isVisible(), true);
    await clickReset(page);
    await page.waitForTimeout(200);
    assert.match(await page.locator('[data-express-id]').innerText(), /acct_express/);
    assert.equal(counts.reset, 0);
    assert.match(page.url(), /session_id=cs_test_owned/);
  });

  await withPage(async (page) => {
    const counts = await attachRoutes(page);
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('https://candidate.invalid/?session_id=cs_test_owned', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-stripe-result] dl');
    await page.locator('#localSimulation > summary').click();
    await page.locator('#simulate').click();
    await page.waitForFunction(() => document.querySelector('#live')?.textContent.includes('aprobado'));
    await clickReset(page);
    await page.waitForURL('https://candidate.invalid/');
    assert.equal(counts.reset, 1);
    await page.waitForSelector('[data-stripe-empty]');
    assert.equal(await page.locator('[data-stripe-empty]').isVisible(), true);
    assert.doesNotMatch(page.url(), /session_id/);
    await page.locator('#tab-partners').click();
    await page.waitForFunction(() => document.querySelector('[data-express-status]')?.innerText.includes('Aún no hay cuenta Express') || document.querySelector('[data-express-activate]'));
  });

  await withPage(async (page) => {
    const counts = await attachRoutes(page, { resetStatus: 502 });
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('https://candidate.invalid/?session_id=cs_test_owned', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-stripe-result] dl');
    await clickReset(page);
    await page.waitForFunction(() => document.querySelector('[data-reset-status]')?.textContent.includes('conservado'));
    assert.equal(counts.reset, 1);
    assert.match(page.url(), /session_id=cs_test_owned/);
    assert.equal(await page.locator('[data-reset-demo]').isDisabled(), false);
    assert.match(await page.locator('[data-stripe-result]').innerText(), /Pagado en pruebas/);
  });

  await withPage(async (page) => {
    const counts = await attachRoutes(page, { delayResetMs: 400 });
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-checkout]:not([disabled])');
    const resetPosted = page.waitForRequest((req) => req.url().includes('/api/session/reset') && req.method() === 'POST');
    await Promise.all([clickReset(page), clickReset(page)]);
    await resetPosted;
    await page.waitForFunction(() => location.pathname === '/' && !location.search);
    assert.equal(counts.reset, 1);
  });

  await withPage(async (page) => {
    await attachRoutes(page, { delayCheckoutMs: 800 });
    let dialogs = 0;
    page.on('dialog', (dialog) => {
      dialogs += 1;
      dialog.dismiss();
    });
    await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-checkout]:not([disabled])');
    const checkout = page.waitForRequest((req) => req.url().includes('/api/checkout'));
    await page.locator('[data-checkout]').click();
    await checkout;
    await clickReset(page);
    await page.waitForFunction(() => document.querySelector('[data-reset-status]')?.textContent.includes('Espera'));
    assert.equal(dialogs, 0);
  });

  await withPage(async (page) => {
    const counts = await attachRoutes(page, { resetStatus: 502, delayResetMs: 900 });
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('https://candidate.invalid/?session_id=cs_test_owned', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-stripe-result] dl');
    await page.waitForSelector('[data-refund]:not([disabled])');
    await page.locator('[data-refund-amount]').fill('10');
    const resetPosted = page.waitForRequest((req) => req.url().includes('/api/session/reset') && req.method() === 'POST');
    await clickReset(page);
    await resetPosted;
    await page.evaluate(() => {
      const fire = (sel) => document.querySelector(sel)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      fire('[data-checkout]');
      fire('[data-express-activate]');
      fire('[data-express-continue]');
      fire('[data-refund]');
    });
    await page.waitForFunction(() => document.querySelector('[data-reset-status]')?.textContent.includes('conservado'));
    assert.equal(counts.reset, 1);
    assert.equal(counts.checkout, 0);
    assert.equal(counts.onboarding, 0);
    assert.equal(counts.refund, 0);
    const refundPosted = page.waitForRequest((req) => req.url().includes('/api/refund') && req.method() === 'POST');
    await page.locator('[data-refund]').click();
    await refundPosted;
    assert.equal(counts.refund, 1);
  });

  await withPage(async (page) => {
    await attachRoutes(page);
    await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-reset-demo]');
    await shot(page, 'desktop-1440-reset-control');
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, 'mobile-390-reset-control');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `overflow ${overflow}`);
  });
});
