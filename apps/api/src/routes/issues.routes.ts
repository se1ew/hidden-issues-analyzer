import { Router } from 'express';

import * as ctrl from '../controllers/issues.controller.js';
import * as grouping from '../controllers/grouping.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const issuesRouter = Router();

issuesRouter.use(requireAuth);
issuesRouter.get('/groupings', grouping.list);
issuesRouter.get('/groupings/history', grouping.history);
issuesRouter.post('/groupings/:id/edit', grouping.edit);
issuesRouter.get('/snapshots/:id/evidence', grouping.evidence);
issuesRouter.patch('/problems/:id/state', grouping.state);

issuesRouter.get('/', ctrl.list);
issuesRouter.get('/:id', ctrl.getById);
issuesRouter.patch('/:id/resolve', ctrl.toggleResolved);
issuesRouter.post('/recompute', ctrl.recompute);
