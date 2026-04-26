import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

reportsRouter.get('/', (_req, res) => {
  res.json({ items: [] });
});

reportsRouter.post('/generate', (_req, res) => {
  res.status(501).json({ error: 'Not Implemented Yet' });
});

reportsRouter.get('/:id/download', (req, res) => {
  res.status(404).json({ error: `report ${req.params.id} not found` });
});
