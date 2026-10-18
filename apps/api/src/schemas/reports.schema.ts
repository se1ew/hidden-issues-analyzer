import { z } from 'zod';
import { entityId, validPeriod } from './data-scope.schema.js';
export const reportSections = ['overview', 'analytics', 'aspects', 'problems', 'evidence', 'method'] as const;
export const GenerateReportSchema = z.object({
  productId: entityId, runId: entityId,
  // null explicitly means the run has no date restriction.
  period: z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).strict()
    .refine(value => validPeriod(value), 'Некорректный период').nullable(),
  format: z.enum(['pdf', 'docx']), title: z.string().trim().min(1).max(200).optional(),
  sections: z.array(z.enum(reportSections)).min(1).max(6).refine(values => new Set(values).size === values.length, 'Разделы повторяются'),
  days: z.number().int().min(1).max(365).default(30),
}).strict();
export type GenerateReportInput = z.infer<typeof GenerateReportSchema>;
