import { env } from '../config/env.js';
import { logger } from './logger.js';

// @xenova/transformers — динамический импорт, т.к. ESM-only и тяжёлый.
let extractorPromise: Promise<unknown> | null = null;

async function getExtractor() {
  if (!extractorPromise) {
    logger.info({ model: env.EMBEDDING_MODEL }, 'Loading embedding model (one-time)');
    extractorPromise = (async () => {
      const { pipeline } = await import('@xenova/transformers');
      return pipeline('feature-extraction', env.EMBEDDING_MODEL, {
        quantized: true,
      });
    })();
  }
  return extractorPromise;
}

/**
 * Возвращает 384-мерные эмбеддинги для массива текстов (mean pooling + L2-norm).
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = (await getExtractor()) as (
    input: string[],
    options: { pooling: 'mean'; normalize: boolean },
  ) => Promise<{ data: Float32Array; dims: number[] }>;

  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  const [n, dim] = output.dims;
  const flat = output.data;
  const result: number[][] = [];
  for (let i = 0; i < n; i++) {
    result.push(Array.from(flat.slice(i * dim, (i + 1) * dim)));
  }
  return result;
}
