import { Router } from 'express';

import * as ctrl from '../controllers/parsing.controller.js';
import { optionalAuth } from '../middleware/auth.js';

export const parsingRouter = Router();

parsingRouter.use(optionalAuth);

parsingRouter.get('/history', ctrl.history);
parsingRouter.post('/start', ctrl.start);
parsingRouter.get('/status/:jobId', ctrl.status);
