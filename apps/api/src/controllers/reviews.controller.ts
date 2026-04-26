import 'multer'; // augments Express.Request with `file` and `files`
import type { Request, Response } from 'express';

import { HttpError } from '../middleware/error.js';
import * as reviewsService from '../services/reviews.service.js';
import type { CreateManualReviewInput, ListReviewsQuery } from '../schemas/reviews.schema.js';

export async function list(req: Request, res: Response): Promise<void> {
  const result = await reviewsService.listReviews(req.query as unknown as ListReviewsQuery);
  res.json(result);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const review = await reviewsService.getReview(id);
  res.json(review);
}

export async function uploadCsv(req: Request, res: Response): Promise<void> {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) throw new HttpError(400, 'Файл не загружен (поле: file)');
  const result = await reviewsService.importReviewsFromCsv(
    file.buffer,
    file.originalname,
    req.user?.sub ?? null,
  );
  res.status(201).json(result);
}

export async function createManual(req: Request, res: Response): Promise<void> {
  const result = await reviewsService.createManualReview(
    req.body as CreateManualReviewInput,
    req.user?.sub ?? null,
  );
  res.status(201).json(result);
}
