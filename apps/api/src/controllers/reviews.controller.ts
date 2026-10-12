import { requestUserId } from '../middleware/auth.js';
import 'multer'; // augments Express.Request with `file` and `files`
import type { Request, Response } from 'express';
import { z } from 'zod';

import { HttpError } from '../middleware/error.js';
import * as reviewsService from '../services/reviews.service.js';
import type { CreateManualReviewInput, ListReviewsQuery } from '../schemas/reviews.schema.js';

export async function list(req: Request, res: Response): Promise<void> {
  const result = await reviewsService.listReviews(req.query as unknown as ListReviewsQuery, requestUserId(req));
  res.json(result);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const review = await reviewsService.getReview(id, requestUserId(req));
  res.json(review);
}

export async function uploadCsv(req: Request, res: Response): Promise<void> {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) throw new HttpError(400, 'Файл не загружен (поле: file)');
  const { productName, productId } = z.object({ productName: z.string().trim().min(1).max(200).optional(), productId: z.string().min(1).max(60).optional() }).parse(req.body ?? {});
  const result = await reviewsService.importReviewsFromCsv(
    file.buffer,
    file.originalname,
    requestUserId(req),
    productName,
    productId,
  );
  res.status(201).json(result);
}

export async function createManual(req: Request, res: Response): Promise<void> {
  const result = await reviewsService.createManualReview(
    req.body as CreateManualReviewInput,
    requestUserId(req),
  );
  res.status(201).json(result);
}

export async function deleteOne(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  await reviewsService.deleteReview(id, requestUserId(req));
  res.status(204).end();
}

export async function deleteBulk(req: Request, res: Response): Promise<void> {
  const productId = (req.query.productId as string) || undefined;
  const count = await reviewsService.deleteReviewsBulk(requestUserId(req), productId);
  res.json({ deleted: count });
}
