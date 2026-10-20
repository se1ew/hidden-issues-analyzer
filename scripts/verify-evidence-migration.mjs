import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// In-memory PostgreSQL executes the real SQL and PL/pgSQL without touching user DBs.
// This verifies migrations/triggers, not Prisma, Redis or worker processes.
const db = new PGlite();
const migrations = new URL('../apps/api/prisma/migrations/', import.meta.url);
const latest = '20261018130000_evidence_metadata_and_retry_inputs';
try {
  const names = (await readdir(migrations, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  for (const name of names.filter(name => name < latest)) await db.exec(await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'));
  await db.exec(`
    INSERT INTO "User" (id,email,"passwordHash","updatedAt") VALUES ('owner','owner@test.local','unused',now()),('other','other@test.local','unused',now());
    INSERT INTO "Product" (id,name,"userId") VALUES ('product','Test','owner'),('foreign','Foreign','other');
    INSERT INTO "Review" (id,"productId",text,rating) VALUES ('review','product','Крышка заедает',5);
    INSERT INTO "AnalysisRun" (id,"userId","productId",status,scope,settings,provider,model,"modelVersion","promptVersion","embeddingVersion","methodVersion",total,failed)
      VALUES ('parent','owner','product','failed','{}','{}','local','fixture','test','test','none','test',1,1);
    INSERT INTO "AnalysisRunReview" (id,"runId","reviewId","sourceReviewId","inputVersion","inputHash",text,rating,"importedAt",source)
      VALUES ('original','parent','review','review',1,'snapshot-hash','Крышка заедает',5,now(),'manual');
    INSERT INTO "ReviewAnalysis" (id,"runId","runReviewId",status) VALUES ('analysis','parent','original','failed');
    INSERT INTO "AspectMention" (id,"analysisId",category,name,sentiment) VALUES ('aspect','analysis','usability','Удобство','negative');
    INSERT INTO "IssueMention" (id,"runId","analysisId","aspectId",scope,defect,quote,"quoteStart","quoteEnd")
      VALUES ('issue','parent','analysis','aspect','product','заедание','Крышка заедает',0,13);
  `);
  await db.exec(await readFile(new URL(`${latest}/migration.sql`, migrations), 'utf8'));
  // Explicitly attach the legacy fixture to its known import before final constraints.
  await db.exec(`INSERT INTO "UploadBatch" (id,"userId","productId",source) VALUES ('batch','owner','product','manual'); UPDATE "Review" SET "uploadBatchId"='batch' WHERE id='review';`);
  for (const name of names.filter(name => name > latest)) await db.exec(await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'));
  assert.equal((await db.query('SELECT "originalName" FROM "AspectMention"')).rows[0].originalName, null);
  assert.equal((await db.query('SELECT masking FROM "IssueMention"')).rows[0].masking, null);
  await db.exec(`UPDATE "Review" SET text='Изменённый текст', "inputVersion"=2 WHERE id='review'`);

  const makeChild = async (id, product = 'product', owner = 'owner') => {
    await db.query(`INSERT INTO "AnalysisRun" (id,"userId","productId","previousRunId",status,scope,settings,provider,model,"modelVersion","promptVersion","embeddingVersion","methodVersion",total)
      VALUES ($1,$2,$3,'parent','cancelled','{"retry":{"kind":"failed_only","sourceRunId":"parent"}}','{}','local','fixture','test','test','none','test',1)`, [id, owner, product]);
  };
  const copy = async (id, child, field = 'text', expression = 'text') => {
    const fields = ['"reviewId"','"sourceReviewId"','"inputVersion"','"inputHash"','text','rating','"reviewDate"','"importedAt"','source','"externalId"','"authorExternalId"','"uploadBatchId"'];
    await db.query(`INSERT INTO "AnalysisRunReview" (id,"runId",${fields.join(',')})
      SELECT $1,$2,${fields.map(name => name === field ? expression : name).join(',')} FROM "AnalysisRunReview" WHERE id='original'`, [id, child]);
  };
  await makeChild('retry-edited');
  await copy('copy-edited','retry-edited');
  assert.equal((await db.query(`SELECT text FROM "AnalysisRunReview" WHERE id='copy-edited'`)).rows[0].text, 'Крышка заедает');
  await makeChild('tampered');
  await assert.rejects(copy('copy-tampered','tampered','text',"'Подмена'"), error => error.code === '23514');
  await assert.rejects(copy('copy-wrong-rating','tampered','rating','1'), error => error.code === '23514');
  await assert.rejects(makeChild('wrong-owner','foreign','other'), error => error.code === '23503');
  await db.exec(`UPDATE "ReviewAnalysis" SET status='succeeded' WHERE id='analysis'`);
  await assert.rejects(copy('copy-success','tampered'), error => error.code === '23514');
  await db.exec(`UPDATE "ReviewAnalysis" SET status='failed' WHERE id='analysis'; DELETE FROM "Review" WHERE id='review'`);
  await makeChild('retry-deleted');
  await copy('copy-deleted','retry-deleted');
  assert.equal((await db.query(`SELECT "reviewId" FROM "AnalysisRunReview" WHERE id='copy-deleted'`)).rows[0].reviewId, null);
  await assert.rejects(db.exec(`UPDATE "AnalysisRunReview" SET text='Подмена' WHERE id='copy-deleted'`), error => error.code === '23514');
  console.log('Evidence migration: all saved migrations, nullable legacy metadata, retries after edit/deletion, exact parent copy, successful-input rejection, owner boundary and input immutability passed.');
} finally { await db.close(); }
