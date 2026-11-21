import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { summarizeModelEvaluation } from './summarize-model-evaluation.mjs';

const report = JSON.parse(
  await readFile(
    new URL('../docs/evaluations/qwen3-v9-transfer-2026-11-15.json', import.meta.url),
    'utf8',
  ),
);

function reviewedReport() {
  const reviewed = structuredClone(report);
  reviewed.reviewedBy = '  Test reviewer  ';
  for (const row of reviewed.cases) {
    const expected = row.expected.issues.length;
    const predicted = row.extracted?.complaints.length ?? 0;
    const matches = row.id === 'h12' ? 0 : Math.min(expected, predicted);
    row.adjudication = {
      truePositives: matches,
      falsePositives: predicted - matches,
      falseNegatives: expected - matches,
      notes: '',
    };
  }
  return reviewed;
}

test('reproduces the archived transfer totals from the supplied adjudication', () => {
  const input = reviewedReport();
  const original = structuredClone(input);
  const { dataset, configuration, ...result } = summarizeModelEvaluation(input);
  assert.deepEqual(result, {
    reviewedBy: 'Test reviewer',
    total: 12,
    succeeded: 11,
    failed: 1,
    successRate: 11 / 12,
    truePositives: 7,
    falsePositives: 2,
    falseNegatives: 1,
    duplicatePredictions: 0,
    precision: 7 / 9,
    recall: 7 / 8,
  });
  assert.deepEqual(dataset, report.dataset);
  assert.deepEqual(configuration, report.configuration);
  assert.deepEqual(input, original);
});

test('rejects unreviewed reports and partially filled rows', () => {
  assert.throws(() => summarizeModelEvaluation(report), /reviewedBy/);
  assert.throws(
    () => summarizeModelEvaluation({ ...report, reviewedBy: 'Test reviewer' }),
    /h01: fill in adjudication.truePositives/,
  );
});

test('counts a failed response with expected defects as missed and leaves precision undefined', () => {
  const input = reviewedReport();
  const [row] = input.cases;
  delete row.extracted;
  row.status = 'failed';
  assert.throws(
    () => summarizeModelEvaluation({ ...input, cases: [row] }),
    /account for every published complaint/,
  );
  Object.assign(row.adjudication, { truePositives: 0, falseNegatives: 1 });
  const result = summarizeModelEvaluation({ ...input, cases: [row] });
  assert.equal(result.failed, 1);
  assert.equal(result.falseNegatives, 1);
  assert.equal(result.precision, null);
  assert.equal(result.recall, 0);
});

test('leaves both semantic rates undefined for a reviewed empty result with no expected defects', () => {
  const input = reviewedReport();
  const result = summarizeModelEvaluation({
    ...input,
    cases: [input.cases.find((row) => row.id === 'h03')],
  });
  assert.equal(result.successRate, 1);
  assert.equal(result.precision, null);
  assert.equal(result.recall, null);
});

test('requires a note before excluding repeated predictions', () => {
  const input = reviewedReport();
  const [row] = input.cases;
  row.extracted.complaints.push(row.extracted.complaints[0]);
  assert.throws(() => summarizeModelEvaluation(input), /account for every published complaint/);
  row.adjudication.duplicatePredictions = 1;
  assert.throws(() => summarizeModelEvaluation(input), /explain duplicate predictions/);
  row.adjudication.notes = 'Both predictions describe the same detached wheel.';
  assert.equal(summarizeModelEvaluation(input).duplicatePredictions, 1);
});

test('rejects impossible counts and repeated review IDs', () => {
  const input = reviewedReport();
  const [row] = input.cases;
  assert.throws(
    () => summarizeModelEvaluation({ ...input, cases: [row, row] }),
    /duplicate review ID/,
  );
  row.adjudication.falseNegatives = 2;
  assert.throws(() => summarizeModelEvaluation(input), /account for every expected defect/);
  row.adjudication.falseNegatives = -1;
  assert.throws(() => summarizeModelEvaluation(input), /nonnegative integer/);
});
