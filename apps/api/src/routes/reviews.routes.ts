import { Router } from 'express';
import multer from 'multer';

import * as ctrl from '../controllers/reviews.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  CreateManualReviewSchema,
  ListReviewsQuerySchema,
} from '../schemas/reviews.schema.js';

export const reviewsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

reviewsRouter.use(requireAuth);

reviewsRouter.get('/', validate(ListReviewsQuerySchema, 'query'), ctrl.list);
reviewsRouter.delete('/', ctrl.deleteBulk);
reviewsRouter.get('/:id', ctrl.getById);
reviewsRouter.delete('/:id', ctrl.deleteOne);
reviewsRouter.post('/upload/csv', upload.single('file'), ctrl.uploadCsv);
reviewsRouter.post('/upload/text', validate(CreateManualReviewSchema), ctrl.createManual);
