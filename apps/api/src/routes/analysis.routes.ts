import { Router } from 'express';

import * as ctrl from '../controllers/analysis.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const analysisRouter = Router();

analysisRouter.use(requireAuth);
analysisRouter.get('/provider', ctrl.provider);
analysisRouter.post('/provider/check', ctrl.checkProvider);
analysisRouter.get('/runs', ctrl.listRuns);
analysisRouter.get('/runs/:runId', ctrl.getRun);
analysisRouter.post('/runs', ctrl.run);
analysisRouter.post('/runs/:runId/cancel', ctrl.cancel);
analysisRouter.post('/runs/:runId/retry-failed', ctrl.retryFailed);

analysisRouter.post('/run', ctrl.run);
analysisRouter.post('/:jobId/cancel', ctrl.cancel);
analysisRouter.get('/stats', ctrl.stats);
analysisRouter.get('/timeseries', ctrl.timeseries);
analysisRouter.get('/summary', ctrl.summary);
