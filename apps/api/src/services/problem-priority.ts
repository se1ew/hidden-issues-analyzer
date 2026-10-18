/** Only an exact, explicitly reported consequence can receive a category. */
export const PRIORITY_VERSION = 'support-masking-consequence-v1';
export function consequenceCategory(text: string | null, quote: string) {
  if (!text || !quote.includes(text)) return 'undetermined' as const;
  // Conservative vocabulary: ambiguous or negated descriptions stay uncategorized.
  if (/\b(no|not|without)\b|(?:^|[^\p{L}])(?:не|нет|без)(?=$|[^\p{L}])/iu.test(text)) return 'reported' as const;
  if (/получил(?:а|и)?\s+(?:ожог|травм|порез)|обж[её]г(?:ся|лась)|порезал(?:ся|ась)|ударило током/iu.test(text)) return 'reported_harm' as const;
  if (/невозможно пользоваться|перестал работать|перестала работать|вышел из строя|вышла из строя/iu.test(text)) return 'loss_of_use' as const;
  return 'reported' as const;
}
export function priorityIndicator(support: number, positiveContextCount: number, consequenceRank: number, signal: boolean) {
  return { version: PRIORITY_VERSION, support, positiveContextCount, consequenceRank,
    // Each component has a bounded range (max 2000 reviews / run).
    score: support * 100_000 + positiveContextCount * 10 + consequenceRank,
    explanation: `Сначала поддержка (${support}), затем положительный контекст (${positiveContextCount}), затем явно описанные последствия (${consequenceRank}).`,
    evidenceLabel: signal ? 'Мало подтверждений' : 'Повторяющаяся жалоба',
    limitation: 'Алгоритмический порядок проверки; вероятность и критичность не измерены.' };
}
