import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const name = `hia-run-check-${randomUUID().slice(0, 8)}`;
const containers = [];
let db;
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
  Object.assign(process.env, {
    NODE_ENV: 'test', DATABASE_URL: `postgresql://check:check@127.0.0.1:${port}/check`,
    REDIS_URL: 'redis://127.0.0.1:6379', JWT_ACCESS_SECRET: 'run-check-access-secret-xxxxxxxxxxxx',
    JWT_REFRESH_SECRET: 'run-check-refresh-secret-xxxxxxxxxxxx', LLM_PROVIDER: 'local',
    LLM_MODEL: 'fixture-model', LLM_RETRIES: '0',
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
} finally {
  if (db) await db.$disconnect();
  for (const container of containers.reverse()) spawnSync('docker', ['rm', '-f', container], { encoding: 'utf8' });
}
