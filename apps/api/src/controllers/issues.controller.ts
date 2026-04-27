import type { Request, Response } from 'express';

import { HttpError } from '../middleware/error.js';
import {
  getHiddenIssue,
  listHiddenIssues,
  recomputeHiddenIssues,
} from '../services/clustering.service.js';

export async function list(req: Request, res: Response): Promise<void> {
  const productId = (req.query.productId as string) || undefined;
  const items = await listHiddenIssues(productId);
  res.json({ items });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const issue = await getHiddenIssue(id);
  if (!issue) throw new HttpError(404, 'Hidden issue not found');
  res.json(issue);
}

export async function recompute(req: Request, res: Response): Promise<void> {
  const productId =
    (req.body?.productId as string | undefined) ||
    (req.query.productId as string | undefined) ||
    undefined;
  const result = await recomputeHiddenIssues(productId);
  res.json(result);
}
