import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inspectReviewsCsv } from '../apps/api/dist/services/csv.service.js';

const fixtures = JSON.parse(await fs.readFile(new URL('../docs/fixtures/review-cases.json', import.meta.url), 'utf8'));
const directory = new URL('../docs/demo/', import.meta.url);
await fs.mkdir(directory, { recursive: true });
const products = { 'kettle-a': 'Демо: чайник A', 'kettle-b': 'Демо: чайник B', 'headphones-a': 'Демо: наушники', 'bottle-a': 'Демо: флакон' };
const csvField = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
let total = 0;
const manifest = [];
for (const [id, name] of Object.entries(products)) {
  const cases = fixtures.cases.filter(item => item.productId === id);
  const csv = '\uFEFFtext,rating,external_id,date\r\n' + cases.map(item => [item.text, item.rating, `demo-${item.id}`, item.reviewDate].map(csvField).join(',')).join('\r\n') + '\r\n';
  const parsed = inspectReviewsCsv(Buffer.from(csv));
  assert.equal(parsed.errorCount, 0); assert.equal(parsed.rows.length, cases.length);
  assert.deepEqual(parsed.rows.map(item => item.text), cases.map(item => item.text));
  assert.equal(new Set(parsed.rows.map(item => item.externalId)).size, cases.length);
  await fs.writeFile(new URL(`${id}.csv`, directory), csv);
  manifest.push({ productId: id, name, file: `${id}.csv`, rows: cases.length });
  total += cases.length;
}
assert.equal(total, 25);
await fs.writeFile(new URL('products.json', directory), JSON.stringify({ kind: 'synthetic-demo', products: manifest }, null, 2) + '\n');
console.log(`Prepared ${manifest.length} products and ${total} reviews in ${fileURLToPath(directory)}; CSV verified by the production importer.`);
