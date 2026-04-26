import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';

export const profileRouter = Router();

profileRouter.use(requireAuth);

profileRouter.get('/stats', async (req, res) => {
  const userId = req.user!.sub;
  const [batches, reports] = await Promise.all([
    prisma.uploadBatch.count({ where: { userId } }),
    prisma.report.count({ where: { userId } }),
  ]);
  res.json({ uploads: batches, reports });
});
