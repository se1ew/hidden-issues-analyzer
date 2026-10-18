import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../', import.meta.url));
const name = `hia-run-check-${randomUUID().slice(0, 8)}`;
const containers = [];
let db, worker, queueModule, modelServer;
let fixtureMode = 'normal';
const pendingModelReplies = [];
let inferenceCalls = 0;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'Command failed');
  return result.stdout;
}
try {
  const postgres = `${name}-postgres`; containers.push(postgres);
  run('docker', ['run', '-d', '--name', postgres, '-e', 'POSTGRES_USER=check', '-e', 'POSTGRES_PASSWORD=check',
    '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (spawnSync('docker', ['exec', postgres, 'pg_isready', '-U', 'check']).status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, 'Temporary PostgreSQL did not start');
  const port = run('docker', ['port', postgres, '5432']).trim().split(':').at(-1);
  const redis = `${name}-redis`; containers.push(redis);
  run('docker', ['run', '-d', '--name', redis, '-p', '127.0.0.1::6379', 'redis:7-alpine']);
  for (let attempt = 0; attempt < 40; attempt++) {
    if (spawnSync('docker', ['exec', redis, 'redis-cli', 'ping'], { encoding: 'utf8' }).stdout?.includes('PONG')) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const redisPort = run('docker', ['port', redis, '6379']).trim().split(':').at(-1);
  modelServer = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk.toString();
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }));
    assert.equal(JSON.parse(body).model, 'fixture-model', 'Worker must use the saved model, not current environment defaults');
    inferenceCalls++;
    const complete = () => { if (!res.destroyed) res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: {
      content: JSON.stringify({ sentiment: fixtureMode === 'invalid' ? 'invalid' : 'positive', sentiment_score: 0.5,
        aspects: [{ name: 'качество', sentiment: 'positive' }], complaints: [] }),
    } }] })); };
    if (fixtureMode === 'hold') pendingModelReplies.push(complete); else complete();
  });
  modelServer.listen(0, '127.0.0.1'); await once(modelServer, 'listening');
  Object.assign(process.env, {
    NODE_ENV: 'test', DATABASE_URL: `postgresql://check:check@127.0.0.1:${port}/check`,
    REDIS_URL: `redis://127.0.0.1:${redisPort}`, JWT_ACCESS_SECRET: 'run-check-access-secret-xxxxxxxxxxxx',
    JWT_REFRESH_SECRET: 'run-check-refresh-secret-xxxxxxxxxxxx', LLM_PROVIDER: 'local',
    LLM_MODEL: 'fixture-model', LLM_RETRIES: '0',
    LLM_BASE_URL: `http://127.0.0.1:${modelServer.address().port}/v1`,
    LLM_TIMEOUT_MS: '5000', ANALYSIS_QUEUE_NAME: name, ANALYSIS_HEARTBEAT_MS: '100',
    ANALYSIS_LEASE_MS: '1000', ANALYSIS_DISPATCH_MS: '100',
  });
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], { env: process.env });
  const { prisma } = await import('../apps/api/dist/lib/prisma.js'); db = prisma;
  const runs = await import('../apps/api/dist/services/analysis-runs.service.js');
  const { CreateAnalysisRunSchema } = await import('../apps/api/dist/schemas/analysis-runs.schema.js');
  for (const id of ['a', 'b']) await db.user.create({ data: { id, email: `${id}@run.test`, passwordHash: 'unused' } });
  const product = await db.product.create({ data: { userId: 'a', name: 'Run snapshot', source: 'local' } });
  const foreign = await db.product.create({ data: { userId: 'b', name: 'Foreign', source: 'local' } });
  await db.review.createMany({ data: [1, 2].map(number => ({ id: `review-${number}`, productId: product.id, text: `  Отзыв ${number}  `, rating: number + 3 })) });
  const input = CreateAnalysisRunSchema.parse({ productId: product.id });
  await assert.rejects(runs.createAnalysisRun('a', { ...input, productId: foreign.id }), error => error.status === 404);
  const starts = await Promise.allSettled([runs.createAnalysisRun('a', input), runs.createAnalysisRun('a', input)]);
  assert.equal(starts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(starts.find(result => result.status === 'rejected').reason.status, 409);
  const created = starts.find(result => result.status === 'fulfilled').value;
  assert.equal(created.total, 2);
  await assert.rejects(runs.getAnalysisRun(created.id, 'b'), error => error.status === 404);
  assert.equal((await runs.listAnalysisRuns('b', { page: 1, pageSize: 20 })).total, 0);
  await db.review.create({ data: { productId: product.id, text: 'Импорт после создания запуска' } });
  await db.review.update({ where: { id: 'review-1' }, data: { text: 'Изменённый источник', inputVersion: 2 } });
  const snapshot = await db.analysisRunReview.findMany({ where: { runId: created.id }, orderBy: { sourceReviewId: 'asc' } });
  assert.equal(snapshot.length, 2);
  assert.equal(snapshot[0].text, '  Отзыв 1  ');
  assert.equal(snapshot[0].inputVersion, 1);
  assert.equal(await db.reviewAnalysis.count({ where: { runId: created.id, status: 'pending' } }), 2);
  const saved = await db.analysisRun.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal('apiKey' in saved.settings, false);
  assert(saved.settings.prompt);
  await assert.rejects(db.analysisRun.create({ data: {
    userId: 'a', productId: product.id, scope: {}, settings: {}, provider: 'local', model: 'fixture',
    modelVersion: 'test', promptVersion: 'test', embeddingVersion: 'test', methodVersion: 'test',
  } }), error => error.code === 'P2002');
  console.log('Run snapshots: owner boundaries, atomic concurrent start, immutable input, stored configuration, pending results and database uniqueness passed.');
  const claimed = await runs.claimAnalysisRun(created.id);
  assert(claimed.leaseToken);
  assert.equal(await runs.claimAnalysisRun(created.id), null);
  const token = claimed.leaseToken;
  assert(await runs.heartbeatAnalysisRun(created.id, token));
  assert.equal(await runs.heartbeatAnalysisRun(created.id, 'foreign-token'), null);
  assert.equal(await runs.beginAnalysisInput(created.id, token, snapshot[0].id), true);
  assert.equal(await runs.beginAnalysisInput(created.id, token, snapshot[0].id), false);
  const successful = { sentiment: 'positive', sentiment_score: 0.5,
    aspects: [{ name: 'звук', sentiment: 'positive' }], issues: ['шумит'] };
  assert.equal(await runs.saveAnalysisInput(created.id, token, snapshot[0].id, { result: successful, durationMs: 5 }), true);
  assert.equal(await runs.saveAnalysisInput(created.id, token, snapshot[0].id, { result: successful, durationMs: 5 }), false);
  assert.equal(await db.aspectMention.count({ where: { analysis: { runId: created.id } } }), 1);
  assert.equal(await runs.beginAnalysisInput(created.id, token, snapshot[1].id), true);
  assert.equal(await runs.saveAnalysisInput(created.id, token, snapshot[1].id, { errorCode: 'invalid_response', durationMs: 5 }), true);
  const partial = await runs.finishAnalysisRun(created.id, token);
  assert.equal(partial.status, 'partial'); assert.equal(partial.succeeded, 1); assert.equal(partial.failed, 1);
  assert.equal((await runs.getAnalysisRun(created.id, 'a')).remaining, 0);
  assert.equal(await runs.finishAnalysisRun(created.id, token), null);
  assert.equal((await db.review.findUniqueOrThrow({ where: { id: 'review-1' } })).analyzedAt, null);

  await assert.rejects(runs.retryFailedAnalysisRun(created.id, 'b'), error => error.status === 404);
  await db.review.update({ where: { id: 'review-2' }, data: { text: 'Редакция после ошибки', inputVersion: 2 } });
  const retries = await Promise.allSettled([runs.retryFailedAnalysisRun(created.id, 'a'), runs.retryFailedAnalysisRun(created.id, 'a')]);
  assert.equal(retries.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(retries.find(result => result.status === 'rejected').reason.status, 409);
  const retry = retries.find(result => result.status === 'fulfilled').value;
  assert.equal(retry.previousRunId, created.id);
  assert.equal(retry.total, 1);
  const retryInput = await db.analysisRunReview.findFirstOrThrow({ where: { runId: retry.id } });
  assert.equal(retryInput.inputHash, snapshot[1].inputHash);
  assert.equal(retryInput.text, snapshot[1].text);
  assert.equal(await db.reviewAnalysis.count({ where: { runId: created.id, status: 'failed' } }), 1);
  await runs.cancelAnalysisRun(retry.id, 'a');
  console.log('Failed-only retry: owner isolation, immutable failed input, parent link and concurrent retry exclusion passed.');

  const waiting = await runs.createAnalysisRun('a', input);
  await assert.rejects(runs.cancelAnalysisRun(waiting.id, 'b'), error => error.status === 404);
  assert.equal((await runs.cancelAnalysisRun(waiting.id, 'a')).status, 'cancelled');
  assert.equal(await runs.claimAnalysisRun(waiting.id), null);
  const cancelEvents = await db.analysisRunEvent.count({ where: { runId: waiting.id } });
  await runs.cancelAnalysisRun(waiting.id, 'a');
  assert.equal(await db.analysisRunEvent.count({ where: { runId: waiting.id } }), cancelEvents);
  const stopping = await runs.createAnalysisRun('a', input);
  const stoppingClaim = await runs.claimAnalysisRun(stopping.id);
  const stoppingInput = await db.analysisRunReview.findFirstOrThrow({ where: { runId: stopping.id } });
  await runs.beginAnalysisInput(stopping.id, stoppingClaim.leaseToken, stoppingInput.id);
  assert.equal((await runs.cancelAnalysisRun(stopping.id, 'a')).status, 'running');
  assert.equal(await runs.saveAnalysisInput(stopping.id, stoppingClaim.leaseToken, stoppingInput.id, { result: successful, durationMs: 1 }), false);
  assert.equal((await runs.finishAnalysisRun(stopping.id, stoppingClaim.leaseToken)).status, 'cancelled');
  assert.equal(await db.reviewAnalysis.count({ where: { runId: stopping.id, status: 'succeeded' } }), 0);

  const expired = await runs.createAnalysisRun('a', input);
  const expiredClaim = await runs.claimAnalysisRun(expired.id);
  await db.analysisRun.update({ where: { id: expired.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
  await runs.interruptExpiredRuns();
  assert.equal((await runs.getAnalysisRun(expired.id, 'a')).status, 'interrupted');
  assert.equal(await runs.heartbeatAnalysisRun(expired.id, expiredClaim.leaseToken), null);
  assert.equal(await runs.finishAnalysisRun(expired.id, expiredClaim.leaseToken), null);
  console.log('Run lifecycle: exclusive claim, heartbeat, idempotent results, exact counters, partial status, cancellation fencing and expired-lease recovery passed.');
  for (const kind of ['failed', 'completed']) {
    const next = await runs.createAnalysisRun('a', input);
    const lease = await runs.claimAnalysisRun(next.id);
    const inputs = await db.analysisRunReview.findMany({ where: { runId: next.id } });
    for (const row of inputs) {
      await runs.beginAnalysisInput(next.id, lease.leaseToken, row.id);
      await runs.saveAnalysisInput(next.id, lease.leaseToken, row.id, kind === 'failed'
        ? { errorCode: 'invalid_response', durationMs: 1 }
        : { result: { ...successful, issues: [] }, durationMs: 1 });
    }
    const finished = await runs.finishAnalysisRun(next.id, lease.leaseToken);
    assert.equal(finished.status, kind);
    assert.equal(finished.succeeded + finished.failed, finished.total);
  }
  const empty = await runs.createAnalysisRun('a', input);
  assert.equal(empty.total, 0);
  const emptyLease = await runs.claimAnalysisRun(empty.id);
  assert.equal((await runs.finishAnalysisRun(empty.id, emptyLease.leaseToken)).finishReason, 'empty_selection');
  const previous = await db.review.findUniqueOrThrow({ where: { id: 'review-2' } });
  const cancelledReanalysis = await runs.createAnalysisRun('a', { ...input, mode: 'reanalyze' });
  const reanalysisLease = await runs.claimAnalysisRun(cancelledReanalysis.id);
  const reanalysisInput = await db.analysisRunReview.findFirstOrThrow({ where: { runId: cancelledReanalysis.id, sourceReviewId: previous.id } });
  await runs.beginAnalysisInput(cancelledReanalysis.id, reanalysisLease.leaseToken, reanalysisInput.id);
  await runs.saveAnalysisInput(cancelledReanalysis.id, reanalysisLease.leaseToken, reanalysisInput.id,
    { result: { ...successful, sentiment: 'negative', sentiment_score: -0.5 }, durationMs: 1 });
  await runs.cancelAnalysisRun(cancelledReanalysis.id, 'a');
  await runs.finishAnalysisRun(cancelledReanalysis.id, reanalysisLease.leaseToken);
  const unchanged = await db.review.findUniqueOrThrow({ where: { id: previous.id } });
  assert.equal((await runs.getAnalysisRun(cancelledReanalysis.id, 'a')).resultsDisposition, 'retained_unpublished');
  assert.equal(await db.reviewAnalysis.count({ where: { runId: cancelledReanalysis.id, status: 'succeeded' } }), 1);
  assert.equal(unchanged.sentiment, previous.sentiment);
  assert.equal(unchanged.analyzedAt.getTime(), previous.analyzedAt.getTime());
  console.log('Run terminal states: all failures, successful empty grouping, empty selection and preserved publication after cancellation passed.');
  queueModule = await import('../apps/api/dist/lib/analysis-queue.js');
  let workerOutput = '';
  const startWorker = () => {
    worker = spawn(process.execPath, ['apps/api/dist/worker.js'], { cwd: root, env: process.env,
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    worker.stdout.on('data', chunk => { workerOutput = (workerOutput + chunk.toString()).slice(-3000); });
    worker.stderr.on('data', chunk => { workerOutput = (workerOutput + chunk.toString()).slice(-3000); });
  };
  const waitFor = async (condition, label) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await condition()) return;
      if (worker?.exitCode !== null && worker?.exitCode !== undefined) assert.fail(`Worker exited: ${workerOutput}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`Timed out: ${label}; ${workerOutput}`);
  };
  const reanalyze = { ...input, mode: 'reanalyze' };
  const delivered = await runs.createAnalysisRun('a', reanalyze);
  process.env.LLM_MODEL = 'changed-worker-default';
  // Deliberately do not enqueue: the worker dispatcher must recover the committed row.
  startWorker();
  await waitFor(async () => (await runs.getAnalysisRun(delivered.id, 'a')).status === 'completed', 'outbox recovery');
  assert.equal((await runs.getAnalysisRun(delivered.id, 'a')).succeeded, delivered.total);
  assert.equal(await db.aspectMention.count({ where: { analysis: { runId: delivered.id } } }), delivered.total);
  const countBeforeRedelivery = inferenceCalls;
  await queueModule.enqueueAnalysisRun(delivered.id);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(inferenceCalls, countBeforeRedelivery);
  assert.equal(await db.aspectMention.count({ where: { analysis: { runId: delivered.id } } }), delivered.total);

  fixtureMode = 'invalid';
  const invalidRun = await runs.createAnalysisRun('a', reanalyze);
  await Promise.all([queueModule.enqueueAnalysisRun(invalidRun.id), queueModule.enqueueAnalysisRun(invalidRun.id)]);
  await waitFor(async () => (await runs.getAnalysisRun(invalidRun.id, 'a')).status === 'failed', 'all model errors');
  assert.equal((await runs.getAnalysisRun(invalidRun.id, 'a')).failed, invalidRun.total);

  fixtureMode = 'hold';
  const activeCancel = await runs.createAnalysisRun('a', reanalyze);
  await waitFor(() => pendingModelReplies.length > 0, 'active model request');
  await runs.cancelAnalysisRun(activeCancel.id, 'a');
  await waitFor(async () => (await runs.getAnalysisRun(activeCancel.id, 'a')).status === 'cancelled', 'active HTTP cancellation');
  for (const complete of pendingModelReplies.splice(0)) complete();
  assert.equal((await runs.getAnalysisRun(activeCancel.id, 'a')).succeeded, 0);

  const crashing = await runs.createAnalysisRun('a', reanalyze);
  await waitFor(() => pendingModelReplies.length > 0, 'crashing worker request');
  const exited = once(worker, 'exit'); worker.kill('SIGKILL'); await exited; worker = undefined;
  await new Promise(resolve => setTimeout(resolve, 1200));
  await runs.interruptExpiredRuns();
  assert.equal((await runs.getAnalysisRun(crashing.id, 'a')).status, 'interrupted');
  for (const complete of pendingModelReplies.splice(0)) complete();
  fixtureMode = 'normal';
  const afterRestart = await runs.createAnalysisRun('a', reanalyze);
  startWorker();
  await waitFor(async () => (await runs.getAnalysisRun(afterRestart.id, 'a')).status === 'completed', 'worker restart');
  assert.equal((await runs.getAnalysisRun(crashing.id, 'a')).status, 'interrupted');
  console.log('BullMQ worker: committed-row recovery, separate process, immutable configuration, duplicate delivery, model failure, active cancellation and worker crash/restart passed.');

  // Losing queued jobs and concurrency keys must not strand committed rows.
  const exitedForLoss = once(worker, 'exit'); worker.kill('SIGKILL'); await exitedForLoss; worker = undefined;
  const lostQueueRun = await runs.createAnalysisRun('a', reanalyze);
  await queueModule.enqueueAnalysisRun(lostQueueRun.id);
  const queueClient = await queueModule.getAnalysisQueue().client;
  await queueClient.flushdb(); // This script owns its disposable Redis container.
  startWorker();
  await waitFor(async () => (await runs.getAnalysisRun(lostQueueRun.id, 'a')).status === 'completed', 'Redis data loss reconciliation');
  assert.equal(await queueModule.getAnalysisQueue().getGlobalConcurrency(), 1);

  // A held worker inference and an API completion share the same permit.
  fixtureMode = 'hold';
  const capacityRun = await runs.createAnalysisRun('a', reanalyze);
  await waitFor(() => pendingModelReplies.length > 0, 'held worker capacity');
  const { llm } = await import('../apps/api/dist/lib/llm.js');
  const summaryAbort = new AbortController();
  const callsBeforeSummary = inferenceCalls;
  const apiCompletion = llm.complete({ messages: [{ role: 'user', content: 'Capacity fixture' }] }, summaryAbort.signal).catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(inferenceCalls, callsBeforeSummary, 'API must wait for worker capacity');
  summaryAbort.abort(); await apiCompletion;
  await runs.cancelAnalysisRun(capacityRun.id, 'a');
  await waitFor(async () => (await runs.getAnalysisRun(capacityRun.id, 'a')).status === 'cancelled', 'capacity cancellation');
  for (const complete of pendingModelReplies.splice(0)) complete();
  console.log('Redis loss reconciliation and shared API/worker model capacity passed.');
} finally {
  if (worker && worker.exitCode === null) { const exited = once(worker, 'exit'); worker.kill('SIGKILL'); await exited; }
  if (queueModule) await queueModule.closeAnalysisQueue();
  if (modelServer) { modelServer.closeAllConnections(); await new Promise(resolve => modelServer.close(resolve)); }
  if (db) await db.$disconnect();
  for (const container of containers.reverse()) spawnSync('docker', ['rm', '-f', container], { encoding: 'utf8' });
}
