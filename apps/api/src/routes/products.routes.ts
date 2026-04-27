import { Router } from 'express';

import * as ctrl from '../controllers/products.controller.js';
import { optionalAuth } from '../middleware/auth.js';

export const productsRouter = Router();

productsRouter.use(optionalAuth);

productsRouter.get('/', ctrl.list);
