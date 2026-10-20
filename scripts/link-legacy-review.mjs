import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const { values } = parseArgs({ options: {
  review: { type: 'string' }, product: { type: 'string' }, batch: { type: 'string' },
  reason: { type: 'string' }, apply: { type: 'boolean', default: false },
} });
assert(values.review && values.product && values.batch && values.reason?.trim(),
  'Use --review ID --product ID --batch ID --reason "verified origin" [--apply]');
dotenv.config({ path: fileURLToPath(new URL('../apps/api/.env', import.meta.url)), quiet: true });
const db = new PrismaClient();
try {
  await db.$transaction(async tx => {
    const rows = await tx.$queryRaw`SELECT id, "productId", "uploadBatchId" FROM "Review" WHERE id = ${values.review} FOR UPDATE`;
    const [product, batch] = await Promise.all([
      tx.product.findUnique({ where: { id: values.product }, select: { userId: true } }),
      tx.uploadBatch.findUnique({ where: { id: values.batch } }),
    ]);
    const review = rows[0];
    assert(review && product?.userId && batch, 'Review, owned product and verified import must exist');
    assert(review.productId === null || review.productId === values.product, 'Refusing to move an existing product link');
    assert(review.uploadBatchId === null || review.uploadBatchId === values.batch, 'Refusing to replace first import');
    assert(batch.userId === product.userId, 'Import must already belong to the product owner');
    assert(batch.productId === null || batch.productId === values.product, 'Import belongs to a different product');
    const conflicts = await tx.$queryRaw`SELECT id FROM "Review" WHERE "uploadBatchId" = ${values.batch} AND "productId" IS NOT NULL AND "productId" <> ${values.product} LIMIT 1`;
    assert.equal(conflicts.length, 0, 'Import already contains reviews of another product');
    console.log(JSON.stringify({ reviewId: values.review, productId: values.product, batchId: values.batch, apply: values.apply }));
    if (values.apply) {
      await tx.uploadBatch.update({ where: { id: values.batch }, data: { productId: values.product } });
      await tx.$executeRaw`UPDATE "Review" SET "productId" = ${values.product}, "uploadBatchId" = ${values.batch} WHERE id = ${values.review}`;
      await tx.reviewImportOccurrence.upsert({ where: { reviewId_uploadBatchId: { reviewId: values.review, uploadBatchId: values.batch } },
        create: { reviewId: values.review, uploadBatchId: values.batch }, update: {} });
      const diagnostics = batch.diagnostics && typeof batch.diagnostics === 'object' && !Array.isArray(batch.diagnostics) ? batch.diagnostics : {};
      const assignments = Array.isArray(diagnostics.explicitLegacyLinks) ? diagnostics.explicitLegacyLinks : [];
      if (!assignments.some(item => item.reviewId === values.review)) {
        await tx.uploadBatch.update({ where: { id: values.batch }, data: { diagnostics: { ...diagnostics,
          explicitLegacyLinks: [...assignments, { reviewId: values.review, reason: values.reason, assignedAt: new Date().toISOString() }] } } });
      }
    }
  }, { isolationLevel: 'Serializable' });
} finally { await db.$disconnect(); }
