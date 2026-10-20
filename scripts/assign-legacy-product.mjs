import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const { values } = parseArgs({ options: {
  product: { type: 'string' }, user: { type: 'string' }, apply: { type: 'boolean', default: false },
} });
assert(values.product && values.user, 'Usage: node scripts/assign-legacy-product.mjs --product ID --user ID [--apply]');
dotenv.config({ path: fileURLToPath(new URL('../apps/api/.env', import.meta.url)), quiet: true });
const prisma = new PrismaClient();
try {
  await prisma.$transaction(async (tx) => {
    const [products, user] = await Promise.all([
      tx.$queryRaw`SELECT p.id, p."userId", (SELECT count(*)::int FROM "Review" r WHERE r."productId" = p.id) AS reviews FROM "Product" p WHERE p.id = ${values.product} FOR UPDATE`,
      tx.user.findUnique({ where: { id: values.user }, select: { id: true } }),
    ]);
    const product = products[0];
    assert(product && user, 'Product and user must exist');
    assert(product.userId === null || product.userId === user.id, 'Refusing to change an existing owner');
    console.log(JSON.stringify({ productId: product.id, userId: user.id, reviews: product.reviews, apply: values.apply }));
    if (values.apply && product.userId === null) {
      // Raw SQL also supports the nullable transition schema with the final Prisma Client.
      const count = await tx.$executeRaw`UPDATE "Product" SET "userId" = ${user.id} WHERE id = ${product.id} AND "userId" IS NULL`;
      assert.equal(count, 1, 'Ownership changed concurrently; assignment aborted');
    }
  }, { isolationLevel: 'Serializable' });
} finally {
  await prisma.$disconnect();
}
