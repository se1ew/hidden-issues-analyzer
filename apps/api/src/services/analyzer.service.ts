import { z } from 'zod';

import { llm } from '../lib/llm.js';
import { EXTRACTION_PROMPT, EXTRACTION_JSON_SCHEMA, ExtractionResultSchema, validateExtractionEvidence, type ExtractionResult } from './extraction.service.js';

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
export async function analyzeReviewText(text: string, signal?: AbortSignal): Promise<ExtractionResult> {
  const result = await llm.completeJson({
    messages: [{ role: 'system', content: EXTRACTION_PROMPT }, { role: 'user', content: buildUserPrompt(text) }],
    temperature: 0.1, jsonSchema: EXTRACTION_JSON_SCHEMA, schemaName: 'review_analysis',
  }, ExtractionResultSchema, signal);
  return validateExtractionEvidence(text, result);
}

