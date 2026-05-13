import { Router } from 'express';

import * as ctrl from '../controllers/analysis.controller.js';
import { optionalAuth } from '../middleware/auth.js';

export const analysisRouter = Router();

analysisRouter.use(optionalAuth);

analysisRouter.post('/run', ctrl.run);
analysisRouter.post('/:jobId/cancel', ctrl.cancel);
analysisRouter.get('/stats', ctrl.stats);
analysisRouter.get('/timeseries', ctrl.timeseries);
analysisRouter.get('/summary', ctrl.summary);
