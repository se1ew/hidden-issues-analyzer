import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ pipeline: vi.fn(), extract: vi.fn(), findMany: vi.fn(), upsert: vi.fn() }));
vi.mock('@xenova/transformers', () => ({ pipeline: mocks.pipeline }));
vi.mock('./prisma.js', () => ({ prisma: { embeddingCache: { findMany: mocks.findMany, upsert: mocks.upsert } } }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.pipeline.mockResolvedValue(mocks.extract); mocks.findMany.mockResolvedValue([]);
  mocks.extract.mockImplementation(async (texts: string[]) => ({ dims: [texts.length, 2], data: new Float32Array(texts.flatMap(() => [3, 4])) }));
});
const config = { model: 'fixture', revision: 'main', batchSize: 2, method: 'quantized-mean-l2-v1' as const };
describe('bounded and versioned production embeddings', () => {
  it('uses the configured persistent model cache', async () => {
    const { env } = await import('../config/env.js');
    env.EMBEDDING_CACHE_DIR = 'fixture-cache';
    try {
      const { embed } = await import('./embeddings.js');
      await embed(['cache-path-check'], config);
      expect(mocks.pipeline).toHaveBeenCalledWith('feature-extraction', 'fixture', expect.objectContaining({ cache_dir: 'fixture-cache' }));
    } finally { delete env.EMBEDDING_CACHE_DIR; }
  });
  it('batches inference and reuses only the matching model version', async () => {
    const { embed } = await import('./embeddings.js');
    expect(await embed(['a', 'b', 'c', 'd', 'e'], config)).toEqual(Array.from({ length: 5 }, () => [0.6, 0.8]));
    expect(mocks.extract).toHaveBeenCalledTimes(3);
    await embed(['a'], config); expect(mocks.extract).toHaveBeenCalledTimes(3);
    await embed(['a'], { ...config, revision: 'different' }); expect(mocks.extract).toHaveBeenCalledTimes(4);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('persists only embeddings with a pinned commit revision', async () => {
    const { embed } = await import('./embeddings.js');
    await embed(['a'], { ...config, revision: 'a'.repeat(40) });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ dimension: 2, vector: [0.6, 0.8], version: expect.stringContaining('@' + 'a'.repeat(40)) }) }));
  });
  it('rejects malformed tensor output and cancellation before inference', async () => {
    const { embed } = await import('./embeddings.js');
    mocks.extract.mockResolvedValueOnce({ dims: [2, 2], data: new Float32Array([1, 0]) });
    await expect(embed(['a'], config)).rejects.toThrow(/Некорректный ответ/);
    const controller = new AbortController(); controller.abort();
    await expect(embed(['b'], config, controller.signal)).rejects.toThrow();
    expect(mocks.extract).toHaveBeenCalledTimes(1);
  });
});
