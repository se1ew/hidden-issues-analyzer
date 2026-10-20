import assert from 'node:assert/strict';
import request from 'supertest';
import fs from 'node:fs/promises';
export async function verifyEndToEnd(app, db, waitFor) {
  const registered = await request(app).post('/api/auth/register').set({ 'X-ReviewLens-CSRF': '1', Origin: 'http://localhost:5173' })
    .send({ email: 'e2e@fixture.invalid', password: 'fixture-password-123' }).expect(201);
  const token = registered.body.accessToken;
  const http = (method, route) => request(app)[method](`/api/${route}`).auth(token, { type: 'bearer' });
  const product = await http('post', 'products').send({ name: 'E2E товар' }).expect(201);
  const csv = Buffer.from('text,rating,external_id\n"E2E отзыв один. Крышка заедает, но товар нравится.",5,e2e-1\n"E2E отзыв два. Крышка заедает, в остальном всё хорошо.",4,e2e-2\n');
  const imported = await http('post', 'reviews/upload/csv').field('productId', product.body.id).attach('file', csv, 'e2e.csv').expect(201);
  assert.equal(imported.body.count, 2);
  const started = await http('post', 'analysis/run').send({ productId: product.body.id }).expect(202);
  const runId = started.body.runId;
  await waitFor(async () => ['completed', 'partial', 'failed'].includes((await db.analysisRun.findUniqueOrThrow({ where: { id: runId } })).status), 'E2E model extraction and grouping');
  const run = await http('get', `analysis/runs/${runId}`).expect(200);
  assert.equal(run.body.status, 'completed'); assert.equal(run.body.succeeded, 2);
  const evidence = await http('get', `analysis/runs/${runId}/inputs`).expect(200);
  for (const input of evidence.body.items) {
    assert.equal(input.analysis.issues.length, 1);
    const issue = input.analysis.issues[0]; assert.equal(input.text.slice(issue.quoteStart, issue.quoteEnd), 'Крышка заедает');
  }
  const live = await http('get', 'reviews').query({ productId: product.body.id, hasIssues: true, pageSize: 1 }).expect(200);
  assert.equal(live.body.total, 2); assert.equal(live.body.items.length, 1);
  assert.equal((await http('get', 'reviews').query({ productId: product.body.id, hasIssues: false }).expect(200)).body.total, 0);
  const groups = await http('get', 'issues/groupings').query({ productId: product.body.id, runId }).expect(200);
  assert.equal(groups.body.total, 1); const group = groups.body.items[0]; assert.equal(group.reviewCount, 2);
  await http('patch', `issues/problems/${group.problem.id}/state`).send({ status: 'confirmed', expectedVersion: 0 }).expect(200);
  const report = await http('post', 'reports/generate').send({ productId: product.body.id, runId, period: null, format: 'docx', sections: ['overview', 'problems', 'evidence', 'method'] }).expect(202);
  await waitFor(async () => (await db.report.findUniqueOrThrow({ where: { id: report.body.id } })).status === 'completed', 'E2E report rendering');
  const saved = await db.report.findUniqueOrThrow({ where: { id: report.body.id } });
  assert.equal(saved.parameters.snapshot.run.succeeded, 2);
  assert.equal(saved.parameters.snapshot.groups[0].problem.status, 'confirmed');
  await http('get', `reports/${report.body.id}/download`).expect(200);
  const bytes = await fs.readFile(saved.filePath); assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  await request(app).get(`/api/reports/${report.body.id}/download`).expect(401);
  await fs.rm(saved.filePath);
  console.log('End-to-end HTTP: registration → product → streaming CSV → real worker with controlled model and cached fixture vectors → exact quotes → confirmation → frozen DOCX report and download passed.');
}
