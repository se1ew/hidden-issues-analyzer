import type { Request, Response } from 'express';

import { HttpError } from '../middleware/error.js';
import {
  getHiddenIssue,
  listHiddenIssues,
  recomputeHiddenIssues,
} from '../services/clustering.service.js';

export async function list(_req: Request, res: Response): Promise<void> {
  const items = await listHiddenIssues();
  res.json({ items });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const issue = await getHiddenIssue(id);
  if (!issue) throw new HttpError(404, 'Hidden issue not found');
  res.json(issue);
}

export async function recompute(_req: Request, res: Response): Promise<void> {
  const result = await recomputeHiddenIssues();
  res.json(result);
}
