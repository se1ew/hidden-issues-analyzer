import assert from 'node:assert/strict';

const categories = new Set([
  'quality',
  'functionality',
  'material',
  'size_fit',
  'appearance',
  'usability',
  'price',
  'delivery',
  'seller',
  'packaging',
  'other',
]);
const scopes = new Set(['product', 'delivery', 'seller', 'packaging']);
const sentiments = new Set(['positive', 'negative', 'neutral']);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;

export function validateReviewCases(dataset) {
  assert(
    Array.isArray(dataset?.cases) && dataset.cases.length > 0,
    'Expected a nonempty cases array',
  );
  const ids = new Set();
  for (const [index, item] of dataset.cases.entries()) {
    assert(nonempty(item?.id), `Case ${index + 1}: expected a nonempty ID`);
    const { id, productId, text, rating, expected } = item;
    assert(!ids.has(id), `${id}: duplicate review ID`);
    ids.add(id);
    assert(nonempty(productId), `${id}: expected a nonempty productId`);
    assert(nonempty(text), `${id}: expected nonempty review text`);
    assert(
      rating == null || (Number.isInteger(rating) && rating >= 1 && rating <= 5),
      `${id}: rating must be null or an integer from 1 to 5`,
    );
    assert(
      Array.isArray(expected?.sentiments) &&
        expected.sentiments.length > 0 &&
        expected.sentiments.every((tone) => sentiments.has(tone)),
      `${id}: expected valid sentiments`,
    );
    assert(Array.isArray(expected.issues), `${id}: expected.issues must be an array`);

    const defects = new Set();
    for (const [issueIndex, issue] of expected.issues.entries()) {
      const label = `${id}, issue ${issueIndex + 1}`;
      assert(nonempty(issue?.defect), `${label}: expected a nonempty defect ID`);
      assert(categories.has(issue.aspect), `${label}: invalid aspect`);
      assert(scopes.has(issue.scope), `${label}: invalid scope`);
      assert(
        nonempty(issue.quote) && text.includes(issue.quote),
        `${label}: quote must appear verbatim in the review`,
      );
      assert(
        issue.consequences == null ||
          (nonempty(issue.consequences) && issue.quote.includes(issue.consequences)),
        `${label}: consequences must appear verbatim inside the quote`,
      );
      const key = `${issue.scope}:${issue.defect}`;
      assert(!defects.has(key), `${label}: duplicate expected defect in this scope`);
      defects.add(key);
    }
  }
}
