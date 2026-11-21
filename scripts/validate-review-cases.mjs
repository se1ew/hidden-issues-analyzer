import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateReviewCases } from './review-case-validation.mjs';

const data = JSON.parse(await readFile(new URL('../docs/fixtures/review-cases.json', import.meta.url), 'utf8'));
validateReviewCases(data);
const actualGroups = new Map();

for (const item of data.cases) {
  const rating = item.rating ?? null;
  for (const sentiment of item.expected.sentiments) {
    assert.equal(item.expected.positiveContext, (rating !== null && rating >= 4) || sentiment === 'positive', `${item.id}: ambiguous positive context`);
  }
  if (item.expected.ratingSentimentConflict) {
    assert(item.rating >= 4 && item.expected.sentiments.every(s => s === 'negative'), `${item.id}: conflict`);
  }
  for (const issue of item.expected.issues) {
    if (issue.scope !== 'product') continue;
    const key = `${item.productId}:${issue.defect}`;
    const group = actualGroups.get(key) ?? { productId: item.productId, defect: issue.defect, reviewIds: [], positiveReviewIds: [], unratedPositiveReviewIds: [] };
    group.reviewIds.push(item.id);
    if (item.expected.positiveContext) {
      group.positiveReviewIds.push(item.id);
      if (rating === null) group.unratedPositiveReviewIds.push(item.id);
    }
    actualGroups.set(key, group);
  }
}

const groupKeys = new Set();
for (const expected of data.expectedProductGroups) {
  const key = `${expected.productId}:${expected.defect}`;
  assert(!groupKeys.has(key), `Duplicate group: ${key}`);
  groupKeys.add(key);
  const actual = actualGroups.get(key);
  assert(actual, `Unknown group: ${key}`);
  for (const field of ['reviewIds', 'positiveReviewIds', 'unratedPositiveReviewIds']) {
    assert.deepEqual([...expected[field]].sort(), [...actual[field]].sort(), `${key}: ${field}`);
  }
  assert.equal(expected.hidden, actual.positiveReviewIds.length >= 2, `${key}: hidden`);
}
assert.equal(groupKeys.size, actualGroups.size, 'Missing expected groups');
console.log(`Validated ${data.cases.length} reviews, ${groupKeys.size} product groups, ${data.expectedProductGroups.filter(g => g.hidden).length} hidden groups. Dataset validation only; model not evaluated.`);
