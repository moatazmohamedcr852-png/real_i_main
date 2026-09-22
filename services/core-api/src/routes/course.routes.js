import { Router } from 'express';
import { z } from 'zod';
import { allowAnonymous, authenticate, authenticateOptional, requireRoles } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../shared/async-handler.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const courseInput = z.object({ title: z.string().trim().min(3).max(200), description: z.string().trim().min(1).max(10000), category: z.string().trim().max(80).nullable().optional(), difficulty: z.enum(['beginner', 'intermediate', 'advanced']).nullable().optional(), pricing: z.object({ access: z.enum(['free', 'paid']), currency: z.string().length(3).nullable().optional(), amount: z.number().min(0).nullable().optional() }).optional(), status: z.enum(['draft', 'published']).optional(), enrollmentOpen: z.boolean().optional(), instructorId: objectId.optional() }).strict();
const courseUpdate = courseInput.omit({ instructorId: true }).partial();
const lessonInput = z.object({ title: z.string().trim().min(1).max(200), content: z.string().min(1).max(100000), status: z.enum(['draft', 'published']).optional() }).strict();
const wrap = (schema) => validate(z.object({ body: schema, params: z.object({ courseId: objectId.optional(), lessonId: objectId.optional(), id: objectId.optional() }), query: z.object({ category: z.string().max(80).optional(), difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(), limit: z.coerce.number().int().min(1).max(50).optional() }) }));

export function courseRoutes({ service, enrollmentService, tokens }) {
  const r = Router();
  r.get('/', authenticateOptional(tokens), wrap(z.object({})), asyncHandler(async (req, res) => res.json(await service.decorateCatalog(req.auth, await service.listPublic(req.validated.query)))));
  r.get('/catalog', authenticateOptional(tokens), wrap(z.object({})), asyncHandler(async (req, res) => res.json(await service.decorateCatalog(req.auth, await service.listPublic(req.validated.query)))));
  r.get('/categories', allowAnonymous, wrap(z.object({})), asyncHandler(async (_req, res) => res.json(['Getting Started', 'Development', 'Design', 'Data Science', 'AI & ML'])));
  r.post('/:courseId/enroll', authenticate(tokens), requireRoles('student', 'instructor', 'admin'), wrap(z.object({})), asyncHandler(async (req, res) => {
    if (!enrollmentService?.enroll) throw Object.assign(new Error('Enrollment is not available.'), { status: 501, code: 'NOT_IMPLEMENTED' });
    res.status(201).json(await enrollmentService.enroll(req.auth, req.validated.params.courseId));
  }));
  r.post('/:courseId/enroll/:id', authenticate(tokens), requireRoles('instructor', 'admin'), wrap(z.object({})), asyncHandler(async (req, res) => {
    if (!enrollmentService?.enroll) throw Object.assign(new Error('Enrollment is not available.'), { status: 501, code: 'NOT_IMPLEMENTED' });
    res.status(201).json(await enrollmentService.enroll(req.auth, req.validated.params.courseId, req.validated.params.id));
  }));
  r.get('/:id', authenticateOptional(tokens), wrap(z.object({})), asyncHandler(async (req, res) => res.json(await service.get(req.auth, req.validated.params.id))));
  r.post('/', authenticate(tokens), requireRoles('instructor', 'admin'), wrap(courseInput), asyncHandler(async (req, res) => res.status(201).json(await service.create(req.auth, req.validated.body))));
  r.patch('/:id', authenticate(tokens), requireRoles('instructor', 'admin'), wrap(courseUpdate), asyncHandler(async (req, res) => res.json(await service.update(req.auth, req.validated.params.id, req.validated.body))));
  r.delete('/:id', authenticate(tokens), requireRoles('instructor', 'admin'), wrap(z.object({})), asyncHandler(async (req, res) => res.json(await service.archive(req.auth, req.validated.params.id))));
  r.post('/:courseId/lessons', authenticate(tokens), requireRoles('instructor', 'admin'), wrap(lessonInput), asyncHandler(async (req, res) => res.status(201).json(await service.addLesson(req.auth, req.validated.params.courseId, req.validated.body))));
  r.patch('/:courseId/lessons/:lessonId', authenticate(tokens), requireRoles('instructor', 'admin'), wrap(lessonInput.partial()), asyncHandler(async (req, res) => res.json(await service.updateLesson(req.auth, req.validated.params.courseId, req.validated.params.lessonId, req.validated.body))));
  r.get('/:courseId/lessons/:lessonId', authenticateOptional(tokens), wrap(z.object({})), asyncHandler(async (req, res) => res.json(await service.getLesson(req.auth, req.validated.params.courseId, req.validated.params.lessonId))));
  r.patch('/:courseId/lessons/:lessonId/reorder', authenticate(tokens), requireRoles('instructor', 'admin'), wrap(z.object({ position: z.number().int().min(1) })), asyncHandler(async (req, res) => res.json(await service.reorderLesson(req.auth, req.validated.params.courseId, req.validated.params.lessonId, req.validated.body.position))));
  r.delete('/:courseId/lessons/:lessonId', authenticate(tokens), requireRoles('instructor', 'admin'), wrap(z.object({})), asyncHandler(async (req, res) => { await service.removeLesson(req.auth, req.validated.params.courseId, req.validated.params.lessonId); res.status(204).send(); }));
  return r;
}
