import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function verifyProductionBrowser(base) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], foreignRequests = [];
  const httpErrors = [];
  page.on('response', response => { if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() }); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== base) foreignRequests.push(request.url()); });
  const output = new URL('../.cache/production-browser/', import.meta.url);
  await fs.mkdir(output, { recursive: true });
  try {
    await page.goto(base + '/register');
    await page.getByLabel('Email', { exact: true }).fill(`browser-${randomUUID()}@fixture.invalid`);
    await page.getByLabel('Пароль', { exact: true }).fill('browser-fixture-password');
    await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
    await page.waitForURL(base + '/upload');
    await page.goto(base + '/products');
    await page.getByLabel('Название нового товара').fill('Браузерная проверка production');
    const created = page.waitForResponse(response => response.url() === base + '/api/products' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Создать товар', exact: true }).click();
    assert.equal((await created).status(), 201);
    await page.reload();
    await page.getByRole('heading', { name: 'Товары', exact: true }).waitFor();
    await page.getByText('Браузерная проверка production', { exact: true }).first().waitFor();
    const cookies = await context.cookies();
    assert(cookies.some(cookie => cookie.name === 'hia-refresh' && cookie.httpOnly && cookie.path === '/api/auth'));
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const dark of [false, true]) {
        await page.evaluate(value => localStorage.setItem('hia-theme', JSON.stringify({ state: { isDark: value }, version: 0 })), dark);
        for (const route of ['/dashboard', '/upload', '/reviews', '/issues', '/analytics', '/reports', '/products', '/profile']) {
          await page.goto(base + route);
          await page.locator('#main-content').waitFor();
          await page.locator('h1').first().waitFor();
          assert.equal(new URL(page.url()).pathname, route, 'Cookie refresh must restore the session on direct navigation');
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Page overflow: ${route}, ${width}`);
          assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), dark);
        }
        await page.screenshot({ path: fileURLToPath(new URL(`products-${width}-${dark}.png`, output)), fullPage: true });
      }
    }
    assert.deepEqual(errors, []); assert.deepEqual(foreignRequests, []);
    console.log('Production browser: real registration, product creation, HttpOnly cookie refresh and 48 page/theme/width combinations passed with one origin and no external requests.');
  } catch (error) {
    await page.screenshot({ path: fileURLToPath(new URL('failure.png', output)), fullPage: true });
    await fs.writeFile(new URL('failure.json', output), JSON.stringify({ url: page.url(), errors, foreignRequests, httpErrors }, null, 2));
    throw error;
  } finally { await browser.close(); }
}
