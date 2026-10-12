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
    const [product, user] = await Promise.all([
      tx.product.findUnique({ where: { id: values.product }, include: { _count: { select: { reviews: true } } } }),
      tx.user.findUnique({ where: { id: values.user }, select: { id: true } }),
    ]);
    assert(product && user, 'Product and user must exist');
    assert(product.userId === null || product.userId === user.id, 'Refusing to change an existing owner');
    console.log(JSON.stringify({ productId: product.id, userId: user.id, reviews: product._count.reviews, apply: values.apply }));
    if (values.apply && product.userId === null) {
      const result = await tx.product.updateMany({ where: { id: product.id, userId: null }, data: { userId: user.id } });
      assert.equal(result.count, 1, 'Ownership changed concurrently; assignment aborted');
    }
  }, { isolationLevel: 'Serializable' });
} finally {
  await prisma.$disconnect();
}
