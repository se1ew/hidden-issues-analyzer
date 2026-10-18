import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
try {
  const root = new URL('../apps/api/prisma/migrations/', import.meta.url);
  const migrations = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  for (const name of migrations) await db.exec(await readFile(new URL(`${name}/migration.sql`, root), 'utf8'));
  await db.exec(`
    INSERT INTO "User" (id,email,"passwordHash","updatedAt") VALUES ('owner','owner@grouping.test','unused',now()),('other','other@grouping.test','unused',now());
    INSERT INTO "Product" (id,name,"userId") VALUES ('p','Product','owner'),('foreign','Other','other');
    INSERT INTO "AnalysisRun" (id,"userId","productId",status,scope,settings,provider,model,"modelVersion","promptVersion","embeddingVersion","methodVersion",total,succeeded)
      VALUES ('run','owner','p','running','{}','{}','local','fixture','test','test','test','test',4,4),
        ('foreign-run','other','foreign','failed','{}','{}','local','fixture','test','test','test','test',0,0);
    INSERT INTO "Review" (id,"productId",text,rating) SELECT 'r'||n,'p','шумит',5 FROM generate_series(1,4) n;
    INSERT INTO "AnalysisRunReview" (id,"runId","reviewId","sourceReviewId","inputVersion","inputHash",text,rating,"importedAt",source)
      SELECT 'i'||n,'run','r'||n,'r'||n,1,'hash'||n,'шумит',5,now(),'manual' FROM generate_series(1,4) n;
    INSERT INTO "ReviewAnalysis" (id,"runId","runReviewId",status,sentiment) SELECT 'a'||n,'run','i'||n,'succeeded','positive' FROM generate_series(1,4) n;
    INSERT INTO "AspectMention" (id,"analysisId",category,name,sentiment) SELECT 'aspect'||n,'a'||n,'functionality','шум','negative' FROM generate_series(1,4) n;
    INSERT INTO "IssueMention" (id,"runId","analysisId","aspectId",scope,defect,quote,"quoteStart","quoteEnd")
      SELECT 'm'||n,'run','a'||n,'aspect'||n,'product','шумит','шумит',0,5 FROM generate_series(1,4) n;
    INSERT INTO "Problem" (id,"productId",title,"updatedAt") VALUES ('stable','p','Шум',now());
    BEGIN;
    INSERT INTO "GroupingPublication" (id,"runId","productId",action) VALUES ('g1','run','p','{"kind":"automatic"}');
    INSERT INTO "IssueClusterSnapshot" (id,"runId","publicationId","productId","problemId",title,defect,scope,category,"reviewCount","positiveContextCount","analyzedCount")
      VALUES ('c1','run','g1','p','stable','Шум','шумит','product','functionality',2,2,4),('c2','run','g1','p',NULL,'Другой шум','другое','product','functionality',2,2,4);
    INSERT INTO "IssueClusterMember" ("runId","clusterId","issueMentionId") VALUES ('run','c1','m1'),('run','c1','m2'),('run','c2','m3'),('run','c2','m4');
    UPDATE "GroupingPublication" SET "sealedAt"=now() WHERE id='g1';
    UPDATE "Product" SET "publishedGroupingId"='g1' WHERE id='p';
    UPDATE "AnalysisRun" SET status='completed',"finishedAt"=now() WHERE id='run';
    COMMIT;
  `);
  for (const sql of [
    `UPDATE "GroupingPublication" SET action='{}' WHERE id='g1'`,
    `DELETE FROM "GroupingPublication" WHERE id='g1'`,
    `UPDATE "IssueClusterSnapshot" SET title='Подмена' WHERE id='c1'`,
    `DELETE FROM "IssueClusterSnapshot" WHERE id='c1'`,
    `DELETE FROM "IssueClusterMember" WHERE "clusterId"='c1'`,
    `INSERT INTO "IssueClusterMember" ("runId","clusterId","issueMentionId") VALUES ('run','c1','m3')`,
  ]) await assert.rejects(db.exec(sql), error => error.code === '23514');
  await db.exec(`INSERT INTO "GroupingPublication" (id,"runId","productId","sourceId","actorUserId",action) VALUES ('g2','run','p','g1','owner','{"kind":"split"}')`);
  await assert.rejects(db.exec(`UPDATE "Product" SET "publishedGroupingId"='g2' WHERE id='p'`), error => error.code === '23514');
  await db.exec(`INSERT INTO "IssueClusterSnapshot" (id,"runId","publicationId","productId",title,defect,scope,category,"reviewCount","positiveContextCount","analyzedCount")
    VALUES ('c3','run','g2','p','Шум','шумит','product','functionality',1,1,4),('c4','run','g2','p','Шум','шумит','product','functionality',1,1,4)`);
  await db.exec(`INSERT INTO "IssueClusterMember" ("runId","clusterId","issueMentionId") VALUES ('run','c3','m1')`);
  await assert.rejects(db.exec(`INSERT INTO "IssueClusterMember" ("runId","clusterId","issueMentionId") VALUES ('run','c4','m1')`), error => error.code === '23514');
  await assert.rejects(db.exec(`UPDATE "IssueClusterSnapshot" SET "publicationId"='g1' WHERE id='c3'`), error => error.code === '23514');
  await assert.rejects(db.exec(`UPDATE "IssueClusterSnapshot" SET severity=0.9 WHERE id='c3'`), error => error.code === '23514');
  await assert.rejects(db.exec(`INSERT INTO "GroupingPublication" (id,"runId","productId") VALUES ('cross','foreign-run','p')`), error => error.code === '23503');
  try {
    await db.exec(`BEGIN; INSERT INTO "GroupingPublication" (id,"runId","productId") VALUES ('rollback','run','p');
      UPDATE "GroupingPublication" SET "sealedAt"=now() WHERE id='rollback';
      UPDATE "Product" SET "publishedGroupingId"='rollback' WHERE id='p'; SELECT 1/0; COMMIT;`);
    assert.fail('Expected transactional failure');
  } catch (error) { assert.equal(error.code, '22012'); await db.exec('ROLLBACK'); }
  assert.equal((await db.query(`SELECT "publishedGroupingId" FROM "Product" WHERE id='p'`)).rows[0].publishedGroupingId, 'g1');
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM "GroupingPublication" WHERE id='rollback'`)).rows[0].n, 0);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM "IssueClusterMember" WHERE "clusterId" IN ('c1','c2')`)).rows[0].n, 4);
  await db.exec(`INSERT INTO "GroupingPublication" (id,"runId","productId","sealedAt") VALUES ('unusable','foreign-run','foreign',now())`);
  await assert.rejects(db.exec(`UPDATE "Product" SET "publishedGroupingId"='unusable' WHERE id='foreign'`), error => error.code === '23514');
  console.log('Grouping SQL: all migrations, atomic terminal publication, rollback retention, sealed snapshot/membership immutability, unique membership per publication, same-product scope and independent indicators passed.');
} finally { await db.close(); }
