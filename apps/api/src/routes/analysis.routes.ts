import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.js';

export const analysisRouter = Router();

analysisRouter.use(optionalAuth);

analysisRouter.post('/run', (_req, res) => {
  res.status(501).json({ error: 'Not Implemented Yet' });
});

analysisRouter.get('/stats', (_req, res) => {
  res.json({
    total: 0,
    avgRating: null,
    sentiment: { positive: 0, negative: 0, neutral: 0 },
    issuesCount: 0,
  });
});

analysisRouter.get('/timeseries', (_req, res) => {
  res.json({ buckets: [] });
});
