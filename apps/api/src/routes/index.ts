import { Router } from 'express';

import { analysisRouter } from './analysis.routes.js';
import { authRouter } from './auth.routes.js';
import { issuesRouter } from './issues.routes.js';
import { parsingRouter } from './parsing.routes.js';
import { productsRouter } from './products.routes.js';
import { profileRouter } from './profile.routes.js';
import { reportsRouter } from './reports.routes.js';
import { reviewsRouter } from './reviews.routes.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/reviews', reviewsRouter);
apiRouter.use('/analysis', analysisRouter);
apiRouter.use('/issues', issuesRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/parsing', parsingRouter);
apiRouter.use('/profile', profileRouter);
apiRouter.use('/products', productsRouter);
