import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Synchronous Docker calls pause socket-close events while containers restart.
const httpFetch = (url, options = {}) => fetch(url, { ...options, headers: { Connection: 'close', ...options.headers } });
const root = fileURLToPath(new URL('../', import.meta.url));
const project = `hia-production-${randomUUID().slice(0, 8)}`;
const folder = path.join(root, '.cache', project);
await fs.mkdir(folder, { recursive: true });
const reserve = createServer().listen(0, '127.0.0.1'); await once(reserve, 'listening');
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const base = `http://127.0.0.1:${port}`;
const envFile = path.join(folder, '.env');
const localModels = path.join(folder, 'llm'); await fs.mkdir(localModels);
const environment = [
  `POSTGRES_PASSWORD=${randomBytes(32).toString('hex')}`,
  `JWT_ACCESS_SECRET=${randomBytes(32).toString('hex')}`,
  `JWT_REFRESH_SECRET=${randomBytes(32).toString('hex')}`,
  `APP_PORT=${port}`, `WEB_ORIGIN=${base}`, 'LLM_PROVIDER=openrouter',
  'OPENROUTER_MODEL=openrouter/free',
  'LOCAL_LLM_BASE_URL=http://local-llm:8081/v1', 'LOCAL_LLM_MODEL_FILE=/app/local_models/model.gguf',
  `LOCAL_LLM_DIRECTORY=${localModels.replaceAll('\\', '/')}`,
  'RATE_LIMIT_MAX=10000', // This isolated runner opens 48 pages faster than a human.
].join('\n');
await fs.writeFile(envFile, environment, { flag: 'wx' });
const secrets = environment.split('\n').filter(line => /(?:PASSWORD|SECRET)=/.test(line)).map(line => line.slice(line.indexOf('=') + 1));
const env = { ...process.env, APP_ENV_FILE: envFile };
const args = ['compose', '--env-file', envFile, '-f', 'compose.production.yaml', '-p', project];
function compose(...commands) {
  const result = spawnSync('docker', [...args, ...commands], { cwd: root, env, encoding: 'utf8', timeout: 180000, windowsHide: true });
  // Only this runner's synthetic services are inspected. Never print config/env.
  if (result.status !== 0) {
    const logs = spawnSync('docker', [...args, 'logs', '--no-color', '--tail', '40', 'api', 'worker', 'migrate'], {
      cwd: root, env, encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    let diagnostic = [result.stderr, logs.stdout, logs.stderr].filter(Boolean).join('\n');
    for (const secret of [...secrets, 'fixture-key-for-storage']) diagnostic = diagnostic.replaceAll(secret, '[redacted]');
    diagnostic = diagnostic.replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[database URL]')
      .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]');
    console.error(diagnostic.slice(-12000));
  }
  assert.equal(result.status, 0, `Production compose command failed: ${commands[0]}`);
  return result.stdout.trim();
}
try {
  const config = JSON.parse(compose('config', '--format', 'json'));
  assert.equal(config.services.api.ports.length, 1);
  for (const service of ['postgres', 'redis', 'worker', 'migrate']) assert(!config.services[service].ports);
  assert(!config.services['local-llm'], 'Default installation must not start a local LLM');
  assert(config.services.api.volumes.some(volume => volume.target === '/app/local_models' && volume.read_only));
  assert(config.services.migrate.command.includes('deploy'));
  assert(!config.services.migrate.command.includes('dev'));
  assert.equal(config.services.api.depends_on.migrate.condition, 'service_completed_successfully');
  compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '120');
  let ready;
  for (let i = 0; i < 80; i++) {
    try { ready = await httpFetch(base + '/ready', { signal: AbortSignal.timeout(2000) }); if (ready.ok) break; } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready?.ok, 'Production API, DB, queue and worker must become ready');
  assert((await (await httpFetch(base)).text()).includes('<div id="root">'));
  assert.equal((await httpFetch(base + '/reviews')).status, 200);
  assert.equal((await httpFetch(base + '/api/products')).status, 401);
  const registered = await httpFetch(base + '/api/auth/register', { method: 'POST', headers: {
    'Content-Type': 'application/json', Origin: base, 'X-ReviewLens-CSRF': '1',
  }, body: JSON.stringify({ email: 'production@fixture.invalid', password: 'production-fixture-123' }) });
  assert.equal(registered.status, 201);
  const { accessToken, user } = await registered.json();
  const modelHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };
  const freshSettings = await httpFetch(base + '/api/analysis/provider', { headers: modelHeaders });
  const freshConfiguration = await freshSettings.json();
  assert.equal(freshConfiguration.provider, 'openrouter');
  assert.equal(freshConfiguration.hasApiKey, false);
  const missingKey = await httpFetch(base + '/api/analysis/provider/check', { method: 'POST', headers: modelHeaders });
  assert.equal(missingKey.status, 503); assert.equal((await missingKey.json()).code, 'model_unavailable');
  const missingModel = await httpFetch(base + '/api/analysis/provider', { headers: modelHeaders });
  assert.equal(missingModel.status, 200); assert.equal((await missingModel.json()).local.state, 'missing');
  const localChoice = await httpFetch(base + '/api/analysis/provider', { method: 'PUT', headers: modelHeaders, body: JSON.stringify({ provider: 'local' }) });
  assert.equal(localChoice.status, 200);
  const unavailable = await httpFetch(base + '/api/analysis/provider/check', { method: 'POST', headers: modelHeaders });
  assert.equal(unavailable.status, 503); assert.equal((await unavailable.json()).code, 'model_unavailable');
  const cloudChoice = await httpFetch(base + '/api/analysis/provider', { method: 'PUT', headers: modelHeaders,
    body: JSON.stringify({ provider: 'openrouter', cloudModel: 'fixture/not-contacted', apiKey: 'fixture-key-for-storage' }) });
  assert.equal(cloudChoice.status, 200); assert(!(await cloudChoice.text()).includes('fixture-key-for-storage'));
  const { io } = await import('socket.io-client');
  const socket = io(base, { auth: { token: accessToken }, transports: ['websocket'], extraHeaders: { Origin: base } });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Production Socket.IO connection timed out')), 5000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', error => { clearTimeout(timer); reject(error); });
    });
  } finally { socket.disconnect(); }
  const created = await httpFetch(base + '/api/products', { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`,
  }, body: JSON.stringify({ name: 'Production smoke' }) });
  assert.equal(created.status, 201);
  const product = await created.json();
  const savedRunId = compose('exec', '-T', 'api', 'node', '--input-type=module', '-e',
    `import {PrismaClient} from '@prisma/client'; const db=new PrismaClient(); try { const run=await db.analysisRun.create({data:{userId:${JSON.stringify(user.id)},productId:${JSON.stringify(product.id)},status:'completed',finishedAt:new Date(),scope:{},settings:{},provider:'local',model:'saved-fixture',modelVersion:'test',promptVersion:'test',embeddingVersion:'test',methodVersion:'test'}}); console.log(run.id); } finally {await db.$disconnect()}`);
  async function readSavedSocketState() {
    const connection = io(base, { auth: { token: accessToken }, transports: ['websocket'], extraHeaders: { Origin: base } });
    try {
      const state = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Saved run socket state timed out')), 5000);
        connection.once('connect_error', error => { clearTimeout(timer); reject(error); });
        connection.once('connect', () => connection.emit('job:subscribe', savedRunId));
        connection.once('analysis:state', state => { clearTimeout(timer); resolve(state); });
      });
      assert.equal(state.id, savedRunId); assert.equal(state.status, 'completed');
    } finally { connection.disconnect(); }
  }
  await readSavedSocketState();
  const paths = ['/app/apps/api/reports_output/persistence-check.txt', '/app/models_cache/persistence-check.txt', '/app/apps/api/uploads/persistence-check.txt'];
  compose('exec', '-T', 'api', 'node', '-e', `const fs=require('node:fs'); for(const p of ${JSON.stringify(paths)}) fs.writeFileSync(p,'${project}');`);
  compose('up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '120');
  compose('exec', '-T', 'worker', 'node', '-e', `const fs=require('node:fs'),assert=require('node:assert/strict'); for(const p of ${JSON.stringify(paths)}) assert.equal(fs.readFileSync(p,'utf8'),'${project}');`);
  const retained = await httpFetch(base + `/api/products/${product.id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  assert.equal(retained.status, 200);
  assert.equal((await retained.json()).name, 'Production smoke');
  const restoredRun = await httpFetch(base + `/api/analysis/runs/${savedRunId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  assert.equal(restoredRun.status, 200); assert.equal((await restoredRun.json()).status, 'completed');
  await readSavedSocketState();
  console.log('Production recovery: saved run survived API/container restart and Socket.IO reconnection returned its PostgreSQL state.');
  if (process.env.PLAYWRIGHT_MODULE) {
    const { verifyProductionBrowser } = await import('./verify-production-browser.mjs');
    await verifyProductionBrowser(base);
  }
  const { backupProduction, restoreProduction } = await import('./production-storage.mjs');
  const storageOptions = { envFile, project, directory: path.join(folder, 'backup') };
  await backupProduction(storageOptions);
  compose('down', '--volumes'); // Discard only this runner's synthetic fixtures before restoration.
  await restoreProduction(storageOptions);
  assert.equal((await httpFetch(base + `/api/products/${product.id}`, { headers: { Authorization: `Bearer ${accessToken}` } })).status, 200);
  const restoredSettings = await httpFetch(base + '/api/analysis/provider', { headers: modelHeaders });
  const restoredConfiguration = await restoredSettings.json();
  assert.equal(restoredConfiguration.provider, 'openrouter'); assert.equal(restoredConfiguration.hasApiKey, true);
  compose('exec', '-T', 'api', 'node', '-e', `require('node:assert/strict').equal(require('node:fs').readFileSync('${paths[0]}','utf8'),'${project}')`);
  await assert.rejects(restoreProduction(storageOptions), /empty database/);
  console.log('Production backup/restore: quiesced DB + report copy, checksums, empty-target restoration, retained user/product/artifact and refusal to overwrite passed.');
  console.log('Persistent storage: database row, shared reports/uploads and embedding cache survived full container recreation.');
  console.log('Production compose: image, deploy migrations, internal DB/Redis, separate worker, readiness, SPA, registration and product creation passed.');
} finally {
  compose('down', '--volumes', '--remove-orphans'); // This random project owns every removed container and volume.
  await fs.rm(envFile, { force: true });
}
