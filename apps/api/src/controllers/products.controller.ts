import type { Request, Response } from 'express';

import { HttpError } from '../middleware/error.js';
import { getUnassignedStats, listProducts, renameProduct, removeProduct } from '../services/products.service.js';

export async function list(_req: Request, res: Response): Promise<void> {
  const [products, unassigned] = await Promise.all([listProducts(), getUnassignedStats()]);
  const items = unassigned ? [...products, unassigned] : products;
  res.json({ items });
}

export async function rename(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const name = (req.body?.name as string)?.trim();
  if (!name) throw new HttpError(400, 'Имя не может быть пустым');
  const product = await renameProduct(id, name);
  if (!product) throw new HttpError(404, 'Товар не найден');
  res.json(product);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  await removeProduct(id);
  res.status(204).end();
}
