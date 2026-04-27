import type { Request, Response } from 'express';

import { HttpError } from '../middleware/error.js';
import {
  getHiddenIssue,
  listHiddenIssues,
  recomputeHiddenIssues,
} from '../services/clustering.service.js';

export async function list(req: Request, res: Response): Promise<void> {
  const productId = (req.query.productId as string) || undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const result = await listHiddenIssues(productId, page, pageSize);
  res.json(result);
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
