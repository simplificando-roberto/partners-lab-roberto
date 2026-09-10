import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotDir = join(root, '../../.agent/qa/express-onboarding/screenshots');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript' };

const incomplete = {
  id: 'acct_express',
  type: 'express',
  status: 'incomplete',
  transfers_active: false,
  payouts_enabled: false,
  details_submitted: false,
  requirements_due: 3,
};
const started = { ...incomplete, status: 'pending', requirements_due: 0 };
const ready = {
  id: 'acct_express',
  type: 'express',
  status: 'ready',
  transfers_active: true,
  payouts_enabled: false,
  details_submitted: true,
  requirements_due: 0,
};
const restricted = {
  id: 'acct_express',
  type: 'express',
  status: 'restricted',
  transfers_active: false,
  payouts_enabled: false,
  details_submitted: true,
  requirements_due: 2,
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

async function attachRoutes(page, {
  partner = null,
  onboardingAccount = incomplete,
  onboardingStatus = 200,
  sessionStatus = 200,
  partnerStatus = 200,
  checkoutStatus = 200,
} = {}) {
  const cfg = { configured: true, test_only: true, partner_configured: true, partner_ready: null, partner_checked: false, express_available: true, currency: 'eur' };
  await page.route('https://checkout.stripe.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>checkout</body></html>' }));
  await page.route('https://connect.stripe.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>onboarding</body></html>' }));
  await page.route('https://candidate.invalid/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/config') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cfg) });
    }
    if (url.pathname === '/api/session' && method === 'POST') {
      return route.fulfill({ status: sessionStatus, contentType: 'application/json', body: JSON.stringify(sessionStatus === 200 ? { expires_at: 4000000000 } : { detail: 'expired' }) });
    }
    if (url.pathname === '/api/partner' && method === 'GET') {
      return route.fulfill({ status: partnerStatus, contentType: 'application/json', body: JSON.stringify(partnerStatus === 200 ? { account: partner } : { detail: 'denied' }) });
    }
    if (url.pathname === '/api/partner/onboarding' && method === 'POST') {
      if (onboardingStatus !== 200) return route.fulfill({ status: onboardingStatus, contentType: 'application/json', body: JSON.stringify({ detail: 'fail' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://connect.stripe.com/setup/s/resume', account: onboardingAccount }) });
    }
    if (url.pathname === '/api/checkout' && method === 'POST') {
      if (checkoutStatus !== 200) return route.fulfill({ status: checkoutStatus, contentType: 'application/json', body: JSON.stringify({ detail: 'blocked' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checkout_session_id: 'cs_test_owned', url: 'https://checkout.stripe.com/c/pay/cs_test_owned' }) });
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

async function withPage(run) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
    await run(page);
  } finally {
    await browser.close();
  }
}

test('express onboarding: estados, return, resume y recortes', { skip: !chromium, timeout: 180000 }, async () => {
  await withPage(async (page) => {
    await attachRoutes(page, { partner: null });
    await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-checkout]:not([disabled])');
    assert.match(await page.locator('[data-checkout-recipient]').innerText(), /Custom/);
    await page.locator('#tab-partners').click();
    await page.waitForSelector('[data-express-activate]:not([disabled])');
    assert.match(await page.locator('[data-express-status]').innerText(), /Aún no hay cuenta Express/);
    assert.match(await page.locator('#partners').innerText(), /simulación local/i);
    await shot(page, 'desktop-1440-initial');
    await page.setViewportSize({ width: 768, height: 1024 });
    await shot(page, 'tablet-768-initial');
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `overflow ${overflow}`);
    await shot(page, 'mobile-390-initial');
  });

  await withPage(async (page) => {
    await attachRoutes(page, { partner: started, onboardingAccount: started });
    await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('[data-checkout]')?.disabled);
    await page.locator('#tab-partners').click();
    assert.equal(await page.locator('[data-express-continue]').isVisible(), true);
    assert.match(await page.locator('[data-express-state]').innerText(), /Pendiente/);
    await shot(page, 'desktop-1440-started');
  });

  await withPage(async (page) => {
    await attachRoutes(page, { partner: incomplete });
    await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('[data-checkout-recipient]')?.innerText.includes('bloqueado'));
    assert.equal(await page.locator('[data-checkout]').isDisabled(), true);
    await page.locator('#tab-partners').click();
    assert.match(await page.locator('[data-express-state]').innerText(), /incompleta/i);
    await shot(page, 'desktop-1440-incomplete');
    await page.setViewportSize({ width: 768, height: 1024 });
    await shot(page, 'tablet-768-incomplete');
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, 'mobile-390-incomplete');
  });

  await withPage(async (page) => {
    await attachRoutes(page, { partner: ready });
    await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-checkout]:not([disabled])');
    assert.match(await page.locator('[data-checkout-recipient]').innerText(), /acct_express/);
    assert.match(await page.locator('[data-checkout-recipient]').innerText(), /transfers activo/);
    await page.locator('#tab-partners').click();
    assert.match(await page.locator('[data-express-state]').innerText(), /Lista para cobros/);
    assert.equal(await page.locator('[data-express-continue]').isHidden(), true);
    assert.match(await page.locator('[data-express-payouts]').innerText(), /No habilitados/);
    await shot(page, 'desktop-1440-ready');
    await page.setViewportSize({ width: 768, height: 1024 });
    await shot(page, 'tablet-768-ready');
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, 'mobile-390-ready');
  });

  await withPage(async (page) => {
    await attachRoutes(page, { partner: restricted, checkoutStatus: 409 });
    await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('[data-checkout]')?.disabled);
    await page.locator('#tab-partners').click();
    assert.match(await page.locator('[data-express-state]').innerText(), /restringida/i);
    await shot(page, 'desktop-1440-restricted');
  });

  await withPage(async (page) => {
    await attachRoutes(page, { partner: null, onboardingStatus: 502 });
    await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
    await page.locator('#tab-partners').click();
    await page.locator('[data-express-activate]').click();
    await page.waitForFunction(() => document.querySelector('[data-express-status]')?.textContent.includes('No se pudo'));
    await shot(page, 'desktop-1440-providererror');
  });

  await withPage(async (page) => {
    await attachRoutes(page, { partner: null, sessionStatus: 403 });
    await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
    await page.locator('#tab-partners').click();
    await page.waitForFunction(() => document.querySelector('[data-express-status]')?.textContent.includes('No se pudo') || document.querySelector('[data-express-status]')?.textContent.includes('caduc'));
    await shot(page, 'desktop-1440-sessionexpiry');
  });

  await withPage(async (page) => {
    await attachRoutes(page, { partner: incomplete });
    await page.goto('https://candidate.invalid/?partner_return=1', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !document.querySelector('#partners')?.hidden);
    assert.match(await page.locator('[data-express-state]').innerText(), /incompleta/i);
    await shot(page, 'desktop-1440-return');
  });

  await withPage(async (page) => {
    await attachRoutes(page, { partner: incomplete, onboardingAccount: incomplete });
    await page.goto('https://candidate.invalid/?partner_refresh=1', { waitUntil: 'networkidle' });
    await page.waitForURL(/connect\.stripe\.com/);
  });
});
