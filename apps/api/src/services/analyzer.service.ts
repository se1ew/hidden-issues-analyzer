import type { Sentiment } from '@prisma/client';

import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { chatCompletion, extractJson } from '../lib/openrouter.js';

export interface AnalysisResult {
  sentiment: 'positive' | 'negative' | 'neutral';
  sentiment_score: number; // -1..1
  aspects: Array<{ name: string; sentiment: 'positive' | 'negative' | 'neutral' }>;
  issues: string[];
}

const SYSTEM_PROMPT = `Ты — опытный аналитик потребительских отзывов. Получив отзыв на товар, ты определяешь:
1. Общую тональность (positive / negative / neutral)
2. Численную оценку тональности от -1.0 (крайне негативно) до 1.0 (крайне позитивно)
3. Упоминаемые аспекты товара (качество, цена, доставка, упаковка, размер, материал и т.п.) с их тональностью
4. Конкретные проблемы или жалобы, упомянутые в отзыве (короткие фразы 2-5 слов на русском, в нижнем регистре, без пунктуации)

ВАЖНО: отвечай ТОЛЬКО валидным JSON-объектом без какого-либо текста до или после. Никаких пояснений, никакого markdown-форматирования.

Пример ответа:
{"sentiment":"negative","sentiment_score":-0.7,"aspects":[{"name":"качество","sentiment":"negative"},{"name":"доставка","sentiment":"positive"}],"issues":["сломалась через месяц","некачественный пластик"]}`;

function buildUserPrompt(reviewText: string): string {
  return `Проанализируй следующий отзыв и верни JSON-объект:\n\n"""\n${reviewText.slice(0, 3000)}\n"""`;
}

/**
 * Анализирует один отзыв через LLM.
 */
export async function analyzeReviewText(text: string): Promise<AnalysisResult> {
  const content = await chatCompletion({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(text) },
    ],
    temperature: 0.1,
    max_tokens: 600,
    response_format: { type: 'json_object' },
  });

  const parsed = extractJson<AnalysisResult>(content);

  // Валидация и нормализация
  const sentiment: Sentiment =
    parsed.sentiment === 'positive' || parsed.sentiment === 'negative' ? parsed.sentiment : 'neutral';
  const score = clamp(Number(parsed.sentiment_score) || 0, -1, 1);
  const aspects: AnalysisResult['aspects'] = Array.isArray(parsed.aspects)
    ? parsed.aspects
        .filter((a) => a && typeof a.name === 'string')
        .slice(0, 20)
        .map((a) => ({
          name: a.name.toString().toLowerCase().trim().slice(0, 40),
          sentiment: (a.sentiment === 'positive' || a.sentiment === 'negative'
            ? a.sentiment
            : 'neutral') as 'positive' | 'negative' | 'neutral',
        }))
    : [];
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues
        .filter((s) => typeof s === 'string' && s.trim().length > 0)
        .slice(0, 20)
        .map((s) => s.toString().toLowerCase().trim().slice(0, 80))
    : [];

  return { sentiment, sentiment_score: score, aspects, issues };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export interface RunOptions {
  limit?: number;
  concurrency?: number;
  delayMs?: number;
  onProgress?: (processed: number, total: number) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Запускает анализ всех непроанализированных отзывов.
 */
export async function runPendingAnalysis(opts: RunOptions = {}): Promise<{
  processed: number;
  failed: number;
  total: number;
}> {
  const limit = opts.limit ?? 200;
  const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? 1));
  const delayMs = opts.delayMs ?? 4_000;

  const pending = await prisma.review.findMany({
    where: { analyzedAt: null },
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
      const item = queue.shift();
      if (!item) break;
      try {
        const result = await analyzeReviewText(item.text);
        await prisma.review.update({
          where: { id: item.id },
          data: {
            sentiment: result.sentiment,
            sentimentScore: result.sentiment_score,
            aspects: result.aspects,
            issues: result.issues,
            analyzedAt: new Date(),
          },
        });
      } catch (err) {
        failed++;
        logger.error({ err, reviewId: item.id }, 'analyzeReview failed');
      } finally {
        processed++;
        opts.onProgress?.(processed, total);
      }
      if (queue.length > 0 && delayMs > 0) await sleep(delayMs);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  logger.info({ processed, failed, total }, 'Analysis batch complete');
  return { processed, failed, total };
}
