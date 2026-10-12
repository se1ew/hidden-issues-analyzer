import { Router } from 'express';

import * as ctrl from '../controllers/issues.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const issuesRouter = Router();

issuesRouter.use(requireAuth);

issuesRouter.get('/', ctrl.list);
issuesRouter.get('/:id', ctrl.getById);
issuesRouter.patch('/:id/resolve', ctrl.toggleResolved);
issuesRouter.post('/recompute', ctrl.recompute);
