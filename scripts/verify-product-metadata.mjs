import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const container = `hia-product-metadata-${randomUUID().slice(0, 8)}`;
let db;
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}
try {
  run('docker', ['run', '-d', '--name', container, '-e', 'POSTGRES_USER=check', '-e', 'POSTGRES_PASSWORD=check',
    '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'check']).status === 0) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const port = run('docker', ['port', container, '5432']).split(':').at(-1);
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: `postgresql://check:check@127.0.0.1:${port}/check`,
    REDIS_URL: 'redis://127.0.0.1:1', JWT_ACCESS_SECRET: 'product-access-secret-xxxxxxxxxxxx',
    JWT_REFRESH_SECRET: 'product-refresh-secret-xxxxxxxxxxx', LLM_PROVIDER: 'local' });
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma']);
  const { prisma } = await import('../apps/api/dist/lib/prisma.js'); db = prisma;
  const { persistImport } = await import('../apps/api/dist/services/imports.service.js');
  const { listProducts } = await import('../apps/api/dist/services/products.service.js');
  for (const id of ['a', 'b']) await db.user.create({ data: { id, email: `${id}@metadata.test`, passwordHash: 'unused' } });
  const original = await db.product.create({ data: { userId: 'a', source: 'wildberries', externalId: '123', name: 'WB 123' } });
  const foreign = await db.product.create({ data: { userId: 'b', source: 'wildberries', externalId: '123', name: 'WB 123' } });
  const input = { userId: 'a', productName: 'Наушники', externalSource: 'wildberries', productExternalId: '123',
    source: 'parsing', sourceUrl: 'https://www.wildberries.ru/catalog/123/detail.aspx',
    imageUrl: 'https://basket-01.wbbasket.ru/vol0/part0/123/images/c246x328/1.webp',
    rows: [{ text: 'Хорошо', externalId: 'r1' }] };
  await persistImport(input);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: original.id } })).name, 'Наушники');
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: foreign.id } })).name, 'WB 123');
  await db.product.update({ where: { id: original.id }, data: { name: 'Мои наушники' } });
  const repeated = await persistImport({ ...input, productName: 'Другое название', imageUrl: undefined });
  assert.equal(repeated.count, 0, 'Metadata must refresh even when all reviews are duplicates');
  const [listed] = await listProducts('a');
  assert.equal(listed.name, 'Мои наушники', 'A manual rename must survive reimport');
  assert.equal(listed.imageUrl, input.imageUrl, 'Missing metadata must preserve the existing image');
  assert.equal(listed.reviewsCount, 1);
  await assert.rejects(persistImport({ ...input, productId: foreign.id }), error => error.status === 404);
  const fresh = await persistImport({ ...input, productExternalId: '456', productName: 'Новый товар' });
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: fresh.productId } })).imageUrl, input.imageUrl);
  console.log('Product metadata: additive migration, names/photos, deduplication, manual rename and account isolation passed.');
} finally {
  await db?.$disconnect();
  spawnSync('docker', ['rm', '-f', container], { encoding: 'utf8', windowsHide: true });
}
