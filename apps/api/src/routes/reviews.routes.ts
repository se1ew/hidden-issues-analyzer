import { Router } from 'express';
import multer from 'multer';

import * as ctrl from '../controllers/reviews.controller.js';
import { optionalAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  CreateManualReviewSchema,
  ListReviewsQuerySchema,
} from '../schemas/reviews.schema.js';

export const reviewsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

reviewsRouter.use(optionalAuth);

reviewsRouter.get('/', validate(ListReviewsQuerySchema, 'query'), ctrl.list);
reviewsRouter.get('/:id', ctrl.getById);
reviewsRouter.post('/upload/csv', upload.single('file'), ctrl.uploadCsv);
reviewsRouter.post('/upload/text', validate(CreateManualReviewSchema), ctrl.createManual);
