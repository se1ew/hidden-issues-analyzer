import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

Object.assign(process.env, {
  NODE_ENV: 'production', WEB_DIST_DIR: fileURLToPath(new URL('../apps/web/dist', import.meta.url)),
  DATABASE_URL: 'postgresql://check:check@127.0.0.1:1/check', REDIS_URL: 'redis://127.0.0.1:1',
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
  LLM_PROVIDER: 'local', LLM_MODEL: 'hosting-check', LLM_BASE_URL: 'http://127.0.0.1:1/v1',
});
const { createApp } = await import('../apps/api/dist/app.js');
const server = createApp().listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
try {
  let index;
  for (const path of ['/', '/login', '/reviews', '/reports', '/reviews/nested/route']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert(html.includes('<div id="root">')); assert(!html.includes('/@vite/client'));
    index ??= html; assert.equal(html, index);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
  }
  for (const [, path] of index.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert(!response.headers.get('content-type').includes('text/html'));
    assert(response.headers.get('cache-control').includes('immutable'));
  }
  for (const path of ['/api/missing', '/assets/missing.js', '/.env']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/api/products')).status, 401);
  console.log('Production API hosts compiled SPA, deep links and cached assets; API, missing files and auth stay intact.');
} finally {
  await new Promise(resolve => server.close(resolve));
}
