import { Router } from 'express';
import * as ctrl from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { LoginSchema, RefreshSchema, RegisterSchema } from '../schemas/auth.schema.js';

export const authRouter = Router();

authRouter.post('/register', validate(RegisterSchema), ctrl.register);
authRouter.post('/login', validate(LoginSchema), ctrl.login);
authRouter.post('/refresh', validate(RefreshSchema), ctrl.refresh);
authRouter.post('/logout', validate(RefreshSchema), ctrl.logout);
authRouter.get('/me', requireAuth, ctrl.me);
