import { z } from 'zod';
import { ExtractionResultSchema, MODEL_ASPECT_NAMES, type ExtractionResult } from './extraction.service.js';

export const SOURCE_EVIDENCE_VERSION = 'source-spans-v1';
/** Offsets identify occurrences, including repeated phrases. No model text is used as a quote. */
export function sourceEvidence(text: string) {
  const spans: Array<{ id: number; text: string; start: number; end: number }> = [];
  const add = (start: number, end: number) => {
    const raw = text.slice(start, end);
    start += raw.length - raw.trimStart().length;
    end -= raw.length - raw.trimEnd().length;
    if (end <= start || spans.length >= 64 || spans.some(span => span.start === start && span.end === end)) return;
    spans.push({ id: spans.length, text: text.slice(start, end), start, end });
  };
  add(0, text.length);
  for (const sentence of text.matchAll(/[^.!?\n]+[.!?]*/gu)) {
    add(sentence.index, sentence.index + sentence[0].length);
    for (const clause of sentence[0].matchAll(/[^,;:]+/gu)) add(sentence.index + clause.index, sentence.index + clause.index + clause[0].length);
  }
  // Empty reviews still have no selectable evidence; empty complaint lists are valid.
  const id = z.number().int().nonnegative().refine(value => !!spans[value], 'Неизвестный фрагмент');
  const complaint = ExtractionResultSchema.innerType().shape.complaints.element.omit({
    aspectIndex: true, quote: true, quoteStart: true, quoteEnd: true, consequences: true,
  }).extend({ evidenceId: id, consequenceId: id.nullable() }).strict();
  const tone = z.enum(['positive', 'negative', 'neutral']);
  const schema = z.object({ sentiment: tone, sentiment_score: z.number().finite().min(-1).max(1),
    aspects: z.array(z.object({ name: z.enum(MODEL_ASPECT_NAMES), sentiment: tone,
      complaints: z.array(complaint).max(spans.length ? 20 : 0) }).strict()).max(20),
  }).strict().superRefine((raw, ctx) => {
    raw.aspects.forEach((aspect, a) => aspect.complaints.forEach((item, c) => {
      const evidence = spans[item.evidenceId]; const consequence = item.consequenceId === null ? null : spans[item.consequenceId];
      if (consequence && evidence && (consequence.start < evidence.start || consequence.end > evidence.end || consequence.text.length > 1000)) {
        ctx.addIssue({ code: 'custom', path: ['aspects', a, 'complaints', c, 'consequenceId'], message: 'Последствие вне цитаты или слишком длинное' });
      }
    }));
  }).transform((raw): ExtractionResult => ({
    sentiment: raw.sentiment, sentiment_score: raw.sentiment_score,
    aspects: raw.aspects.map(({ name, sentiment }) => ({ name, sentiment })),
    complaints: raw.aspects.flatMap((aspect, aspectIndex) => aspect.complaints.map(({ evidenceId, consequenceId, ...item }) => ({
      ...item, aspectIndex, quote: spans[evidenceId].text, quoteStart: spans[evidenceId].start, quoteEnd: spans[evidenceId].end,
      consequences: consequenceId === null ? null : spans[consequenceId].text,
    }))),
  }));
  const selectable = { type: 'integer', enum: spans.length ? spans.map(span => span.id) : [0] };
  const jsonSchema = { type: 'object', additionalProperties: false, required: ['sentiment', 'sentiment_score', 'aspects'], properties: {
    sentiment: { type: 'string', enum: tone.options }, sentiment_score: { type: 'number', minimum: -1, maximum: 1 },
    aspects: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false, required: ['name', 'sentiment', 'complaints'], properties: {
      name: { type: 'string', enum: [...MODEL_ASPECT_NAMES] }, sentiment: { type: 'string', enum: tone.options },
      complaints: { type: 'array', maxItems: spans.length ? 20 : 0, items: { type: 'object', additionalProperties: false,
        required: ['scope', 'description', 'assertion', 'evidenceId', 'consequenceId'], properties: {
          scope: { type: 'string', enum: ['product', 'delivery', 'seller', 'packaging'] },
          description: { type: 'string', minLength: 1, maxLength: 500 },
          assertion: { type: 'string', enum: ['experienced', 'negated', 'hypothetical', 'no_experience'] },
          evidenceId: selectable, consequenceId: { anyOf: [selectable, { type: 'null' }] },
        } } },
    } } },
  } };
  return { spans, schema, jsonSchema, userPrompt: `Отзыв и доступные фрагменты (id, text):\n${JSON.stringify(spans.map(({ id, text }) => ({ id, text })))}` };
}
