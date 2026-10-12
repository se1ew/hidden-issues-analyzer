import { ownedProductScope } from './ownership.service.js';
import { z } from 'zod';

import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { llm, waitForLlm, LlmError } from '../lib/llm.js';

export const AnalysisResultSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  sentiment_score: z.number().finite().min(-1).max(1),
  aspects: z.array(z.object({ name: z.string().trim().min(1).max(40),
    sentiment: z.enum(['positive', 'negative', 'neutral']) }).strict()).max(20),
  issues: z.array(z.string().trim().min(1).max(80)).max(20),
}).strict();
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export const ANALYSIS_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['sentiment', 'sentiment_score', 'aspects', 'issues'],
  properties: {
    sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
    sentiment_score: { type: 'number', minimum: -1, maximum: 1 },
    aspects: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false,
      required: ['name', 'sentiment'], properties: { name: { type: 'string', minLength: 1, maxLength: 40 },
        sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] } } } },
    issues: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 80 } },
  },
};

export const ANALYSIS_PROMPT_VERSION = 'legacy-review-v1';
export const ANALYSIS_PROMPT = `Ты — опытный аналитик потребительских отзывов. Получив отзыв на товар, ты определяешь:
1. Общую тональность (positive / negative / neutral)
2. Численную оценку тональности от -1.0 (крайне негативно) до 1.0 (крайне позитивно)
3. Упоминаемые аспекты товара (качество, цена, доставка, упаковка, размер, материал и т.п.) с их тональностью
4. Конкретные проблемы или жалобы, упомянутые в отзыве (короткие фразы 2-5 слов на русском, в нижнем регистре, без пунктуации)

ВАЖНО: отвечай ТОЛЬКО валидным JSON-объектом без какого-либо текста до или после. Никаких пояснений, никакого markdown-форматирования.

Пример ответа:
{"sentiment":"negative","sentiment_score":-0.7,"aspects":[{"name":"качество","sentiment":"negative"},{"name":"доставка","sentiment":"positive"}],"issues":["сломалась через месяц","некачественный пластик"]}`;

function buildUserPrompt(reviewText: string): string {
  return `Проанализируй следующий отзыв и верни JSON-объект:\n\n"""\n${reviewText}\n"""`;
}

/**
 * Анализирует один отзыв через LLM.
 */
export async function analyzeReviewText(text: string, signal?: AbortSignal): Promise<AnalysisResult> {
  return llm.completeJson({
    messages: [{ role: 'system', content: ANALYSIS_PROMPT }, { role: 'user', content: buildUserPrompt(text) }],
    temperature: 0.1, max_tokens: 600, jsonSchema: ANALYSIS_JSON_SCHEMA, schemaName: 'review_analysis',
  }, AnalysisResultSchema, signal);
}

export interface RunOptions {
  userId: string;
  productId?: string;
  limit?: number;
  concurrency?: number;
  delayMs?: number;
  signal?: AbortSignal;
  onProgress?: (processed: number, total: number) => void;
}

/**
 * Запускает анализ всех непроанализированных отзывов.
 */
export async function runPendingAnalysis(opts: RunOptions): Promise<{
  processed: number;
  failed: number;
  total: number;
}> {
  const limit = opts.limit ?? 200;
  const concurrency = Math.max(1, Math.min(llm.config.concurrency, opts.concurrency ?? llm.config.concurrency));
  const delayMs = llm.config.provider === 'local' ? 0 : opts.delayMs ?? llm.config.cloudDelayMs;

  const pending = await prisma.review.findMany({
    where: { ...ownedProductScope(opts.userId, opts.productId), analyzedAt: null },
    take: limit,
    select: { id: true, text: true },
    orderBy: { createdAt: 'asc' },
  });

  const total = pending.length;
  let processed = 0;
  let failed = 0;

  // Простой пул: запускаем concurrency воркеров поверх очереди
  const queue = [...pending];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      if (opts.signal?.aborted) break;
      const item = queue.shift();
      if (!item) break;
      try {
        const result = await analyzeReviewText(item.text, opts.signal);
        if (opts.signal?.aborted) break;
        await prisma.review.updateMany({
          where: { id: item.id, ...ownedProductScope(opts.userId, opts.productId) },
          data: {
            sentiment: result.sentiment,
            sentimentScore: result.sentiment_score,
            aspects: result.aspects,
            issues: result.issues,
            analyzedAt: new Date(),
            legacyAnalysis: true,
          },
        });
      } catch (err) {
        if (opts.signal?.aborted || (err instanceof LlmError && err.code === 'cancelled')) throw err;
        failed++;
        logger.error({ err, reviewId: item.id }, 'analyzeReview failed');
      } finally {
        processed++;
        opts.onProgress?.(processed, total);
      }
      if (queue.length > 0 && delayMs > 0) await waitForLlm(delayMs, opts.signal);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  logger.info({ processed, failed, total }, 'Analysis batch complete');
  return { processed, failed, total };
}
