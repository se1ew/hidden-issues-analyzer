// Conservative local software limits. GPU/model capacity is measured separately on the target PC.
export const LIMITS = {
  jsonBytes: '1mb', exportRows: 2000, exportBytes: 20 * 1024 * 1024,
  sourceBytes: 4 * 1024 * 1024, sourceRows: 2000, reportHeapMb: 384,
  reportTimeoutMs: 120000, reportLeaseMs: 150000, shutdownMs: 15000,
} as const;
