import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  compareModelEvaluations,
  summarizeModelEvaluation,
} from './summarize-model-evaluation.mjs';

const report = JSON.parse(
  await readFile(
    new URL('../docs/evaluations/qwen3-v9-transfer-2026-11-15.json', import.meta.url),
    'utf8',
  ),
);

function reviewedReport(source = report, scopeMismatchIds = ['h12']) {
  const reviewed = structuredClone(source);
  reviewed.reviewedBy = '  Test reviewer  ';
  for (const row of reviewed.cases) {
    const expected = row.expected.issues.length;
    const predicted = row.extracted?.complaints.length ?? 0;
    const matches = scopeMismatchIds.includes(row.id) ? 0 : Math.min(expected, predicted);
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

test('compares the archived runs and identifies the reviews that changed', async () => {
  const source = JSON.parse(
    await readFile(
      new URL('../docs/evaluations/qwen3-baseline-transfer-2026-11-15.json', import.meta.url),
      'utf8',
    ),
  );
  const result = compareModelEvaluations(reviewedReport(source, []), reviewedReport());
  assert.equal(result.baseline.configuration.methodVersion, 'extraction-v4');
  assert.equal(result.candidate.configuration.methodVersion, 'extraction-v9');
  assert.equal(result.delta.truePositives, 1);
  assert.equal(result.delta.falsePositives, -1);
  assert.equal(result.delta.falseNegatives, -1);
  assert.equal(result.delta.succeeded, 1);
  assert.equal(result.delta.precision, 7 / 9 - 6 / 9);
  assert.equal(result.delta.recall, 7 / 8 - 6 / 8);
  assert.deepEqual(
    result.changedCases.map(({ id }) => id),
    ['h02', 'h04', 'h05', 'h08', 'h10', 'h12'],
  );
  assert.equal(result.changedCases[0].candidate.status, 'failed');
});

test('rejects mismatching datasets, even with an unchanged checksum in an edited report', () => {
  const baseline = reviewedReport();
  const candidate = reviewedReport();
  candidate.dataset.sha256 = 'c'.repeat(64);
  assert.throws(() => compareModelEvaluations(baseline, candidate), /identical dataset SHA-256/);
  candidate.dataset.sha256 = baseline.dataset.sha256;
  candidate.cases[0].expected.issues[0].scope = 'seller';
  assert.throws(
    () => compareModelEvaluations(baseline, candidate),
    /ground truth differs at row 1/,
  );
});
