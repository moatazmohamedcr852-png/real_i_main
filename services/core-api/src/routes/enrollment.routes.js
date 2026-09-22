import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../shared/async-handler.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
export function enrollmentRoutes({ service, tokens }) {
  const r = Router();
  r.post('/:enrollmentId/drop', authenticate(tokens), validate(z.object({ body: z.object({}), params: z.object({ enrollmentId: objectId }), query: z.object({}) })), asyncHandler(async (req, res) => res.json(await service.drop(req.auth, req.validated.params.enrollmentId))));
  return r;
}
