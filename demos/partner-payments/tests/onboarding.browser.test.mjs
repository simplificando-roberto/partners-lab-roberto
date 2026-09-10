import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotDir = join(root, '../../.agent/qa/demo-onboarding/screenshots');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.mjs': 'text/javascript' };
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

async function shot(page, name) {
  mkdirSync(shotDir, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: true });
}

async function routes(page) {
  await page.route('https://candidate.invalid/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/config') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, test_only: true, partner_configured: true, express_available: true }) });
    if (url.pathname === '/api/session') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ expires_at: '2030-01-01T00:00:00Z' }) });
    if (url.pathname === '/api/partner') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ account: null }) });
    const file = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname.slice(1)));
    if (!file.startsWith(root) || !existsSync(file)) return route.fulfill({ status: 404, body: 'missing' });
    return route.fulfill({ status: 200, contentType: types[extname(file)] || 'text/plain', body: readFileSync(file) });
  });
}

test('onboarding: guía breve, rutas reales y teclado', { skip: !chromium, timeout: 120000 }, async (t) => {
  let browser;
  try { browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }); }
  catch (error) { t.skip(`Chromium no disponible en este entorno: ${error.message}`); return; }
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })).newPage();
    await routes(page);
    await page.goto('https://candidate.invalid/', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('[data-onboarding-guide]').isVisible(), true);
    assert.match(await page.locator('[data-onboarding-guide]').innerText(), /modo de pruebas/);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await shot(page, 'desktop-1440-onboarding');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-onboarding-route="local"]').click();
    assert.equal(await page.locator('#localSimulation').evaluate(el => el.open), true);
    assert.match(await page.locator('[data-onboarding-current]').innerText(), /Simulación local/);
    await page.locator('[data-onboarding-close]').click();
    assert.equal(await page.locator('[data-onboarding-guide]').isHidden(), true);
    await page.locator('[data-onboarding-open]').press('Enter');
    assert.equal(await page.locator('[data-onboarding-guide]').isVisible(), true);
    await page.locator('[data-onboarding-route="express"]').click();
    assert.equal(await page.locator('#partners').isVisible(), true);
    assert.match(await page.locator('[data-onboarding-current]').innerText(), /Ruta Express/);
    assert.doesNotMatch(await page.locator('[data-onboarding-current]').innerText(), /Activa cobros y completa el alta/);
    assert.match(await page.locator('[data-onboarding-current]').innerText(), /Revisa el estado.*continúa si hace falta/);
    await page.locator('[data-onboarding-close]').click();
    await page.locator('[data-onboarding-open]').press('Enter');
    assert.equal(await page.locator('[data-onboarding-guide]').isVisible(), true);
    await page.locator('#tab-launch').click();
    await page.locator('[data-onboarding-close]').click();
    assert.equal(await page.locator('[data-onboarding-guide]').isHidden(), true);
    await page.locator('[data-onboarding-open]').press('Enter');
    assert.equal(await page.locator('[data-onboarding-guide]').isVisible(), true);
    await page.locator('#tab-partners').focus();
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#payments').isVisible(), true);
    await page.locator('[data-onboarding-route="checkout"]').click();
    assert.equal(await page.locator('#payments').isVisible(), true);
    assert.doesNotMatch(await page.locator('[data-onboarding-current]').innerText(), /Cuenta de ejemplo seleccionada/);
    assert.match(await page.locator('[data-onboarding-current]').innerText(), /Destino mostrado seleccionado/);
    await shot(page, 'mobile-390-onboarding');
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);
  } finally { await browser.close(); }
});
