import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';

const root = fileURLToPath(new URL('../', import.meta.url));
const name = `hia-llm-settings-${randomUUID().slice(0, 8)}`;
const containers = [], observations = [];
const folder = path.join(root, '.cache', name);
let db, server, browserServer, queue;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true, ...options });
  assert.equal(result.status, 0, `${command} ${args[0]} failed`);
  return result.stdout.trim();
}
try {
  await fs.mkdir(folder, { recursive: true });
  for (const [suffix, image, port] of [['postgres', 'postgres:16-alpine', '5432'], ['redis', 'redis:7-alpine', '6379']]) {
    const container = `${name}-${suffix}`; containers.push(container);
    run('docker', ['run', '-d', '--name', container, ...(suffix === 'postgres'
      ? ['-e', 'POSTGRES_USER=check', '-e', 'POSTGRES_PASSWORD=check'] : []), '-p', `127.0.0.1::${port}`, image]);
  }
  for (let i = 0; i < 60; i++) {
    if (spawnSync('docker', ['exec', containers[0], 'pg_isready', '-U', 'check']).status === 0) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  const databasePort = run('docker', ['port', containers[0], '5432']).split(':').at(-1);
  const redisPort = run('docker', ['port', containers[1], '6379']).split(':').at(-1);
  server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: ['openrouter/free', 'vendor/b'].map(id => ({
      id, name: id, context_length: 32000, architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      supported_parameters: ['response_format'], pricing: { prompt: id === 'openrouter/free' ? '0' : '0.000001', completion: id === 'openrouter/free' ? '0' : '0.000003' },
    })) }));
    if (req.url === '/v1/key') {
      const owner = req.headers.authorization === 'Bearer fixture-private-a' ? 'a'
        : req.headers.authorization === 'Bearer fixture-private-b' ? 'b'
          : req.headers.authorization === 'Bearer fixture-browser-key' ? 'a' : null;
      if (!owner) { res.statusCode = 401; return res.end(JSON.stringify({ error: 'no key' })); }
      return res.end(JSON.stringify({ data: { label: `private-label-${owner}`, limit: null, limit_remaining: null,
        free_model_daily_requests: { used: owner === 'a' ? 9 : 20, remaining: owner === 'a' ? 41 : 30, limit: 50 } } }));
    }
    const parsed = JSON.parse(body);
    if (parsed.model === 'openrouter/free') {
      assert.equal(parsed.response_format?.type, 'json_schema');
      assert.equal(parsed.reasoning?.enabled, false);
    }
    observations.push({ model: parsed.model, authorization: req.headers.authorization });
    const summary = parsed.messages[0].content.startsWith('Составь краткую сводку');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: summary ? 'Сводка контрольного запуска.'
      : JSON.stringify({ sentiment: 'positive', sentiment_score: 0.5, aspects: [], complaints: [] }) } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  Object.assign(process.env, {
    NODE_ENV: 'test', DATABASE_URL: `postgresql://check:check@127.0.0.1:${databasePort}/check`,
    REDIS_URL: `redis://127.0.0.1:${redisPort}`, JWT_ACCESS_SECRET: 'settings-access-secret-xxxxxxxxxxxxxxx',
    JWT_REFRESH_SECRET: 'settings-refresh-secret-xxxxxxxxxxxxxx', LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: '',
    OPENROUTER_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, LLM_RETRIES: '0', LLM_CLOUD_DELAY_MS: '0',
    LOCAL_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, LOCAL_LLM_MODEL_FILE: path.join(folder, 'model.gguf'),
    ANALYSIS_QUEUE_NAME: name, LLM_TIMEOUT_MS: '5000', RATE_LIMIT_MAX: '10000',
  });
  if (process.env.PLAYWRIGHT_MODULE) process.env.WEB_DIST_DIR = path.join(root, 'apps/web/dist');
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma']);
  const { prisma } = await import('../apps/api/dist/lib/prisma.js'); db = prisma;
  const { createApp } = await import('../apps/api/dist/app.js');
  const { signAccessToken } = await import('../apps/api/dist/middleware/auth.js');
  queue = await import('../apps/api/dist/lib/analysis-queue.js');
  const app = createApp();
  const authenticated = (method, endpoint, owner = 'a') => request(app)[method](`/api/${endpoint}`)
    .auth(signAccessToken({ sub: owner, email: `${owner}@settings.test` }), { type: 'bearer' });
  assert.equal((await request(app).put('/api/analysis/provider').send({ provider: 'local' })).status, 401);
  assert.equal((await request(app).get('/api/analysis/provider/models')).status, 401);
  assert.equal((await request(app).get('/api/analysis/provider/limits')).status, 401);
  const runIds = [], products = [];
  for (const owner of ['a', 'b']) {
    await db.user.create({ data: { id: owner, email: `${owner}@settings.test`, passwordHash: 'unused' } });
    const product = await db.product.create({ data: { userId: owner, name: `Model test ${owner}` } }); products.push(product);
    const batch = await db.uploadBatch.create({ data: { userId: owner, productId: product.id, source: 'manual', status: 'completed' } });
    await db.review.create({ data: { productId: product.id, uploadBatchId: batch.id, text: 'Хороший товар, всё работает.', rating: 5 } });
    const initial = await authenticated('get', 'analysis/provider', owner);
    assert.equal(initial.status, 200); assert.equal(initial.body.provider, 'openrouter');
    assert.equal(initial.body.hasApiKey, false);
    const unconfigured = await authenticated('post', 'analysis/provider/check', owner);
    assert.equal(unconfigured.status, 503); assert.equal(unconfigured.body.code, 'model_unavailable');
    const settings = await authenticated('put', 'analysis/provider', owner)
      .send({ provider: 'openrouter', cloudModel: owner === 'a' ? 'openrouter/free' : 'vendor/b', apiKey: `fixture-private-${owner}` });
    assert.equal(settings.status, 200); assert.equal(settings.body.hasApiKey, true);
    assert(!JSON.stringify(settings.body).includes('fixture-private'));
    const saved = await db.userLlmSettings.findUniqueOrThrow({ where: { userId: owner } });
    assert(!saved.encryptedKey.includes('fixture-private'));
    const catalog = await authenticated('get', 'analysis/provider/models', owner);
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.items.find(model => model.id === 'openrouter/free').isFree, true);
    assert.equal(catalog.body.items.find(model => model.id === 'vendor/b').pricing.completionPerMillion, 3);
    const limits = await authenticated('get', 'analysis/provider/limits', owner);
    assert.equal(limits.status, 200); assert.equal(limits.headers['cache-control'], 'no-store');
    assert.equal(limits.body.freeRequests.remaining, owner === 'a' ? 41 : 30);
    assert(!JSON.stringify(limits.body).includes('private'));
    assert.equal((await authenticated('post', 'analysis/provider/check', owner)).status, 200);
    const created = await authenticated('post', 'analysis/runs', owner).send({ productId: product.id });
    assert.equal(created.status, 202); runIds.push(created.body.id);
    const persisted = await db.analysisRun.findUniqueOrThrow({ where: { id: created.body.id } });
    assert.equal(persisted.settings.credentialSource, 'account');
    assert(!JSON.stringify(persisted.settings).includes('fixture-private'));
  }
  const otherBefore = (await authenticated('get', 'analysis/provider', 'b')).body;
  assert.equal((await authenticated('put', 'analysis/provider', 'a').send({ provider: 'local' })).status, 200);
  assert.deepEqual((await authenticated('get', 'analysis/provider', 'b')).body, otherBefore);
  const missing = await authenticated('post', 'analysis/provider/check');
  assert.equal(missing.status, 503); assert.equal(missing.body.code, 'model_unavailable');
  assert.equal((await authenticated('get', 'analysis/provider')).body.local.state, 'missing');

  // A separate process has no API memory and no installation cloud key. It must
  // use each saved run's provider/model and decrypt only that owner's credential.
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    const {processAnalysisRun}=await import('./apps/api/dist/services/analysis-worker.service.js');
    const {closeAnalysisQueue}=await import('./apps/api/dist/lib/analysis-queue.js');
    const {prisma}=await import('./apps/api/dist/lib/prisma.js');
    try { for(const id of ${JSON.stringify(runIds)}) await processAnalysisRun(id); }
    finally { await closeAnalysisQueue(); await prisma.$disconnect(); }
  `], { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.resume(); child.stderr.resume();
  const timer = setTimeout(() => child.kill(), 45_000);
  try { const [code] = await once(child, 'exit'); assert.equal(code, 0, 'Separate worker must complete'); }
  finally { clearTimeout(timer); }
  for (const id of runIds) assert.equal((await db.analysisRun.findUniqueOrThrow({ where: { id } })).status, 'completed');
  assert.deepEqual(observations, [
    { model: 'openrouter/free', authorization: 'Bearer fixture-private-a' },
    { model: 'vendor/b', authorization: 'Bearer fixture-private-b' },
  ]);
  const summary = await authenticated('get', 'analysis/summary', 'b').query({ productId: products[1].id });
  assert.equal(summary.status, 200); assert.equal(summary.body.summary, 'Сводка контрольного запуска.');
  assert.equal(observations.at(-1).authorization, 'Bearer fixture-private-b');
  const beforeMissing = await db.analysisRun.count();
  assert.equal((await authenticated('post', 'analysis/runs').send({ productId: products[0].id, mode: 'reanalyze' })).status, 503);
  assert.equal(await db.analysisRun.count(), beforeMissing);
  assert.equal((await authenticated('put', 'analysis/provider').send({ provider: 'local', clearApiKey: true })).status, 200);
  assert.equal((await authenticated('get', 'analysis/provider/limits')).status, 409);
  assert.equal((await authenticated('put', 'analysis/provider').send({ provider: 'openrouter' })).status, 422);
  console.log('LLM settings: two accounts, encrypted keys, separate worker, saved provider/model, summary, missing GGUF and no cloud fallback passed.');
  if (process.env.PLAYWRIGHT_MODULE) {
    browserServer = createServer(app); browserServer.listen(0, '127.0.0.1'); await once(browserServer, 'listening');
    const base = `http://127.0.0.1:${browserServer.address().port}`;
    const { env } = await import('../apps/api/dist/config/env.js'); env.WEB_ORIGIN = base;
    const { verifyProductionBrowser } = await import('./verify-production-browser.mjs');
    await verifyProductionBrowser(base, { openRouterFixture: true });
  }
} finally {
  if (browserServer) { browserServer.closeAllConnections(); await new Promise(resolve => browserServer.close(resolve)); }
  if (queue) await queue.closeAnalysisQueue();
  if (db) await db.$disconnect();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  for (const container of containers.reverse()) spawnSync('docker', ['rm', '-f', container], { encoding: 'utf8', windowsHide: true });
}
