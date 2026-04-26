import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.js';

export const reviewsRouter = Router();

reviewsRouter.use(optionalAuth);

// TODO: реализация в следующем коммите
reviewsRouter.get('/', (_req, res) => {
  res.json({ items: [], total: 0, message: 'reviews list — заглушка' });
});

reviewsRouter.get('/:id', (req, res) => {
  res.json({ id: req.params.id, message: 'review details — заглушка' });
});

reviewsRouter.post('/upload/csv', (_req, res) => {
  res.status(501).json({ error: 'Not Implemented Yet' });
});

reviewsRouter.post('/upload/text', (_req, res) => {
  res.status(501).json({ error: 'Not Implemented Yet' });
});
