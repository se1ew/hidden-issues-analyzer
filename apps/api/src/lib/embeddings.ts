import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';
import { EmbeddingConfigurationSchema, embeddingVersion, type EmbeddingConfiguration } from '../schemas/embedding.schema.js';
import { normalizedVector } from '../services/grouping-engine.js';

interface Extractor {
  (input: string[], options: { pooling: 'mean'; normalize: boolean }): Promise<{ data: Float32Array; dims: number[] }>;
}
const extractors = new Map<string, Promise<Extractor>>();
const memory = new Map<string, number[]>();
export function defaultEmbeddingConfiguration(): EmbeddingConfiguration {
  return EmbeddingConfigurationSchema.parse({ model: env.EMBEDDING_MODEL, revision: env.EMBEDDING_REVISION ?? 'main', batchSize: env.EMBEDDING_BATCH_SIZE ?? 16 });
}
async function extractor(config: EmbeddingConfiguration) {
  const version = embeddingVersion(config);
  if (!extractors.has(version)) {
    if (extractors.size >= 2) throw new Error('В worker уже загружены две версии эмбеддингов; перезапустите worker для смены модели');
    const loading = (async () => {
      const { pipeline } = await import('@xenova/transformers');
      return await pipeline('feature-extraction', config.model, { quantized: true, revision: config.revision }) as unknown as Extractor;
    })().catch(error => { extractors.delete(version); throw error; });
    extractors.set(version, loading);
  }
  return extractors.get(version)!;
}

/** Mutable branches use process-local cache; pinned commits also use the database. */
export async function embed(texts: string[], input = defaultEmbeddingConfiguration(), signal?: AbortSignal): Promise<number[][]> {
  const config = EmbeddingConfigurationSchema.parse(input);
  const version = embeddingVersion(config);
  const persistent = /^[a-f0-9]{40}$/i.test(config.revision);
  const result: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += config.batchSize) {
    signal?.throwIfAborted();
    const batch = texts.slice(offset, offset + config.batchSize);
    const hashes = batch.map(text => createHash('sha256').update(text).digest('hex'));
    const keys = hashes.map(hash => createHash('sha256').update(`${version}:${hash}`).digest('hex'));
    const cached = persistent ? await prisma.embeddingCache.findMany({ where: { id: { in: keys }, version } }) : [];
    const found = new Map(cached.map(item => [item.id, normalizedVector(item.vector, item.dimension)]));
    const missing = batch.map((_, index) => index).filter(index => !memory.has(keys[index]) && !found.has(keys[index]));
    if (missing.length) {
      const model = await extractor(config);
      signal?.throwIfAborted();
      const output = await model(missing.map(index => batch[index]), { pooling: 'mean', normalize: true });
      signal?.throwIfAborted();
      const [count, dimension] = output.dims;
      if (output.dims.length !== 2 || count !== missing.length || !Number.isInteger(dimension) || dimension < 1
        || dimension > 8192 || output.data.length !== count * dimension) throw new Error('Некорректный ответ модели эмбеддингов');
      for (const [position, index] of missing.entries()) {
        const vector = normalizedVector(Array.from(output.data.slice(position * dimension, (position + 1) * dimension)));
        found.set(keys[index], vector);
        if (persistent) await prisma.embeddingCache.upsert({ where: { id: keys[index] },
          create: { id: keys[index], version, textHash: hashes[index], vector, dimension }, update: {} });
      }
    }
    keys.forEach(key => {
      const vector = memory.get(key) ?? found.get(key)!;
      memory.set(key, vector); result.push([...vector]);
    });
    while (memory.size > 5000) memory.delete(memory.keys().next().value!);
  }
  return result;
}
