import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = `hia-production-${randomUUID().slice(0, 8)}`;
const folder = path.join(root, '.cache', project);
await fs.mkdir(folder, { recursive: true });
const reserve = createServer().listen(0, '127.0.0.1'); await once(reserve, 'listening');
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const base = `http://127.0.0.1:${port}`;
const envFile = path.join(folder, '.env');
await fs.writeFile(envFile, [
  `POSTGRES_PASSWORD=${randomBytes(32).toString('hex')}`,
  `JWT_ACCESS_SECRET=${randomBytes(32).toString('hex')}`,
  `JWT_REFRESH_SECRET=${randomBytes(32).toString('hex')}`,
  `APP_PORT=${port}`, `WEB_ORIGIN=${base}`, 'LLM_PROVIDER=local',
  'LLM_BASE_URL=http://host.docker.internal:1/v1', 'LLM_MODEL=unavailable-check-model',
].join('\n'), { flag: 'wx' });
const env = { ...process.env, APP_ENV_FILE: envFile };
const args = ['compose', '--env-file', envFile, '-f', 'compose.production.yaml', '-p', project];
function compose(...commands) {
  const result = spawnSync('docker', [...args, ...commands], { cwd: root, env, encoding: 'utf8', timeout: 180000, windowsHide: true });
  // Compose config and container env may contain secrets; never print raw output.
  assert.equal(result.status, 0, `Production compose command failed: ${commands[0]}`);
  return result.stdout.trim();
}
try {
  const config = JSON.parse(compose('config', '--format', 'json'));
  assert.equal(config.services.api.ports.length, 1);
  for (const service of ['postgres', 'redis', 'worker', 'migrate']) assert(!config.services[service].ports);
  compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '120');
  let ready;
  for (let i = 0; i < 80; i++) {
    try { ready = await fetch(base + '/ready', { signal: AbortSignal.timeout(2000) }); if (ready.ok) break; } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready?.ok, 'Production API, DB, queue and worker must become ready');
  assert((await (await fetch(base)).text()).includes('<div id="root">'));
  assert.equal((await fetch(base + '/reviews')).status, 200);
  assert.equal((await fetch(base + '/api/products')).status, 401);
  const registered = await fetch(base + '/api/auth/register', { method: 'POST', headers: {
    'Content-Type': 'application/json', Origin: base, 'X-ReviewLens-CSRF': '1',
  }, body: JSON.stringify({ email: 'production@fixture.invalid', password: 'production-fixture-123' }) });
  assert.equal(registered.status, 201);
  const { accessToken } = await registered.json();
  const created = await fetch(base + '/api/products', { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`,
  }, body: JSON.stringify({ name: 'Production smoke' }) });
  assert.equal(created.status, 201);
  const product = await created.json();
  const paths = ['/app/apps/api/reports_output/persistence-check.txt', '/app/models_cache/persistence-check.txt', '/app/apps/api/uploads/persistence-check.txt'];
  compose('exec', '-T', 'api', 'node', '-e', `const fs=require('node:fs'); for(const p of ${JSON.stringify(paths)}) fs.writeFileSync(p,'${project}');`);
  compose('up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '120');
  compose('exec', '-T', 'worker', 'node', '-e', `const fs=require('node:fs'),assert=require('node:assert/strict'); for(const p of ${JSON.stringify(paths)}) assert.equal(fs.readFileSync(p,'utf8'),'${project}');`);
  const retained = await fetch(base + `/api/products/${product.id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  assert.equal(retained.status, 200);
  assert.equal((await retained.json()).name, 'Production smoke');
  console.log('Persistent storage: database row, shared reports/uploads and embedding cache survived full container recreation.');
  console.log('Production compose: image, deploy migrations, internal DB/Redis, separate worker, readiness, SPA, registration and product creation passed.');
} finally {
  compose('down', '--volumes', '--remove-orphans'); // This random project owns every removed container and volume.
  await fs.rm(envFile, { force: true });
}
