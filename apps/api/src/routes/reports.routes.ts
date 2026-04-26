import { Router } from 'express';

import * as ctrl from '../controllers/reports.controller.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';

export const reportsRouter = Router();

reportsRouter.get('/', requireAuth, ctrl.list);
reportsRouter.post('/generate', optionalAuth, ctrl.generate);
reportsRouter.get('/:id/download', optionalAuth, ctrl.download);
