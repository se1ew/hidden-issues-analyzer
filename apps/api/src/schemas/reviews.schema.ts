import { z } from 'zod';

export const ListReviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sentiment: z.enum(['positive', 'negative', 'neutral']).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  hasIssues: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().trim().min(1).max(200).optional(),
  productId: z.string().min(1).max(60).optional(),
});
export type ListReviewsQuery = z.infer<typeof ListReviewsQuerySchema>;

export const CreateManualReviewSchema = z.object({
  text: z.string().trim().min(1).max(10_000),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  productName: z.string().trim().min(1).max(200).optional(),
});
export type CreateManualReviewInput = z.infer<typeof CreateManualReviewSchema>;
