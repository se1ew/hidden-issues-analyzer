import { z } from 'zod';

export const GroupingSettingsSchema = z.object({
  version: z.literal('dbscan-complete-link-v1').default('dbscan-complete-link-v1'),
  epsilon: z.number().finite().min(0.01).max(0.6).default(0.25),
  minReviews: z.number().int().min(2).max(20).default(2),
  maxMentions: z.number().int().min(1).max(2000).default(1000),
  representatives: z.number().int().min(1).max(8).default(4),
}).strict();
export type GroupingSettings = z.infer<typeof GroupingSettingsSchema>;
const id = z.string().min(1).max(80);
const ids = z.array(id).min(1).max(2000).refine(values => new Set(values).size === values.length, 'ID не должны повторяться');
export const GroupingQuerySchema = z.object({
  productId: id, runId: id.optional(), publicationId: id.optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export const EditGroupingSchema = z.object({
  expectedPublicationId: id,
  commit: z.boolean().default(false),
  reason: z.string().trim().min(1).max(500),
  change: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('merge'), snapshotIds: ids.refine(values => values.length >= 2, 'Выберите несколько групп') }).strict(),
    z.object({ kind: z.literal('split'), snapshotId: id, parts: z.array(ids).min(2).max(100) }).strict(),
    z.object({ kind: z.literal('restore') }).strict(),
    z.object({ kind: z.literal('link'), snapshotId: id, problemId: id }).strict(),
  ]),
}).strict();
export const ProblemStateSchema = z.object({
  status: z.enum(['new', 'confirmed', 'rejected', 'resolved']),
  expectedVersion: z.number().int().nonnegative(), reason: z.string().trim().max(500).optional(),
}).strict().refine(value => value.status !== 'rejected' || !!value.reason, 'Укажите причину отклонения');
