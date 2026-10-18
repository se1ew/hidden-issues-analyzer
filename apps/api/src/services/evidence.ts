import type { Sentiment } from '@prisma/client';

export const QUOTE_OFFSET_UNIT = 'utf16' as const;
export const MASKING_METHOD_VERSION = 'positive-context-v1';

/** JS slice-compatible offsets: zero-based, end exclusive, original text only. */
export function locateQuote(text: string, quote: string) {
  const quoteStart = text.indexOf(quote);
  if (!quote || quoteStart < 0) return null;
  // Without a supplied occurrence identifier, choosing one repeated quote is ambiguous.
  if (text.indexOf(quote, quoteStart + 1) >= 0) return null;
  return { quoteStart, quoteEnd: quoteStart + quote.length, offsetUnit: QUOTE_OFFSET_UNIT };
}

export function maskingContext(rating: number | null, sentiment: Sentiment) {
  const highRating = rating === null ? null : rating >= 4;
  const positiveSentiment = sentiment === 'positive';
  const reasons = [highRating === true ? 'high_rating' : null,
    positiveSentiment ? 'positive_sentiment' : null].filter((reason): reason is string => reason !== null);
  return { methodVersion: MASKING_METHOD_VERSION, rating, highRating, sentiment, positiveSentiment,
    positiveContext: reasons.length > 0, reasons, interpretation: 'mention_signal' };
}
