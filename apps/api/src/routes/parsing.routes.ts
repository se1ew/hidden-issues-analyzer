import { Router } from 'express';

import * as ctrl from '../controllers/parsing.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const parsingRouter = Router();

parsingRouter.use(requireAuth);

parsingRouter.get('/history', ctrl.history);
parsingRouter.post('/start', ctrl.start);
parsingRouter.get('/status/:jobId', ctrl.status);
parsingRouter.post('/status/:jobId/cancel', ctrl.cancel);
