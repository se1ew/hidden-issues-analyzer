import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';

export function summarizeModelEvaluation(report) {
  assert.equal(
    report?.kind,
    'model-evaluation-requires-human-adjudication',
    'Expected a model evaluation report',
  );
  assert(
    typeof report.reviewedBy === 'string' && report.reviewedBy.trim(),
    'Fill in reviewedBy before scoring',
  );
  assert(Array.isArray(report.cases) && report.cases.length > 0, 'Expected at least one review');

  const ids = new Set();
  let succeeded = 0;
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let duplicatePredictions = 0;

  for (const row of report.cases) {
    assert(typeof row?.id === 'string' && row.id.trim(), 'Expected a nonempty review ID');
    const { id, status, expected, extracted, adjudication } = row;
    assert(!ids.has(id), `${id}: duplicate review ID`);
    ids.add(id);
    assert(Array.isArray(expected?.issues), `${id}: expected.issues must be an array`);
    assert(status === 'succeeded' || status === 'failed', `${id}: invalid status`);
    if (status === 'succeeded') {
      assert(Array.isArray(extracted?.complaints), `${id}: extracted.complaints must be an array`);
      succeeded++;
    } else {
      assert(extracted == null, `${id}: failed response cannot contain extracted results`);
    }

    for (const field of ['truePositives', 'falsePositives', 'falseNegatives']) {
      const count = adjudication?.[field];
      assert(
        Number.isSafeInteger(count) && count >= 0,
        `${id}: fill in adjudication.${field} with a nonnegative integer`,
      );
    }
    const {
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      duplicatePredictions: duplicates = 0,
      notes,
    } = adjudication;
    const predicted = status === 'succeeded' ? extracted.complaints.length : 0;
    assert(
      Number.isSafeInteger(duplicates) && duplicates >= 0,
      `${id}: adjudication.duplicatePredictions must be a nonnegative integer`,
    );
    assert(
      tp + fn === expected.issues.length,
      `${id}: TP + FN must account for every expected defect`,
    );
    assert(
      tp + fp + duplicates === predicted,
      `${id}: TP + FP + duplicatePredictions must account for every published complaint`,
    );
    assert(
      duplicates === 0 || (typeof notes === 'string' && notes.trim()),
      `${id}: explain duplicate predictions in adjudication.notes`,
    );
    truePositives += tp;
    falsePositives += fp;
    falseNegatives += fn;
    duplicatePredictions += duplicates;
  }

  const total = report.cases.length;
  return {
    reviewedBy: report.reviewedBy.trim(),
    dataset: report.dataset ?? null,
    configuration: report.configuration ?? null,
    total,
    succeeded,
    failed: total - succeeded,
    successRate: succeeded / total,
    truePositives,
    falsePositives,
    falseNegatives,
    duplicatePredictions,
    precision:
      truePositives + falsePositives === 0
        ? null
        : truePositives / (truePositives + falsePositives),
    recall:
      truePositives + falseNegatives === 0
        ? null
        : truePositives / (truePositives + falseNegatives),
  };
}

export function compareModelEvaluations(baseline, candidate) {
  const before = summarizeModelEvaluation(baseline);
  const after = summarizeModelEvaluation(candidate);
  const checksum = before.dataset?.sha256;
  assert(
    typeof checksum === 'string' &&
      /^[a-f0-9]{64}$/u.test(checksum) &&
      checksum === after.dataset?.sha256,
    'Comparison requires identical dataset SHA-256 values',
  );
  assert(before.total === after.total, 'Comparison requires the same number of reviews');

  const caseInput = ({ id, productId, text, rating, expected }) => ({
    id,
    productId,
    text,
    rating,
    expected,
  });
  const caseScore = ({ status, adjudication }) => ({
    status,
    truePositives: adjudication.truePositives,
    falsePositives: adjudication.falsePositives,
    falseNegatives: adjudication.falseNegatives,
    duplicatePredictions: adjudication.duplicatePredictions ?? 0,
  });
  const changedCases = [];
  for (const [index, row] of baseline.cases.entries()) {
    const other = candidate.cases[index];
    assert(
      isDeepStrictEqual(caseInput(row), caseInput(other)),
      `Review input or ground truth differs at row ${index + 1}`,
    );
    const original = caseScore(row);
    const revised = caseScore(other);
    if (!isDeepStrictEqual(original, revised))
      changedCases.push({ id: row.id, baseline: original, candidate: revised });
  }

  const delta = {};
  for (const field of [
    'succeeded',
    'failed',
    'successRate',
    'truePositives',
    'falsePositives',
    'falseNegatives',
    'duplicatePredictions',
    'precision',
    'recall',
  ]) {
    delta[field] =
      before[field] === null || after[field] === null ? null : after[field] - before[field];
  }
  return { baseline: before, candidate: after, delta, changedCases };
}

async function readReport(filename) {
  const contents = await readFile(filename, 'utf8');
  return JSON.parse(contents.replace(/^\uFEFF/u, ''));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { positionals, values } = parseArgs({
      allowPositionals: true,
      options: { compare: { type: 'boolean' } },
    });
    assert.equal(
      positionals.length,
      values.compare ? 2 : 1,
      'Usage: node scripts/summarize-model-evaluation.mjs REVIEWED.json or --compare BASELINE.json CANDIDATE.json',
    );
    const first = await readReport(positionals[0]);
    const result = values.compare
      ? compareModelEvaluations(first, await readReport(positionals[1]))
      : summarizeModelEvaluation(first);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(
      error instanceof SyntaxError ? 'Invalid JSON in evaluation report' : error.message,
    );
    process.exitCode = 1;
  }
}
