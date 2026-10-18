import { z } from 'zod';
import { GroupingSettingsSchema } from './grouping.schema.js';

const timestamp = z.string().datetime({ offset: true });
export const CreateAnalysisRunSchema = z.object({
  productId: z.string().min(1).max(60),
  limit: z.number().int().min(1).max(2000).default(200),
  mode: z.enum(['new_only', 'reanalyze']).default('new_only'),
  grouping: GroupingSettingsSchema.optional(),
  selection: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('all_reviews') }).strict(),
    z.object({ kind: z.literal('imports'), importIds: z.array(z.string().min(1).max(60)).min(1).max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'Импорты не должны повторяться') }).strict(),
  ]).default({ kind: 'all_reviews' }),
  period: z.object({ from: timestamp, to: timestamp }).strict()
    .refine((period) => Date.parse(period.from) < Date.parse(period.to), 'Начало периода должно быть раньше конца').optional(),
}).strict();
export type CreateAnalysisRunInput = z.infer<typeof CreateAnalysisRunSchema>;

export const ListAnalysisRunsSchema = z.object({
  productId: z.string().min(1).max(60).optional(),
  status: z.enum(['queued', 'running', 'completed', 'partial', 'failed', 'cancelled', 'interrupted']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type ListAnalysisRunsInput = z.infer<typeof ListAnalysisRunsSchema>;

export const ListAnalysisInputsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
}).strict();
export type ListAnalysisInputsInput = z.infer<typeof ListAnalysisInputsSchema>;
