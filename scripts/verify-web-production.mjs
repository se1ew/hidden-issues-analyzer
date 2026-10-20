import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
const root = fileURLToPath(new URL('../', import.meta.url));
const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
  'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: fileURLToPath(new URL('../apps/web/', import.meta.url)), windowsHide: true, stdio: 'ignore' });
let launchError; child.on('error', error => { launchError = error; });
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError;
    try { ready = (await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Starting preview. */ }
    if (ready) break; await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, 'Production preview did not become ready');
  let index;
  for (const route of ['/', '/reviews', '/issues', '/reports', '/upload', '/login', '/reviews/nested/route']) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`); assert(response.ok);
    const html = await response.text(); assert(html.includes('<div id="root">')); assert(!html.includes('/@vite/client'));
    index ??= html; assert.equal(html, index, `SPA fallback failed for ${route}`);
  }
  const assets = [...index.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1]); assert(assets.length >= 2);
  for (const asset of assets) {
    const response = await fetch(`http://127.0.0.1:${port}${asset}`); assert(response.ok);
    assert(!response.headers.get('content-type')?.includes('text/html'));
  }
  console.log('Production frontend: compiled assets and direct navigation to nested routes passed. Final LAN hosting is a separate deployment check.');
} finally {
  if (child.exitCode === null && !child.signalCode) { const exited = once(child, 'exit'); child.kill(); await exited; }
}
