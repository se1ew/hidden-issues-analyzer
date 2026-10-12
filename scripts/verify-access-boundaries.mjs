import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { io as connect } from 'socket.io-client';

const root = fileURLToPath(new URL('../', import.meta.url));
const name = `hia-access-check-${randomUUID().slice(0, 8)}`;
const reportFiles = [];
const sockets = [];
let db, io, server, modelServer;
let fixtureAvailable = false;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  assert.equal(result.status, 0, result.stderr || result.error?.message || `${command} failed`);
  return result.stdout;
}
try {
  run('docker', ['run', '-d', '--name', name, '-e', 'POSTGRES_USER=check', '-e', 'POSTGRES_PASSWORD=check', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'check']).status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, 'PostgreSQL did not become ready');
  const port = run('docker', ['port', name, '5432']).trim().split(':').at(-1);
  modelServer = createServer(async (req, res) => {
    for await (const _chunk of req) { /* Consume the fixture request. */ }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') {
      res.end(JSON.stringify({ data: [{ id: fixtureAvailable ? 'fixture-model' : 'missing-model' }] }));
    } else {
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        sentiment: 'positive', sentiment_score: 0.5, aspects: [], issues: [],
      }) } }] }));
    }
  });
  modelServer.listen(0, '127.0.0.1'); await once(modelServer, 'listening');
  Object.assign(process.env, {
    NODE_ENV: 'test', DATABASE_URL: `postgresql://check:check@127.0.0.1:${port}/check`,
    REDIS_URL: 'redis://127.0.0.1:6379', JWT_ACCESS_SECRET: 'access-boundaries-access-secret-123456',
    JWT_REFRESH_SECRET: 'access-boundaries-refresh-secret-123456', OPENROUTER_API_KEY: 'test-unused-key',
    RATE_LIMIT_MAX: '10000',
    LLM_PROVIDER: 'local', LLM_MODEL: 'fixture-model',
    LLM_BASE_URL: `http://127.0.0.1:${modelServer.address().port}/v1`,
    LLM_RETRIES: '0', LLM_TIMEOUT_MS: '1000',
  });
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], { env: process.env });
  const { createApp } = await import('../apps/api/dist/app.js');
  const { prisma } = await import('../apps/api/dist/lib/prisma.js');
  db = prisma;
  const { signAccessToken } = await import('../apps/api/dist/middleware/auth.js');
  const { initSocketIO, setJobState } = await import('../apps/api/dist/sockets/index.js');
  const { persistImport } = await import('../apps/api/dist/services/imports.service.js');
  const app = createApp();
  const sessionHeaders = { 'X-ReviewLens-CSRF': '1', Origin: 'http://localhost:5173' };
  const credentials = { email: 'cookie-session@test.invalid', password: 'test-password-123' };
  await request(app).post('/api/auth/register').send(credentials).expect(403);
  const registered = await request(app).post('/api/auth/register').set(sessionHeaders).send(credentials).expect(201);
  assert.equal('refreshToken' in registered.body, false);
  const initialCookie = registered.headers['set-cookie'][0].split(';')[0];
  assert(registered.headers['set-cookie'][0].includes('HttpOnly'));
  await request(app).get('/api/auth/me').set('Authorization', `Bearer ${registered.body.accessToken}`).expect(200);
  const login1 = await request(app).post('/api/auth/login').set(sessionHeaders).send(credentials).expect(200);
  const login2 = await request(app).post('/api/auth/login').set(sessionHeaders).send(credentials).expect(200);
  assert.notEqual(login1.headers['set-cookie'][0], login2.headers['set-cookie'][0]);
  await request(app).post('/api/auth/refresh').set('X-ReviewLens-CSRF', '1').send({ refreshToken: initialCookie.split('=')[1] }).expect(401);
  const rotations = await Promise.all([1, 2].map(() => request(app).post('/api/auth/refresh').set(sessionHeaders).set('Cookie', initialCookie)));
  assert.deepEqual(rotations.map(result => result.status).sort(), [200, 401]);
  const rotated = rotations.find(result => result.status === 200);
  assert.equal(rotated.body.user.id, registered.body.user.id);
  assert.equal('refreshToken' in rotated.body, false);
  const currentCookie = rotated.headers['set-cookie'][0].split(';')[0];
  await request(app).get('/api/auth/me').set('Authorization', `Bearer ${rotated.body.accessToken}`).expect(200);
  await request(app).post('/api/auth/refresh').set(sessionHeaders).set('Cookie', initialCookie).expect(401);
  const loggedOut = await request(app).post('/api/auth/logout').set(sessionHeaders).set('Cookie', currentCookie).expect(204);
  assert(loggedOut.headers['set-cookie'][0].includes('Expires=Thu, 01 Jan 1970'));
  await request(app).post('/api/auth/refresh').set(sessionHeaders).set('Cookie', currentCookie).expect(401);
  await request(app).post('/api/auth/logout').set(sessionHeaders).expect(204);
  // A different login remains valid after revoking this session.
  await request(app).post('/api/auth/refresh').set(sessionHeaders).set('Cookie', login1.headers['set-cookie'][0].split(';')[0]).expect(200);
  const racingCookie = login2.headers['set-cookie'][0].split(';')[0];
  const [racingRefresh] = await Promise.all([
    request(app).post('/api/auth/refresh').set(sessionHeaders).set('Cookie', racingCookie),
    request(app).post('/api/auth/logout').set(sessionHeaders).set('Cookie', racingCookie).expect(204),
  ]);
  assert([200, 401].includes(racingRefresh.status));
  if (racingRefresh.status === 200) {
    await request(app).post('/api/auth/refresh').set(sessionHeaders)
      .set('Cookie', racingRefresh.headers['set-cookie'][0].split(';')[0]).expect(401);
  }
  await request(app).post('/api/auth/refresh').set(sessionHeaders).set('Cookie', racingCookie).expect(401);
  console.log('Cookie sessions: register/login, reload refresh, atomic rotation, replay rejection, logout revocation and independent sessions passed.');
  server = createServer(app);
  io = initSocketIO(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const wsUrl = `http://127.0.0.1:${server.address().port}`;
  for (const id of ['a', 'b']) await db.user.create({ data: { id, email: `${id}@test.invalid`, passwordHash: 'unused' } });
  const tokenA = signAccessToken({ sub: 'a', email: 'a@test.invalid' });
  const tokenB = signAccessToken({ sub: 'b', email: 'b@test.invalid' });
  const headersA = { Authorization: `Bearer ${tokenA}` };
  const headersB = { Authorization: `Bearer ${tokenB}` };
  for (const endpoint of ['/api/products', '/api/reviews', '/api/issues', '/api/analysis/stats', '/api/analysis/timeseries', '/api/reports', '/api/parsing/history']) {
    await request(app).get(endpoint).expect(401);
    await request(app).get(endpoint).set('Authorization', 'Bearer invalid').expect(401);
  }
  for (const endpoint of ['/api/reviews/upload/text', '/api/reviews/upload/csv', '/api/analysis/run', '/api/issues/recompute', '/api/reports/generate', '/api/parsing/start']) {
    await request(app).post(endpoint).send({}).expect(401);
  }
  await db.product.create({ data: { id: 'legacy', name: 'Unassigned legacy' } });
  const manualA = await request(app).post('/api/reviews/upload/text').set(headersA).send({ text: '  Мой отзыв  ', productName: 'Shared name', rating: 5 }).expect(201);
  const manualB = await request(app).post('/api/reviews/upload/text').set(headersB).send({ text: 'Секретный отзыв B', productName: 'Shared name', rating: 1 }).expect(201);
  const reviewA = await db.review.findUniqueOrThrow({ where: { id: manualA.body.id } });
  const reviewB = await db.review.findUniqueOrThrow({ where: { id: manualB.body.id } });
  assert.notEqual(reviewA.productId, reviewB.productId);
  assert.equal(reviewA.text, '  Мой отзыв  ');
  assert(reviewA.uploadBatchId);
  assert.equal((await db.uploadBatch.findUniqueOrThrow({ where: { id: reviewA.uploadBatchId } })).userId, 'a');
  assert.equal((await request(app).get('/api/reviews').set(headersA).expect(200)).body.total, 1);
  assert.equal((await request(app).get('/api/products').set(headersA).expect(200)).body.items.length, 1);
  await request(app).get(`/api/reviews/${reviewB.id}`).set(headersA).expect(404);
  await request(app).delete(`/api/reviews/${reviewB.id}`).set(headersA).expect(404);
  await request(app).patch(`/api/products/${reviewB.productId}`).set(headersA).send({ name: 'Stolen' }).expect(404);
  await request(app).delete(`/api/products/${reviewB.productId}`).set(headersA).expect(404);
  await request(app).post('/api/reviews/upload/text').set(headersA).send({ text: 'Injected', productId: reviewB.productId }).expect(404);
  const deletion = await request(app).delete('/api/reviews').query({ productId: reviewB.productId }).set(headersA).expect(200);
  assert.equal(deletion.body.deleted, 0);
  assert.equal(await db.review.count({ where: { id: reviewB.id } }), 1);
  const foreignIssue = await db.hiddenIssue.create({ data: { productId: reviewB.productId, title: 'Secret problem' } });
  await request(app).get(`/api/issues/${foreignIssue.id}`).set(headersA).expect(404);
  await request(app).patch(`/api/issues/${foreignIssue.id}/resolve`).set(headersA).expect(404);
  const recompute = await request(app).post('/api/issues/recompute').set(headersA).send({}).expect(200);
  assert.equal(recompute.body.clustersCreated, 0);
  assert.equal(await db.hiddenIssue.count({ where: { id: foreignIssue.id } }), 1);
  const stats = await request(app).get('/api/analysis/stats').set(headersA).expect(200);
  assert.equal(stats.body.total, 1);
  assert.equal(stats.body.avgRating, 5);
  await db.review.updateMany({ data: { sentiment: 'positive', analyzedAt: new Date() } });
  const series = await request(app).get('/api/analysis/timeseries').set(headersA).expect(200);
  assert.equal(series.body.buckets.reduce((sum, bucket) => sum + bucket.positive, 0), 1);
  await request(app).post('/api/analysis/run').set(headersA).send({ productId: reviewB.productId }).expect(404);
  const foreignReport = await db.report.create({ data: { userId: 'b', title: 'Secret report', format: 'pdf', filePath: 'not-a-public-path' } });
  await request(app).get(`/api/reports/${foreignReport.id}/download`).set(headersA).expect(404);
  await request(app).get(`/api/reports/${foreignReport.id}/download`).expect(401);
  const oldGlobalReport = await db.report.create({ data: { userId: 'a', title: 'Old global report', format: 'pdf', filePath: 'unverified-legacy-path' } });
  await request(app).get(`/api/reports/${oldGlobalReport.id}/download`).set(headersA).expect(404);
  const generated = await request(app).post('/api/reports/generate').set(headersA).send({ format: 'docx' }).expect(201);
  assert.equal('filePath' in generated.body, false);
  const savedReport = await db.report.findUniqueOrThrow({ where: { id: generated.body.id } });
  reportFiles.push(savedReport.filePath);
  const reports = await request(app).get('/api/reports').set(headersA).expect(200);
  assert.equal(reports.body.items.length, 1);
  assert.equal('filePath' in reports.body.items[0], false);
  await request(app).get(`/api/reports/${savedReport.id}/download`).set(headersA).expect(200);
  const foreignBatch = await db.uploadBatch.create({ data: { userId: 'b', productId: reviewB.productId, source: 'parsing', status: 'completed' } });
  await request(app).get(`/api/parsing/status/${foreignBatch.id}`).set(headersA).expect(404);
  assert.equal((await request(app).get('/api/parsing/history').set(headersA).expect(200)).body.items.length, 0);
  console.log('HTTP boundaries: anonymous and foreign reads/writes, analytics, imports, reports and parsing passed.');

  const csv = Buffer.from('text,rating,external_id\n"  Исходный текст  ",4,ext-1\nТот же ID,4,ext-1\n');
  const first = await request(app).post('/api/reviews/upload/csv').set(headersA).field('productId', reviewA.productId).attach('file', csv, 'reviews.csv').expect(201);
  assert.equal(first.body.count, 1);
  assert.equal(first.body.skippedCount, 1);
  const imported = await db.review.findFirstOrThrow({ where: { externalId: 'ext-1', productId: reviewA.productId } });
  const second = await request(app).post('/api/reviews/upload/csv').set(headersA).field('productId', reviewA.productId).attach('file', csv, 'reviews.csv').expect(201);
  assert.equal(second.body.count, 0);
  const repeated = await db.review.findUniqueOrThrow({ where: { id: imported.id } });
  assert.equal(repeated.text, '  Исходный текст  ');
  assert.equal(repeated.uploadBatchId, first.body.batchId);
  assert.equal(repeated.importedAt.getTime(), imported.importedAt.getTime());
  assert.equal(await db.reviewImportOccurrence.count({ where: { reviewId: imported.id } }), 2);
  const batchesBefore = await db.uploadBatch.count();
  await assert.rejects(persistImport({ userId: 'a', productName: 'Rollback product', source: 'manual', rows: [{ text: null }] }));
  assert.equal(await db.uploadBatch.count(), batchesBefore);
  assert.equal(await db.product.count({ where: { name: 'Rollback product' } }), 0);
  const concurrent = { userId: 'a', productName: 'Concurrent WB', source: 'parsing', externalSource: 'wildberries', productExternalId: '123', rows: [{ text: 'Same external ID', externalId: 'wb-1' }] };
  const concurrentResults = await Promise.all([persistImport(concurrent), persistImport(concurrent)]);
  assert.equal(concurrentResults.reduce((sum, result) => sum + result.count, 0), 1);
  console.log('Import integrity: source text, external-ID deduplication, first provenance, repeated sightings, rollback and concurrent imports passed.');

  setJobState('owned-job', { userId: 'a', productId: reviewA.productId, status: 'analyzing', processed: 2, total: 3 });
  await request(app).post('/api/analysis/owned-job/cancel').set(headersB).expect(404);
  await request(app).delete(`/api/products/${reviewA.productId}`).set(headersA).expect(409);
  const anonymous = connect(wsUrl, { autoConnect: false, reconnection: false }); sockets.push(anonymous);
  const refused = once(anonymous, 'connect_error'); anonymous.connect(); await refused;
  const own = connect(wsUrl, { autoConnect: false, reconnection: false, auth: { token: tokenA } }); sockets.push(own);
  const other = connect(wsUrl, { autoConnect: false, reconnection: false, auth: { token: tokenB } }); sockets.push(other);
  const connectedOwn = once(own, 'connect'), connectedOther = once(other, 'connect');
  own.connect(); other.connect(); await Promise.all([connectedOwn, connectedOther]);
  let foreignProgress = false;
  other.on('analysis:progress', () => { foreignProgress = true; });
  other.emit('job:subscribe', 'owned-job');
  const replay = once(own, 'analysis:progress');
  own.emit('job:subscribe', 'owned-job');
  assert.equal((await replay)[0].processed, 2);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(foreignProgress, false);
  assert.equal(io.sockets.adapter.rooms.get('job:owned-job')?.size, 1);
  console.log('Socket boundaries: authenticated handshake, owner-only replay/subscription/cancellation and active deletion guard passed.');

  await request(app).post('/api/products').expect(401);
  await request(app).post('/api/products').set(headersA).send({ name: ' ' }).expect(422);
  const createdProduct = await request(app).post('/api/products').set(headersA).send({ name: 'CSV wizard product' }).expect(201);
  const productId = createdProduct.body.id;
  await request(app).get(`/api/products/${productId}`).set(headersA).expect(200);
  await request(app).get(`/api/products/${productId}`).set(headersB).expect(404);
  await request(app).patch(`/api/products/${productId}`).set(headersA).send({ name: 'x'.repeat(201) }).expect(422);
  await request(app).post('/api/reviews/upload/text').set(headersA).send({ text: 'No selected product' }).expect(422);
  const customCsv = Buffer.from('\uFEFFbody;stars;when;external_id\n"  Точный текст  ";5;2024-02-29;custom-1\n;8;2024-02-30;bad\nКоротко;4;;custom-2\n');
  const mapping = { text: 'body', rating: 'stars', date: 'when', externalId: 'external_id' };
  const beforePreview = await db.uploadBatch.count();
  await request(app).post('/api/reviews/upload/csv/preview').attach('file', customCsv, 'custom.csv').expect(401);
  const preview = await request(app).post('/api/reviews/upload/csv/preview').set(headersA)
    .field('mapping', JSON.stringify(mapping)).attach('file', customCsv, 'custom.csv').expect(200);
  assert.equal(preview.body.totalCount, 3);
  assert.equal(preview.body.validCount, 2);
  assert.equal(preview.body.errorCount, 1);
  assert.equal(preview.body.errors.length, 3);
  assert.equal(preview.body.sample[0].values[0], '  Точный текст  ');
  assert.equal(await db.uploadBatch.count(), beforePreview);
  await request(app).post('/api/reviews/upload/csv').set(headersA).attach('file', customCsv, 'custom.csv').expect(422);
  await request(app).post('/api/reviews/upload/csv').set(headersA).field('productId', reviewB.productId)
    .field('mapping', JSON.stringify(mapping)).attach('file', customCsv, 'custom.csv').expect(404);
  const partial = await request(app).post('/api/reviews/upload/csv').set(headersA).field('productId', productId)
    .field('mapping', JSON.stringify(mapping)).attach('file', customCsv, 'custom.csv').expect(201);
  assert.equal(partial.body.status, 'partial');
  assert.equal(partial.body.count, 2);
  assert.equal(partial.body.validCount, 2);
  assert.equal(partial.body.errorCount, 1);
  const partialBatch = await db.uploadBatch.findUniqueOrThrow({ where: { id: partial.body.batchId } });
  assert.equal(partialBatch.count, partialBatch.addedCount + partialBatch.skippedCount + partialBatch.errorCount);
  assert.equal(partialBatch.status, 'partial');
  const customReview = await db.review.findFirstOrThrow({ where: { productId, externalId: 'custom-2' } });
  assert.equal((await db.reviewImportOccurrence.findFirstOrThrow({ where: { reviewId: customReview.id } })).rowNumber, 4);
  const detailsUrl = `/api/reviews/imports/${partial.body.batchId}`;
  await request(app).get(detailsUrl).set(headersA).expect(200);
  await request(app).get(detailsUrl).set(headersB).expect(404);
  await request(app).get(detailsUrl).expect(401);
  const rowErrors = await request(app).get(`${detailsUrl}/errors`).set(headersA).expect(200);
  assert(rowErrors.text.includes('rating'));
  assert(rowErrors.text.includes('date'));
  assert.equal(rowErrors.text.includes('Точный текст'), false);
  await request(app).get(`${detailsUrl}/errors`).set(headersB).expect(404);
  await request(app).get(`${detailsUrl}/errors`).expect(401);
  const beforeInvalid = await db.uploadBatch.count();
  await request(app).post('/api/reviews/upload/csv').set(headersA).field('productName', 'Must not exist')
    .attach('file', Buffer.from('text,rating\n,8\n'), 'invalid.csv').expect(422);
  await request(app).post('/api/reviews/upload/csv/preview').set(headersA)
    .attach('file', Buffer.from([0x74, 0x65, 0x78, 0x74, 0x0a, 0xff]), 'cp1251.csv').expect(422);
  assert.equal(await db.uploadBatch.count(), beforeInvalid);
  assert.equal(await db.product.count({ where: { name: 'Must not exist' } }), 0);
  const repeatedCustom = await request(app).post('/api/reviews/upload/csv').set(headersA).field('productId', productId)
    .field('mapping', JSON.stringify(mapping)).attach('file', customCsv, 'custom.csv').expect(201);
  assert.equal(repeatedCustom.body.count, 0);
  assert.equal(repeatedCustom.body.skippedCount, 2);
  assert.equal(repeatedCustom.body.errorCount, 1);
  const alternate = await request(app).post('/api/products').set(headersA).send({ name: 'CSV wizard product' }).expect(201);
  assert.notEqual(alternate.body.id, productId);
  const otherProductImport = await request(app).post('/api/reviews/upload/csv').set(headersA).field('productId', alternate.body.id)
    .field('mapping', JSON.stringify(mapping)).attach('file', customCsv, 'custom.csv').expect(201);
  assert.equal(otherProductImport.body.count, 2);
  const noIdCsv = Buffer.from('text\nОК\nОК\n');
  const noIds = await request(app).post('/api/reviews/upload/csv').set(headersA).field('productId', alternate.body.id)
    .attach('file', noIdCsv, 'no-ids.csv').expect(201);
  assert.equal(noIds.body.count, 2);
  await request(app).delete(`/api/products/${alternate.body.id}`).set(headersA).expect(204);
  await request(app).get(`/api/reviews/imports/${noIds.body.batchId}`).set(headersA).expect(404);
  console.log('CSV wizard: explicit products, side-effect-free preview, mapping, row errors, partial counts, owner-only diagnostics, repeat imports, separate products and short identical reviews passed.');
  await request(app).get('/api/analysis/provider').expect(401);
  await request(app).post('/api/analysis/provider/check').expect(401);
  const provider = await request(app).get('/api/analysis/provider').set(headersA).expect(200);
  assert.equal(provider.body.provider, 'local');
  assert.equal(provider.body.model, 'fixture-model');
  assert.equal('apiKey' in provider.body, false);
  assert.equal('baseUrl' in provider.body, false);
  await request(app).post('/api/analysis/provider/check').set(headersA).expect(503);
  const newReview = await request(app).post('/api/reviews/upload/text').set(headersA)
    .send({ text: 'Контракт тестовой модели', productName: 'LLM preflight test' }).expect(201);
  const failedStart = await request(app).post('/api/analysis/run').set(headersA)
    .send({ productId: newReview.body.productId }).expect(503);
  assert.equal(failedStart.body.code, 'model_unavailable');
  assert.equal((await db.review.findUniqueOrThrow({ where: { id: newReview.body.id } })).analyzedAt, null);
  fixtureAvailable = true;
  const modelReady = await request(app).post('/api/analysis/provider/check').set(headersA).expect(200);
  assert.equal(modelReady.body.available, true);
  const started = await request(app).post('/api/analysis/run').set(headersA)
    .send({ productId: newReview.body.productId }).expect(202);
  assert(started.body.jobId);
  for (let attempt = 0; attempt < 40; attempt++) {
    const analyzed = await db.review.findUniqueOrThrow({ where: { id: newReview.body.id } });
    if (analyzed.analyzedAt) { assert.equal(analyzed.sentiment, 'positive'); break; }
    if (attempt === 39) assert.fail('Fixture analysis did not finish');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  console.log('LLM API: authenticated configuration, no secret exposure, preflight rejection without analysis, explicit local readiness and fixture analysis passed.');
} finally {
  for (const socket of sockets) socket.disconnect();
  if (io) await new Promise(resolve => io.close(resolve));
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (modelServer) { modelServer.closeAllConnections(); await new Promise(resolve => modelServer.close(resolve)); }
  if (db) await db.$disconnect();
  const reportRoot = path.resolve(root, 'apps/api/reports_output');
  for (const file of reportFiles) {
    const resolved = path.resolve(file);
    assert(resolved.startsWith(reportRoot + path.sep), 'Report cleanup must stay within reports_output');
    fs.rmSync(resolved, { force: true });
  }
  spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' });
}
