import { requestUserId } from '../middleware/auth.js';
import type { Request, Response } from 'express';

import { HttpError } from '../middleware/error.js';
import {
  getHiddenIssue,
  listHiddenIssues,
  toggleResolvedIssue,
} from '../services/legacy-issues.service.js';
import { z } from 'zod';
import { recomputeRunGrouping } from '../services/clustering.service.js';

export async function list(req: Request, res: Response): Promise<void> {
  const productId = (req.query.productId as string) || undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const result = await listHiddenIssues(requestUserId(req), productId, page, pageSize);
  res.json(result);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const issue = await getHiddenIssue(id, requestUserId(req));
  if (!issue) throw new HttpError(404, 'Hidden issue not found');
  res.json(issue);
}

export async function toggleResolved(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const issue = await toggleResolvedIssue(id, requestUserId(req));
  if (!issue) throw new HttpError(404, 'Hidden issue not found');
  res.json(issue);
}

export async function recompute(req: Request, res: Response): Promise<void> {
  const { runId } = z.object({ runId: z.string().min(1).max(80) }).strict().parse(req.body);
  const result = await recomputeRunGrouping(requestUserId(req), runId);
  res.json(result);
}
