export function problemLink(group: { id: string; productId: string; runId: string; publicationId?: string | null }) {
  const query = new URLSearchParams({ productId: group.productId, runId: group.runId, snapshotId: group.id });
  if (group.publicationId) query.set('publicationId', group.publicationId);
  return `/issues?${query}`;
}
