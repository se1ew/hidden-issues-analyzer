import { Router } from 'express';

import * as ctrl from '../controllers/products.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ProductNameSchema } from '../schemas/products.schema.js';

export const productsRouter = Router();

productsRouter.use(requireAuth);

productsRouter.get('/', ctrl.list);
productsRouter.post('/', validate(ProductNameSchema), ctrl.create);
productsRouter.get('/:id', ctrl.getById);
productsRouter.patch('/:id', validate(ProductNameSchema), ctrl.rename);
productsRouter.delete('/:id', ctrl.remove);
