import type { Request, Response } from 'express';

import { getUnassignedStats, listProducts } from '../services/products.service.js';

export async function list(_req: Request, res: Response): Promise<void> {
  const [products, unassigned] = await Promise.all([listProducts(), getUnassignedStats()]);
  const items = unassigned ? [...products, unassigned] : products;
  res.json({ items });
}
