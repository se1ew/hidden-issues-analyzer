import { prisma } from '../lib/prisma.js';
import { HttpError } from '../middleware/error.js';

export function ownedProductScope(userId: string, productId?: string) {
  if (!userId) throw new HttpError(401, 'Unauthorized');
  return {
    product: { userId },
    ...(productId ? { productId } : {}),
  };
}

export async function requireOwnedProduct(userId: string, productId: string) {
  if (!userId) throw new HttpError(401, 'Unauthorized');
  const product = await prisma.product.findFirst({ where: { id: productId, userId } });
  if (!product) throw new HttpError(404, 'Товар не найден');
  return product;
}
