import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.js';

export const parsingRouter = Router();

parsingRouter.use(optionalAuth);

parsingRouter.post('/start', (_req, res) => {
  res.status(501).json({ error: 'Not Implemented Yet' });
});

parsingRouter.get('/status/:jobId', (req, res) => {
  res.json({ jobId: req.params.jobId, status: 'pending' });
});
