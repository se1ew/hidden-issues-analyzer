import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { LlmError, type LlmProvider, type TokenUsage } from '../lib/llm.js';
import { complaintRange, ExtractionResultSchema, EXTRACTION_JSON_SCHEMA, validateExtractionEvidence, type ExtractionResult } from './extraction.service.js';

export const CHUNKING_VERSION = 'utf16-overlap-v1';
const userPrompt = (text: string) => `Проанализируй следующий отзыв и верни JSON:\n\n"""\n${text}\n"""`;

/** UTF-8 budget, original UTF-16 offsets, no lost bytes or split surrogate pairs. */
export function splitReview(text: string, maxBytes: number) {
  if (maxBytes < 256) throw new LlmError('input_too_long', 'Контекст слишком мал для текста и инструкции. Увеличьте контекст модели.');
  const chunks: Array<{ text: string; start: number; weight: number }> = [];
  let start = 0;
  while (start < text.length || !chunks.length) {
    let end = start; let bytes = 0;
    for (const point of text.slice(start)) {
      const size = Buffer.byteLength(point);
      if (bytes + size > maxBytes) break;
      bytes += size; end += point.length;
    }
    const previousEnd = chunks.length ? chunks.at(-1)!.start + chunks.at(-1)!.text.length : 0;
    chunks.push({ text: text.slice(start, end), start, weight: end - previousEnd });
    if (end === text.length) break;
    if (chunks.length >= 16) throw new LlmError('input_too_long', 'Отзыв требует больше 16 фрагментов. Увеличьте контекст модели.');
    let overlap = 0; let next = end;
    while (next > start && overlap < Math.min(512, Math.floor(maxBytes / 6))) {
      const width = next >= 2 && /[\uDC00-\uDFFF]/.test(text[next - 1]) && /[\uD800-\uDBFF]/.test(text[next - 2]) ? 2 : 1;
      overlap += Buffer.byteLength(text.slice(next - width, next)); next -= width;
    }
    start = next;
  }
  return chunks;
}

export function extractionCacheKey(input: { userId: string; text: string; prompt: string; promptVersion: string; methodVersion: string; modelVersion: string }, provider: LlmProvider) {
  const { apiKey: _secret, ...config } = provider.config;
  return createHash('sha256').update(JSON.stringify({ ...input, config, schema: EXTRACTION_JSON_SCHEMA, chunking: CHUNKING_VERSION })).digest('hex');
}

export async function extractReview(input: { userId: string; text: string; prompt: string; promptVersion: string; methodVersion: string; modelVersion: string },
  provider: LlmProvider, signal?: AbortSignal, metrics: { chunks: number; cacheHit: boolean; usage: TokenUsage; responses: number } = { chunks: 0, cacheHit: false, usage: {}, responses: 0 }) {
  const assertActive = () => { if (signal?.aborted) throw new LlmError('cancelled', 'Анализ отменён'); };
  assertActive();
  // Mutable model aliases cannot identify a reproducible cache entry.
  const cacheEnabled = input.modelVersion !== 'unverified';
  const key = extractionCacheKey(input, provider);
  if (cacheEnabled) {
    try {
      const cached = await prisma.extractionCache.findUnique({ where: { id: key } });
      if (cached && cached.expiresAt > new Date()) {
        const result = validateExtractionEvidence(input.text, ExtractionResultSchema.parse(cached.result));
        assertActive(); metrics.cacheHit = true;
        return result;
      }
    } catch { logger.warn('Extraction cache unavailable; running analysis'); }
  }
  const fixedBytes = Buffer.byteLength(input.prompt) + Buffer.byteLength(userPrompt(''));
  const budget = (provider.config.contextTokens - provider.config.maxOutputTokens) * 4 - fixedBytes - 256;
  const chunks = splitReview(input.text, budget);
  const results: Array<{ result: ExtractionResult; weight: number }> = [];
  for (const chunk of chunks) {
    assertActive();
    const result = validateExtractionEvidence(chunk.text, await provider.completeJson({
      messages: [{ role: 'system', content: input.prompt }, { role: 'user', content: userPrompt(chunk.text) }],
      temperature: 0.1, max_tokens: provider.config.maxOutputTokens, jsonSchema: EXTRACTION_JSON_SCHEMA, schemaName: 'review_analysis',
      onUsage: usage => {
        metrics.responses++;
        for (const field of ['promptTokens', 'completionTokens', 'totalTokens'] as const) {
          if (usage[field] !== undefined) metrics.usage[field] = (metrics.usage[field] ?? 0) + usage[field]!;
        }
      },
    }, ExtractionResultSchema, signal));
    metrics.chunks++;
    results.push({ weight: chunk.weight, result: { ...result, complaints: result.complaints.map(complaint => {
      const range = complaintRange(chunk.text, complaint)!;
      return { ...complaint, quoteStart: range.quoteStart + chunk.start, quoteEnd: range.quoteEnd + chunk.start };
    }) } });
  }
  const aspects: ExtractionResult['aspects'] = [];
  const complaints: ExtractionResult['complaints'] = [];
  let weightedScore = 0; let weight = 0;
  for (const entry of results) {
    const indices = entry.result.aspects.map(aspect => {
      let index = aspects.findIndex(item => item.name === aspect.name && item.sentiment === aspect.sentiment);
      if (index < 0) { index = aspects.length; aspects.push(aspect); }
      return index;
    });
    complaints.push(...entry.result.complaints.map(complaint => ({ ...complaint, aspectIndex: indices[complaint.aspectIndex] })));
    weightedScore += entry.result.sentiment_score * entry.weight; weight += entry.weight;
  }
  const score = weight ? weightedScore / weight : results[0].result.sentiment_score;
  // Collapse overlap mentions of the same defect even if one quote has extra context.
  const unique: typeof complaints = [];
  for (const complaint of complaints) {
    if (!unique.some(item => item.aspectIndex === complaint.aspectIndex && item.scope === complaint.scope
      && item.description.trim().toLowerCase() === complaint.description.trim().toLowerCase()
      && item.quoteStart! < complaint.quoteEnd! && complaint.quoteStart! < item.quoteEnd!)) unique.push(complaint);
  }
  const result = validateExtractionEvidence(input.text, { aspects, complaints: unique, sentiment_score: score,
    sentiment: results.length === 1 ? results[0].result.sentiment : score > 0.2 ? 'positive' : score < -0.2 ? 'negative' : 'neutral' });
  assertActive();
  if (cacheEnabled) {
    try { await prisma.extractionCache.upsert({ where: { id: key },
      create: { id: key, result, expiresAt: new Date(Date.now() + 7 * 86400000) },
      update: { result, expiresAt: new Date(Date.now() + 7 * 86400000) } }); }
    catch { logger.warn('Extraction cache write unavailable; result retained'); }
  }
  return result;
}
