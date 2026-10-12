import { z } from 'zod';

export const ProductNameSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();
export const ImportProductSchema = z.object({
  productId: z.string().min(1).max(60).optional(),
  productName: z.string().trim().min(1).max(200).optional(),
}).refine((value) => Boolean(value.productId) !== Boolean(value.productName),
  'Выберите товар или укажите название нового товара');
