import { Router } from 'express';

import * as ctrl from '../controllers/reports.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const reportsRouter = Router();

reportsRouter.get('/', requireAuth, ctrl.list);
reportsRouter.post('/generate', requireAuth, ctrl.generate);
reportsRouter.get('/:id/download', requireAuth, ctrl.download);
