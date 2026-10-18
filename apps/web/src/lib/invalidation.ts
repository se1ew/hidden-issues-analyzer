import type { QueryClient, QueryKey } from '@tanstack/react-query';

export function queryScope(key: QueryKey) {
  const root = String(key[0]);
  if (['groupings', 'grouping-history', 'analysis-runs'].includes(root)) return { productId: key[2] as string | null, runId: root === 'groupings' ? key[3] : undefined };
  return (key[2] && typeof key[2] === 'object' ? key[2] : {}) as { productId?: string | null; runId?: string };
}
export function invalidateProductData(client: QueryClient, ownerId: string | null, productId: string | null | undefined,
  roots: string[], includeSnapshots = true) {
  return client.invalidateQueries({ predicate: query => {
    if (!roots.includes(String(query.queryKey[0])) || query.queryKey[1] !== ownerId) return false;
    const scope = queryScope(query.queryKey);
    return (!productId || !scope.productId || scope.productId === productId) && (includeSnapshots || !scope.runId);
  } });
}
