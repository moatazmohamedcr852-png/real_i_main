import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../shared/async-handler.js';
import { assessmentMutationLimit, assessmentStartLimit } from '../middleware/rate-limits.js';
import { assessmentInput, objectId, response } from '../domains/assessments/assessment.schemas.js';

const wrapper = (body) => validate(z.object({ body, params: z.object({ courseId: objectId.optional(), assessmentId: objectId.optional(), submissionId: objectId.optional() }), query: z.object({ course_id: objectId.optional(), courseId: objectId.optional(), type: z.string().max(40).optional(), status: z.string().max(40).optional() }) }));

export function assessmentRoutes({ service, tokens }) {
  const r = Router();
  r.get('/assessments', authenticate(tokens), wrapper(z.object({})), asyncHandler(async (req, res) => res.json(await service.list(req.auth, { ...req.query, courseId: req.query.courseId || req.query.course_id, status: req.query.status }))));
  r.post('/courses/:courseId/assessments', authenticate(tokens), requireRoles('instructor', 'admin'), wrapper(assessmentInput.omit({ courseId: true })), asyncHandler(async (req, res) => res.status(201).json(await service.create(req.auth, { ...req.validated.body, courseId: req.validated.params.courseId }))));
  r.patch('/assessments/:assessmentId', authenticate(tokens), requireRoles('instructor', 'admin'), wrapper(assessmentInput.partial().omit({ courseId: true })), asyncHandler(async (req, res) => res.json(await service.update(req.auth, req.validated.params.assessmentId, req.validated.body))));
  r.post('/assessments/:assessmentId/start', authenticate(tokens), requireRoles('student'), assessmentStartLimit, wrapper(z.object({})), asyncHandler(async (req, res) => res.status(201).json(await service.start(req.auth, req.validated.params.assessmentId))));
  r.get('/attempts/:submissionId', authenticate(tokens), requireRoles('student'), wrapper(z.object({})), asyncHandler(async (req, res) => res.json(await service.getAttempt(req.auth, req.validated.params.submissionId))));
  r.put('/attempts/:submissionId/answers', authenticate(tokens), requireRoles('student'), assessmentMutationLimit, wrapper(z.object({ responses: z.array(response).max(200) }).strict()), asyncHandler(async (req, res) => res.json(await service.save(req.auth, req.validated.params.submissionId, req.validated.body.responses))));
  r.post('/attempts/:submissionId/submit', authenticate(tokens), requireRoles('student'), assessmentMutationLimit, wrapper(z.object({})), asyncHandler(async (req, res) => res.json(await service.submit(req.auth, req.validated.params.submissionId))));
  r.get('/courses/:courseId/grading-queue', authenticate(tokens), requireRoles('instructor', 'admin'), wrapper(z.object({})), asyncHandler(async (req, res) => res.json(await service.queue(req.auth, req.validated.params.courseId))));
  r.patch('/attempts/:submissionId/grade', authenticate(tokens), requireRoles('instructor', 'admin'), wrapper(z.object({ score: z.number().min(0).max(100), feedback: z.string().max(20000).optional() }).strict()), asyncHandler(async (req, res) => res.json(await service.grade(req.auth, req.validated.params.submissionId, req.validated.body))));
  return r;
}
