import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const root = fileURLToPath(new URL('../', import.meta.url));
const migrations = path.join(root, 'apps/api/prisma/migrations');
const name = `hia-migration-check-${randomUUID().slice(0, 8)}`;
const { values } = parseArgs({ options: { 'source-container': { type: 'string' }, 'backup-file': { type: 'string' } } });
const clients = [];
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, result.stderr || result.error?.message || `${command} failed`);
  return result.stdout;
}
function sql(database, text) {
  return run('docker', ['exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'check', '-d', database], { input: text });
}
function deploy(database, port) {
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], {
    env: { ...process.env, DATABASE_URL: `postgresql://check:check@127.0.0.1:${port}/${database}` },
  });
}
function client(database, port) {
  const db = new PrismaClient({ datasources: { db: { url: `postgresql://check:check@127.0.0.1:${port}/${database}` } } });
  clients.push(db);
  return db;
}
try {
  run('docker', ['run', '-d', '--name', name, '-e', 'POSTGRES_USER=check', '-e', 'POSTGRES_PASSWORD=check', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
  let ready = false;
  for (let i = 0; i < 40; i++) {
    const result = spawnSync('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'check'], { encoding: 'utf8' });
    if (result.status === 0) { ready = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(ready, 'Isolated PostgreSQL did not become ready');
  const port = run('docker', ['port', name, '5432']).trim().split(':').at(-1);
  sql('check', 'CREATE DATABASE clean; CREATE DATABASE legacy; CREATE DATABASE restored;');
  deploy('clean', port);
  console.log('Clean installation: all migrations applied.');

  const dirs = fs.readdirSync(migrations).filter((entry) => fs.existsSync(path.join(migrations, entry, 'migration.sql'))).sort();
  const legacyDirs = dirs.filter(entry => entry < '20261012120000_add_analysis_domain');
  const domainDirs = dirs.filter(entry => entry >= '20261012120000_add_analysis_domain');
  for (const entry of legacyDirs) sql('legacy', fs.readFileSync(path.join(migrations, entry, 'migration.sql'), 'utf8'));
  sql('legacy', `
    INSERT INTO "User" (id,email,"passwordHash","updatedAt") VALUES ('u1','one@test.invalid','unused',now()), ('u2','two@test.invalid','unused',now());
    INSERT INTO "Product" (id,name) VALUES ('p1','Legacy product');
    INSERT INTO "HiddenIssue" (id,"productId",title) VALUES ('h1','p1','Old complaint');
    INSERT INTO "Review" (id,"productId",text,rating,"analyzedAt",sentiment,"hiddenIssueId","createdAt")
    VALUES ('r1','p1','Красивый, но шумит.',5,now(),'positive','h1','2026-01-01'), ('r2',null,'Без товара',null,null,null,null,'2026-01-02');
    INSERT INTO "UploadBatch" (id,"userId",source,count) VALUES ('b1','u1','csv',2);
    INSERT INTO "Report" (id,"userId",title,format,"filePath") VALUES ('f1','u1','Old report','pdf','legacy.pdf');
  `);
  const dump = run('docker', ['exec', name, 'pg_dump', '-U', 'check', '-d', 'legacy', '--no-owner', '--no-privileges']);
  sql('restored', dump);
  assert.equal(sql('legacy', 'SELECT row_to_json(r) FROM "Review" r ORDER BY id;'), sql('restored', 'SELECT row_to_json(r) FROM "Review" r ORDER BY id;'));
  const ownerMigration = '20261020150000_require_product_owner';
  for (const entry of domainDirs.filter(entry => entry < ownerMigration)) sql('restored', fs.readFileSync(path.join(migrations, entry, 'migration.sql'), 'utf8'));
  const db = client('restored', port);
  // Transitional rows contain nullable fields that the final Client disallows.
  const [review] = await db.$queryRawUnsafe(`SELECT * FROM "Review" WHERE id = 'r1'`);
  assert.equal(review.text, 'Красивый, но шумит.');
  assert.equal(review.hiddenIssueId, 'h1');
  assert.equal(review.legacyAnalysis, true);
  assert.equal(review.importedAt.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(review.uploadBatchId, null);
  assert.equal((await db.$queryRawUnsafe(`SELECT "userId" FROM "Product" WHERE id = 'p1'`))[0].userId, null);
  assert.equal(await db.issueMention.count(), 0);
  assert.equal((await db.$queryRawUnsafe(`SELECT "productId" FROM "Review" WHERE id = 'r2'`))[0].productId, null);
  console.log('Legacy backup/restore: text, dates, owners, old results preserved; no invented provenance or quotes.');
  assert.throws(() => sql('restored', fs.readFileSync(path.join(migrations, ownerMigration, 'migration.sql'), 'utf8')),
    /Assign every legacy product explicitly/);

  const assignmentEnv = { ...process.env, DATABASE_URL: `postgresql://check:check@127.0.0.1:${port}/restored` };
  run(process.execPath, ['scripts/assign-legacy-product.mjs', '--product', 'p1', '--user', 'u1'], { env: assignmentEnv });
  assert.equal((await db.$queryRawUnsafe(`SELECT "userId" FROM "Product" WHERE id = 'p1'`))[0].userId, null);
  run(process.execPath, ['scripts/assign-legacy-product.mjs', '--product', 'p1', '--user', 'u1', '--apply'], { env: assignmentEnv });
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: 'p1' } })).userId, 'u1');
  const reassignment = spawnSync(process.execPath, ['scripts/assign-legacy-product.mjs', '--product', 'p1', '--user', 'u2', '--apply'], { cwd: root, encoding: 'utf8', env: assignmentEnv });
  assert.notEqual(reassignment.status, 0);
  sql('restored', fs.readFileSync(path.join(migrations, ownerMigration, 'migration.sql'), 'utf8'));
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "Product" (id,name) VALUES ('ownerless','Rejected')`));
  const provenanceMigration = '20261020151000_require_review_provenance';
  assert.throws(() => sql('restored', fs.readFileSync(path.join(migrations, provenanceMigration, 'migration.sql'), 'utf8')), /Explicitly link legacy reviews/);
  for (const id of ['r1', 'r2']) {
    const link = ['scripts/link-legacy-review.mjs', '--review', id, '--product', 'p1', '--batch', 'b1', '--reason', 'Verified synthetic fixture origin'];
    run(process.execPath, link, { env: assignmentEnv });
    assert.equal((await db.$queryRawUnsafe(`SELECT "uploadBatchId" FROM "Review" WHERE id = '${id}'`))[0].uploadBatchId, null);
    run(process.execPath, [...link, '--apply'], { env: assignmentEnv });
  }
  for (const entry of domainDirs.filter(entry => entry > ownerMigration)) sql('restored', fs.readFileSync(path.join(migrations, entry, 'migration.sql'), 'utf8'));
  const archived = await db.legacyReviewResult.findUniqueOrThrow({ where: { reviewId: 'r1' } });
  assert.equal(archived.payload.hiddenIssueId, 'h1');
  assert.equal(archived.payload.legacyAnalysis, true);
  assert.equal((await db.$queryRawUnsafe(`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_name='Review' AND column_name IN ('hiddenIssueId','sentiment','issues','aspects','analyzedAt')`))[0].count, 0);
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "Review" (id,text) VALUES ('orphan','Rejected')`));
  assert.equal((await db.review.findUniqueOrThrow({ where: { id: 'r1' } })).uploadBatchId, 'b1');
  await db.product.create({ data: { id: 'other-product', name: 'Other', userId: 'u1' } });
  await assert.rejects(db.review.create({ data: { productId: 'other-product', uploadBatchId: 'b1', text: 'Wrong import' } }), { code: 'P2003' });
  await db.uploadBatch.create({ data: { id: 'other-batch', userId: 'u1', productId: 'other-product', source: 'manual' } });
  await db.review.create({ data: { id: 'foreign-review', productId: 'other-product', uploadBatchId: 'other-batch', text: 'Other product' } });
  const runData = { userId: 'u1', productId: 'p1', scope: {}, settings: {}, provider: 'test', model: 'test', modelVersion: '1', promptVersion: '1', embeddingVersion: '1', methodVersion: '1', total: 1 };
  await assert.rejects(db.analysisRun.create({ data: { ...runData, userId: 'u2' } }), { code: 'P2003' });
  const first = await db.analysisRun.create({ data: runData });
  await assert.rejects(db.analysisRun.create({ data: runData }), { code: 'P2002' });
  await assert.rejects(db.analysisRun.update({ where: { id: first.id }, data: { succeeded: 2 } }));
  await assert.rejects(db.analysisRun.update({ where: { id: first.id }, data: { status: 'completed' } }));
  await db.analysisRun.update({ where: { id: first.id }, data: { status: 'cancelled', finishedAt: new Date() } });
  const second = await db.analysisRun.create({ data: runData });
  await assert.rejects(db.analysisRunReview.create({ data: { runId: first.id, reviewId: 'foreign-review', sourceReviewId: 'foreign-review', inputVersion: 1, inputHash: 'fixture', text: 'Other product', importedAt: new Date(), source: 'legacy' } }));
  const input = await db.analysisRunReview.create({ data: { runId: first.id, reviewId: 'r1', sourceReviewId: 'r1', inputVersion: 1, inputHash: 'fixture', text: review.text, rating: 5, importedAt: review.importedAt, source: 'legacy' } });
  await assert.rejects(db.analysisRunReview.update({ where: { id: input.id }, data: { text: 'Changed input' } }));
  await assert.rejects(db.analysisRunReview.create({ data: { runId: first.id, reviewId: 'r1', sourceReviewId: 'r1', inputVersion: 1, inputHash: 'fixture', text: review.text, importedAt: review.importedAt, source: 'legacy' } }), { code: 'P2002' });
  await assert.rejects(db.reviewAnalysis.create({ data: { runId: second.id, runReviewId: input.id } }), { code: 'P2003' });
  const analysis = await db.reviewAnalysis.create({ data: { runId: first.id, runReviewId: input.id, status: 'succeeded', sentiment: 'positive' } });
  const aspect = await db.aspectMention.create({ data: { analysisId: analysis.id, category: 'functionality', name: 'Шум', sentiment: 'negative' } });
  const quoteStart = review.text.indexOf('шумит');
  const mention = await db.issueMention.create({ data: { runId: first.id, analysisId: analysis.id, aspectId: aspect.id, scope: 'product', defect: 'Шумит', quote: 'шумит', quoteStart, quoteEnd: quoteStart + 'шумит'.length } });
  const clusterData = { productId: 'p1', title: 'Шум', defect: 'Шумит', scope: 'product', category: 'functionality', reviewCount: 1, positiveContextCount: 1, analyzedCount: 1 };
  const cluster = await db.issueClusterSnapshot.create({ data: { ...clusterData, runId: first.id } });
  const otherCluster = await db.issueClusterSnapshot.create({ data: { ...clusterData, runId: second.id } });
  await db.issueClusterMember.create({ data: { runId: first.id, clusterId: cluster.id, issueMentionId: mention.id } });
  await assert.rejects(db.issueClusterMember.create({ data: { runId: second.id, clusterId: otherCluster.id, issueMentionId: mention.id } }), { code: 'P2003' });
  await db.review.delete({ where: { id: 'r1' } });
  const preserved = await db.analysisRunReview.findUniqueOrThrow({ where: { id: input.id } });
  assert.equal(preserved.reviewId, null);
  assert.equal(preserved.text, review.text);
  assert.equal(await db.issueMention.count(), 1);
  console.log('Database constraints: owner isolation, one active run, counts, unique inputs, run isolation, preserved snapshots passed.');

  if (values['backup-file']) {
    sql('check', 'CREATE DATABASE saved_backup;');
    run('docker', ['cp', path.resolve(values['backup-file']), `${name}:/tmp/saved-backup.dump`]);
    run('docker', ['exec', name, 'pg_restore', '-U', 'check', '-d', 'saved_backup', '--no-owner', '--no-privileges', '--exit-on-error', '/tmp/saved-backup.dump']);
    deploy('saved_backup', port);
    const saved = client('saved_backup', port);
    await saved.review.count();
    console.log('Saved custom backup: restored successfully and migrated.');
  }

  if (values['source-container']) {
    dotenv.config({ path: path.join(root, 'apps/api/.env'), quiet: true });
    const source = new URL(process.env.DATABASE_URL);
    const sourceDb = decodeURIComponent(source.pathname.slice(1));
    const sourceUser = decodeURIComponent(source.username);
    const realDump = run('docker', ['exec', values['source-container'], 'pg_dump', '-U', sourceUser, '-d', sourceDb, '--no-owner', '--no-privileges']);
    sql('check', 'CREATE DATABASE actual_copy;');
    sql('actual_copy', realDump);
    const actual = client('actual_copy', port);
    const rowsBefore = await actual.$queryRawUnsafe('SELECT id, text, "createdAt", "productId", "uploadBatchId", rating, "reviewDate", "externalId" FROM "Review" ORDER BY id');
    deploy('actual_copy', port);
    const rowsAfter = await actual.$queryRawUnsafe('SELECT id, text, "createdAt", "productId", "uploadBatchId", rating, "reviewDate", "externalId" FROM "Review" ORDER BY id');
    assert.deepEqual(rowsAfter, rowsBefore);
    console.log(`Actual database copy: migrated and preserved ${rowsAfter.length} reviews; source database unchanged.`);
  }
} finally {
  await Promise.all(clients.map((db) => db.$disconnect()));
  spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' });
}
