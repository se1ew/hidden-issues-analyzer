import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.js';

export const issuesRouter = Router();

issuesRouter.use(optionalAuth);

issuesRouter.get('/', (_req, res) => {
  res.json({ items: [] });
});

issuesRouter.get('/:id', (req, res) => {
  res.json({ id: req.params.id, message: 'issue details — заглушка' });
});

issuesRouter.post('/recompute', (_req, res) => {
  res.status(501).json({ error: 'Not Implemented Yet' });
});
