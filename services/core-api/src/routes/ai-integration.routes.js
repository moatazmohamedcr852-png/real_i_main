import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../shared/async-handler.js';
import { objectId } from '../domains/assessments/assessment.schemas.js';

const params = z.object({ courseId: objectId });
const wrap = (body) => validate(z.object({ body, params, query: z.object({}) }));

export function aiIntegrationRoutes({ service, tokens, limits }) {
  const r = Router();
  r.post('/courses/:courseId/ai/materials', authenticate(tokens), requireRoles('instructor', 'admin'), limits.ingest, wrap(z.object({ documentId: z.string().trim().min(1).max(200), sourceTitle: z.string().trim().min(1).max(500), content: z.string().min(1).max(100000) }).strict()), asyncHandler(async (req, res) => res.status(202).json(await service.ingest(req.auth, req.validated.params.courseId, req.validated.body, req.requestId))));
  r.post('/courses/:courseId/ai/chat', authenticate(tokens), requireRoles('student'), limits.chat, wrap(z.object({ message: z.string().trim().min(1).max(10000), topK: z.number().int().min(1).max(10).default(5) }).strict()), asyncHandler(async (req, res) => res.json(await service.chat(req.auth, req.validated.params.courseId, req.validated.body, req.requestId))));
  r.post('/courses/:courseId/ai/quizzes', authenticate(tokens), requireRoles('instructor', 'admin'), limits.quiz, wrap(z.object({ topic: z.string().trim().min(1).max(500), count: z.number().int().min(1).max(20), title: z.string().trim().min(1).max(200), instructions: z.string().max(10000).optional(), timeLimitSeconds: z.number().int().min(60).max(28800), randomizeQuestions: z.boolean().optional(), maxAttempts: z.number().int().min(1).max(20).optional(), availableFrom: z.coerce.date().nullable().optional(), dueAt: z.coerce.date().nullable().optional() }).strict()), asyncHandler(async (req, res) => res.status(201).json(await service.generateQuiz(req.auth, req.validated.params.courseId, req.validated.body, req.requestId))));
  r.post('/courses/:courseId/ai/guidelines', authenticate(tokens), requireRoles('instructor', 'admin'), limits.directive, wrap(z.object({ directive: z.string().trim().min(1).max(10000) }).strict()), asyncHandler(async (req, res) => res.status(201).json(await service.directive(req.auth, req.validated.params.courseId, req.validated.body, req.requestId))));
  return r;
}
