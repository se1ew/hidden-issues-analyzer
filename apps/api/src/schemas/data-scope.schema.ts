import { z } from 'zod';
export const entityId = z.string().trim().min(1).max(80);
export const paginationShape = {
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};
export const scopeShape = { productId: entityId.optional(), runId: entityId.optional(),
  from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional() };
export function validPeriod(value: { from?: string; to?: string; runId?: string; productId?: string }) {
  return (!value.runId || !!value.productId) && ((!value.from && !value.to) || (!!value.from && !!value.to && Date.parse(value.from) < Date.parse(value.to)));
}
export const DataScopeSchema = z.object(scopeShape).strict().refine(validPeriod, 'Укажите товар для запуска и обе границы периода (from < to)');
export type DataScope = z.infer<typeof DataScopeSchema>;
