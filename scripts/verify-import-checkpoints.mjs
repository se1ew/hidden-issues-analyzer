import assert from 'node:assert/strict';
import request from 'supertest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker } from 'bullmq';

// Invoked only by the runner after it creates its disposable database and stops its worker.
export async function verifyImportCheckpoints(app, db) {
  const { signAccessToken } = await import('../apps/api/dist/middleware/auth.js');
  const token = userId => signAccessToken({ sub: userId, email: `${userId}@run.test` });
  const http = (method, route, userId = 'a') => request(app)[method](`/api/${route}`).auth(token(userId), { type: 'bearer' });
  const product = await db.product.create({ data: { name: 'Streaming CSV', userId: 'a', source: 'local' } });
  const other = await db.product.create({ data: { name: 'Other CSV', userId: 'a', source: 'local' } });
  const upload = (buffer, productId = product.id, key) => {
    const req = http('post', 'reviews/upload/csv');
    if (key) req.set('Idempotency-Key', key);
    return req.field('productId', productId).attach('file', buffer, 'input.csv');
  };
  const csv = Buffer.from('text,rating\n"ОК",5\n"ОК",5\n,9\n');
  const preview = await http('post', 'reviews/upload/csv/preview').attach('file', csv, 'input.csv').expect(200);
  assert.equal(preview.body.validCount, 2); assert.equal(preview.body.errorCount, 1);
  assert.equal(await db.review.count({ where: { productId: product.id } }), 0);
  const first = await upload(csv).expect(201);
  assert.equal(first.body.count, 2); assert.equal(first.body.status, 'partial');
  const again = await upload(csv).expect(201);
  assert.equal(again.body.batchId, first.body.batchId);
  assert.equal(await db.review.count({ where: { productId: product.id } }), 2);
  assert.equal((await upload(csv, other.id).expect(201)).body.count, 2);
  await http('get', `reviews/imports/${first.body.batchId}`, 'b').expect(404);
  await http('get', `reviews/imports/${first.body.batchId}/errors`, 'b').expect(404);
  await request(app).get(`/api/reviews/imports/${first.body.batchId}`).expect(401);

  // Fail the third transaction after two complete 100-record checkpoints.
  const interruptedFile = Buffer.from('text\n' + Array.from({ length: 201 }, (_, i) => i === 200 ? 'FAIL-CHECKPOINT' : `Повторяемый текст ${i % 2}`).join('\n'));
  await db.$executeRawUnsafe(`CREATE FUNCTION fail_import_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.text = 'FAIL-CHECKPOINT' THEN RAISE EXCEPTION 'fixture checkpoint failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER fail_import_fixture BEFORE INSERT ON "Review" FOR EACH ROW EXECUTE FUNCTION fail_import_fixture()`);
  let interrupted;
  try {
    interrupted = await upload(interruptedFile).expect(503);
    const saved = await db.uploadBatch.findUniqueOrThrow({ where: { id: interrupted.body.details.batchId } });
    assert.equal(saved.status, 'interrupted'); assert.equal(saved.processedCount, 200); assert.equal(saved.addedCount, 200);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER fail_import_fixture ON "Review"');
    await db.$executeRawUnsafe('DROP FUNCTION fail_import_fixture()');
  }
  const resumed = await upload(interruptedFile).expect(201);
  assert.equal(resumed.body.batchId, interrupted.body.details.batchId);
  assert.equal(resumed.body.count, 201);
  assert.equal(await db.review.count({ where: { uploadBatchId: resumed.body.batchId } }), 201);
  const batch = await db.uploadBatch.findUniqueOrThrow({ where: { id: resumed.body.batchId } });
  assert.equal(batch.processedCount, 201); assert.equal(batch.status, 'completed');
  const concurrentFile = Buffer.from('text\n' + Array.from({ length: 205 }, (_, i) => `concurrent ${i}`).join('\n'));
  const simultaneous = await Promise.all([upload(concurrentFile), upload(concurrentFile)]);
  assert.deepEqual(simultaneous.map(result => result.status), [201, 201]);
  assert.equal(simultaneous[0].body.batchId, simultaneous[1].body.batchId);
  assert.equal(await db.review.count({ where: { uploadBatchId: simultaneous[0].body.batchId } }), 205);
  await upload(Buffer.from('text\nInitial\n'), product.id, 'explicit-key').expect(201);
  await upload(Buffer.from('text\nChanged\n'), product.id, 'explicit-key').expect(409);
  console.log('Streaming import: bounded preview, repeated files without external IDs, independent short duplicates, other products, owner isolation, interrupted checkpoints and concurrent replay passed.');

  const { processNextParsing } = await import('../apps/api/dist/services/parsing-worker.service.js');
  const imports = await import('../apps/api/dist/lib/import-queue.js');
  const { analysisRedisConnection } = await import('../apps/api/dist/lib/analysis-queue.js');
  const sourceWorker = new Worker(imports.importQueueName, job => processNextParsing(undefined, job.data.batchId), { connection: analysisRedisConnection(true), concurrency: 1 });
  sourceWorker.on('error', () => undefined);
  const performQueuedImport = async id => {
    await imports.dispatchQueuedImports();
    for (let attempt = 0; attempt < 200; attempt++) {
      const batch = await db.uploadBatch.findUniqueOrThrow({ where: { id } });
      if (!['pending', 'running'].includes(batch.status)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail('Import queue did not finish the fixture job');
  };
  const originalFetch = globalThis.fetch;
  let changedFormat = false;
  globalThis.fetch = async url => new Response(JSON.stringify(String(url).endsWith('card.json') ? { imt_id: 77 } : changedFormat ? { changed: true } : { feedbacks: [
    { id: 'wb-review', productDetails: { nmId: 123 }, text: 'Хорошо, но крышка заедает.', productValuation: 5, createdDate: '2026-10-10T00:00:00Z' },
    { id: 'wb-sibling', productDetails: { nmId: 124 }, text: 'Другой товар' },
  ] }));
  try {
    await sourceWorker.pause();
    const queued = await http('post', 'parsing/start').send({ url: '123' }).expect(202);
    const same = await http('post', 'parsing/start').send({ url: 'https://www.wildberries.ru/catalog/123/detail.aspx' }).expect(202);
    assert.equal(same.body.jobId, queued.body.jobId);
    await http('get', `parsing/status/${queued.body.jobId}`, 'b').expect(404);
    await http('post', `parsing/status/${queued.body.jobId}/cancel`, 'b').expect(404);
    await imports.dispatchQueuedImports();
    assert(await imports.getImportQueue().getJob(queued.body.jobId));
    await imports.getImportQueue().drain(); // Simulate loss of Redis delivery state.
    assert.equal(await imports.getImportQueue().getJob(queued.body.jobId), undefined);
    await imports.dispatchQueuedImports(); await sourceWorker.resume();
    await performQueuedImport(queued.body.jobId);
    const done = await http('get', `parsing/status/${queued.body.jobId}`).expect(200);
    assert.equal(done.body.status, 'completed'); assert.equal(done.body.reviewsAdded, 1); assert.equal(done.body.historyComplete, false);
    const repeat = await http('post', 'parsing/start').send({ url: '123' }).expect(202);
    await performQueuedImport(repeat.body.jobId);
    const repeated = await http('get', `parsing/status/${repeat.body.jobId}`).expect(200);
    assert.equal(repeated.body.reviewsAdded, 0); assert.equal(repeated.body.skippedCount, 1);
    const stopped = await http('post', 'parsing/start').send({ url: '123' }).expect(202);
    await http('post', `parsing/status/${stopped.body.jobId}/cancel`).expect(204);
    await imports.dispatchQueuedImports();
    assert.equal((await http('get', `parsing/status/${stopped.body.jobId}`)).body.errorCode, 'owner_cancelled');
    changedFormat = true;
    const failed = await http('post', 'parsing/start').send({ url: '123' }).expect(202);
    await performQueuedImport(failed.body.jobId);
    const failure = await http('get', `parsing/status/${failed.body.jobId}`);
    assert.equal(failure.body.status, 'failed'); assert.equal(failure.body.errorCode, 'source_format_changed');
    assert.equal(await db.review.count({ where: { productId: queued.body.internalProductId } }), 1);
  } finally { await sourceWorker.close(); await imports.closeImportQueue(); globalThis.fetch = originalFetch; }
  console.log('Queued source import: shared worker contract, nmId isolation, stable external IDs, repeated downloads, cancellation, ownership and explicit format failure passed with controlled HTTP responses.');

  const { extractReview, extractionCacheKey } = await import('../apps/api/dist/services/chunked-extraction.service.js');
  let modelCalls = 0;
  const provider = { config: { provider: 'local', baseUrl: 'http://127.0.0.1/fixture', model: 'cache-fixture', contextTokens: 1024, maxOutputTokens: 256 },
    completeJson: async request => { modelCalls++; request.onUsage?.({ promptTokens: 12, completionTokens: 4, totalTokens: 16 });
      return { sentiment: 'positive', sentiment_score: 0.5, aspects: [], complaints: [] }; } };
  const extraction = { userId: 'a', text: 'Проверка сохранённого ответа', prompt: 'fixture', promptVersion: 'fixture-v1', methodVersion: 'extraction-v4', modelVersion: 'fixture-revision' };
  const metrics = () => ({ chunks: 0, cacheHit: false, usage: {}, responses: 0 });
  const miss = metrics(); await extractReview(extraction, provider, undefined, miss);
  assert.equal(miss.cacheHit, false); assert.equal(miss.usage.totalTokens, 16);
  const hit = metrics(); await extractReview(extraction, provider, undefined, hit);
  assert.equal(hit.cacheHit, true); assert.equal(modelCalls, 1);
  const key = extractionCacheKey(extraction, provider);
  await db.extractionCache.update({ where: { id: key }, data: { expiresAt: new Date(0) } });
  await extractReview(extraction, provider); assert.equal(modelCalls, 2);
  await extractReview({ ...extraction, userId: 'b' }, provider); assert.equal(modelCalls, 3);
  console.log('Extraction cache: persisted validated response, owner isolation, expiry, hit/miss and actual token usage passed.');

  const historical = await db.reviewAnalysis.findFirstOrThrow({ where: { status: 'succeeded' } });
  await db.reviewAnalysis.update({ where: { id: historical.id }, data: { finishedAt: new Date(Date.now() - 100 * 86400000),
    diagnostics: { evidencePending: true, legacyIssues: ['legacy complaint'], offsetUnit: 'utf16', providerError: 'transient fixture detail', cacheHit: false } } });
  const { maintainStorage } = await import('../apps/api/dist/services/retention.service.js');
  await maintainStorage(true);
  const preserved = await db.reviewAnalysis.findUniqueOrThrow({ where: { id: historical.id } });
  assert.equal(preserved.diagnostics.providerError, undefined); assert.equal(preserved.diagnostics.evidencePending, true);
  assert.deepEqual(preserved.diagnostics.legacyIssues, ['legacy complaint']); assert.equal(preserved.diagnostics.offsetUnit, 'utf16');
  console.log('Retention: transient diagnostics expire without erasing evidence-validation flags, legacy complaints or offset semantics.');

  const candidates = await db.product.findMany({ where: { userId: 'a', publishedGroupingId: { not: null }, analysisRuns: { none: { status: { in: ['queued', 'running'] } } }, reports: { none: { status: { in: ['queued', 'running'] } } } } });
  assert(candidates.length, 'Need a completed product with sealed evidence to verify deletion');
  const target = candidates[0];
  const published = await db.groupingPublication.findUniqueOrThrow({ where: { id: target.publishedGroupingId } });
  await assert.rejects(db.groupingPublication.delete({ where: { id: published.id } }));
  const { REPORTS_DIR } = await import('../apps/api/dist/services/reports.service.js');
  const artifact = path.join(REPORTS_DIR, `report-${randomUUID()}.pdf`);
  await fs.writeFile(artifact, 'purge fixture');
  await db.report.create({ data: { userId: 'a', productId: target.id, runId: published.runId, title: 'Purge fixture', format: 'pdf', filePath: artifact, status: 'completed', legacy: true } });
  const foreignBefore = await db.product.count({ where: { userId: 'b' } });
  await http('delete', `products/${target.id}`, 'b').expect(404);
  assert(await db.groupingPublication.findUnique({ where: { id: published.id } }));
  await http('delete', `products/${target.id}`).expect(204);
  assert.equal(await db.product.findUnique({ where: { id: target.id } }), null);
  assert.equal(await db.analysisRun.count({ where: { productId: target.id } }), 0);
  assert.equal(await db.issueClusterSnapshot.count({ where: { productId: target.id } }), 0);
  assert.equal(await db.review.count({ where: { productId: target.id } }), 0);
  assert.equal(await db.report.count({ where: { productId: target.id } }), 0);
  assert.equal(await db.product.count({ where: { userId: 'b' } }), foreignBefore);
  await assert.rejects(fs.stat(artifact));
  console.log('Product deletion: sealed history remains immutable normally; owner-authorized terminal product purge removes its reports, artifacts, runs and evidence without affecting another owner.');
}
