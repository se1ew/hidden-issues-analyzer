import type { Request, Response } from 'express';
import { z } from 'zod';
import { requestUserId } from '../middleware/auth.js';
import { GroupingQuerySchema, EditGroupingSchema, ProblemStateSchema } from '../schemas/grouping.schema.js';
import { listRunGroups, listGroupingHistory, groupEvidence, editGrouping, setProblemState } from '../services/grouping-management.service.js';
const pagination = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(10) }).strict();
export async function list(req: Request, res: Response) { res.json(await listRunGroups(requestUserId(req), GroupingQuerySchema.parse(req.query))); }
export async function history(req: Request, res: Response) {
  const { productId } = z.object({ productId: z.string().min(1).max(80) }).strict().parse(req.query);
  res.json({ items: await listGroupingHistory(requestUserId(req), productId) });
}
export async function evidence(req: Request, res: Response) {
  const { page, pageSize } = pagination.parse(req.query);
  res.json(await groupEvidence(requestUserId(req), req.params.id as string, page, pageSize));
}
export async function edit(req: Request, res: Response) { res.json(await editGrouping(requestUserId(req), req.params.id as string, EditGroupingSchema.parse(req.body))); }
export async function state(req: Request, res: Response) { res.json(await setProblemState(requestUserId(req), req.params.id as string, ProblemStateSchema.parse(req.body))); }
