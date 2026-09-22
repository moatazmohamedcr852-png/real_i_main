import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { allowAnonymous, authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { emptyRequestSchema, loginSchema, refreshSchema, registerSchema } from '../domains/auth/auth.schemas.js';
import { createAuthController } from '../controllers/auth.controller.js';

const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'AUTH_RATE_LIMITED', message: 'Too many authentication attempts. Please try again later.' } } });

export function authRoutes({ authService, tokens }) {
  const router = Router();
  const controller = createAuthController(authService);
  router.post('/register', allowAnonymous, authLimit, validate(registerSchema), controller.register);
  router.post('/login', allowAnonymous, authLimit, validate(loginSchema), controller.login);
  router.post('/refresh', allowAnonymous, authLimit, validate(refreshSchema), controller.refresh);
  router.post('/logout', authenticate(tokens), validate(emptyRequestSchema), controller.logout);
  router.get('/me', authenticate(tokens), controller.me);
  return router;
}
