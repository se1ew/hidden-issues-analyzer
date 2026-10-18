import { Router } from 'express';
import multer from 'multer';

import * as ctrl from '../controllers/reviews.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { CSV_MAX_BYTES } from '../services/csv.service.js';
import {
  CreateManualReviewSchema,
  ListReviewsQuerySchema,
} from '../schemas/reviews.schema.js';

export const reviewsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CSV_MAX_BYTES, files: 1, fields: 5, fieldSize: 4096 },
});

reviewsRouter.use(requireAuth);

reviewsRouter.get('/', validate(ListReviewsQuerySchema, 'query'), ctrl.list);
reviewsRouter.get('/imports/:id', ctrl.importDetails);
reviewsRouter.get('/imports/:id/errors', ctrl.downloadImportErrors);
reviewsRouter.delete('/', ctrl.deleteBulk);
reviewsRouter.get('/export/csv', ctrl.exportCsv);
reviewsRouter.get('/:id', ctrl.getById);
reviewsRouter.delete('/:id', ctrl.deleteOne);
reviewsRouter.post('/upload/csv', upload.single('file'), ctrl.uploadCsv);
reviewsRouter.post('/upload/csv/preview', upload.single('file'), ctrl.previewCsv);
reviewsRouter.post('/upload/text', validate(CreateManualReviewSchema), ctrl.createManual);
