import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateReviewCases } from './review-case-validation.mjs';

const transfer = new URL('../docs/fixtures/accuracy-transfer-cases.json', import.meta.url);
const dataset = JSON.parse(await readFile(transfer, 'utf8'));
const script = fileURLToPath(new URL('./evaluate-model.mjs', import.meta.url));

test('validates both repository datasets', async () => {
  const original = JSON.parse(
    await readFile(new URL('../docs/fixtures/review-cases.json', import.meta.url), 'utf8'),
  );
  validateReviewCases(original);
  validateReviewCases(dataset);
});

test('rejects duplicate review IDs, malformed labels and unsupported evidence', () => {
  const [row] = dataset.cases;
  assert.throws(() => validateReviewCases({ cases: [row, row] }), /duplicate review ID/);
  assert.throws(() => validateReviewCases({ cases: [{ ...row, rating: '5' }] }), /rating/);
  const withIssue = (change) => ({
    cases: [
      { ...row, expected: { ...row.expected, issues: [{ ...row.expected.issues[0], ...change }] } },
    ],
  });
  assert.throws(() => validateReviewCases(withIssue({ scope: 'unknown' })), /invalid scope/);
  assert.throws(
    () => validateReviewCases(withIssue({ quote: 'invented' })),
    /verbatim in the review/,
  );
  assert.throws(
    () => validateReviewCases(withIssue({ consequences: 'Пылесос тянет уверенно' })),
    /inside the quote/,
  );
});

test('validates locally and rejects bad input or existing output before provider setup', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hia-review-cases-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'output.json');
  const invalid = path.join(dir, 'invalid.json');
  await writeFile(output, 'unchanged');
  await writeFile(invalid, '{"cases":[]}');
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, LLM_PROVIDER: 'unavailable-for-test' },
    });
  const valid = run('--validate-only', '--dataset', fileURLToPath(transfer));
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).cases, 12);
  const bad = run('--dataset', invalid);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /nonempty cases array/);
  const existing = run('--output', output);
  assert.equal(existing.status, 1);
  assert.match(existing.stderr, /Output already exists/);
  assert.equal(await readFile(output, 'utf8'), 'unchanged');
});
