import { z } from 'zod';
export const EmbeddingConfigurationSchema = z.object({
  model: z.string().trim().min(1).max(200), revision: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
  batchSize: z.number().int().min(1).max(64).default(16),
  method: z.literal('quantized-mean-l2-v1').default('quantized-mean-l2-v1'),
}).strict();
export type EmbeddingConfiguration = z.infer<typeof EmbeddingConfigurationSchema>;
export function embeddingVersion(config: EmbeddingConfiguration) {
  return `${config.model}@${config.revision}:${config.method}:transformers-2.17.2`;
}
