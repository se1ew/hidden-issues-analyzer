import { Router } from 'express';
import multer from 'multer';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { UPLOADS_DIR } from '../lib/upload-storage.js';

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
  storage: multer.diskStorage({
    destination: (_req, _file, done) => { void mkdir(UPLOADS_DIR, { recursive: true }).then(() => done(null, UPLOADS_DIR)).catch(error => done(error, UPLOADS_DIR)); },
    filename: (_req, _file, done) => done(null, `csv-${randomUUID()}.tmp`),
  }),
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
