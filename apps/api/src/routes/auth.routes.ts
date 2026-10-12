import { Router } from 'express';
import * as ctrl from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { LoginSchema, RegisterSchema } from '../schemas/auth.schema.js';
import rateLimit from 'express-rate-limit';
import { requireSessionOrigin } from '../middleware/session.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Слишком много попыток входа. Повторите позже.' },
});
authRouter.post('/register', requireSessionOrigin, loginLimiter, validate(RegisterSchema), ctrl.register);
authRouter.post('/login', requireSessionOrigin, loginLimiter, validate(LoginSchema), ctrl.login);
authRouter.post('/refresh', requireSessionOrigin, ctrl.refresh);
authRouter.post('/logout', requireSessionOrigin, ctrl.logout);
authRouter.get('/me', requireAuth, ctrl.me);
