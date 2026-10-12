import { requestUserId } from '../middleware/auth.js';
import type { Request, Response } from 'express';

import { HttpError } from '../middleware/error.js';
import { createProduct, getProduct, listProducts, renameProduct, removeProduct } from '../services/products.service.js';

export async function list(req: Request, res: Response): Promise<void> {
  const items = await listProducts(requestUserId(req));
  res.json({ items });
}

export async function create(req: Request, res: Response): Promise<void> {
  res.status(201).json(await createProduct(req.body.name as string, requestUserId(req)));
}

export async function getById(req: Request, res: Response): Promise<void> {
  res.json(await getProduct(req.params.id as string, requestUserId(req)));
}

export async function rename(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const name = (req.body?.name as string)?.trim();
  if (!name) throw new HttpError(400, 'Имя не может быть пустым');
  const product = await renameProduct(id, name, requestUserId(req));
  if (!product) throw new HttpError(404, 'Товар не найден');
  res.json(product);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  await removeProduct(id, requestUserId(req));
  res.status(204).end();
}
