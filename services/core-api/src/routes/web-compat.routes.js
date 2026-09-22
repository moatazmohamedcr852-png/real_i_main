import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../shared/async-handler.js';
import { AppError, forbidden } from '../shared/errors.js';
import { User } from '../domains/auth/user.model.js';
import { Enrollment } from '../domains/enrollments/enrollment.model.js';
import { Lesson } from '../domains/lessons/lesson.model.js';
import { Submission } from '../domains/submissions/submission.model.js';
import { LessonProgress } from '../domains/progress/lesson-progress.model.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const empty = validate(z.object({ body: z.object({}).optional().default({}), params: z.object({ userId: objectId.optional(), lessonId: objectId.optional(), id: objectId.optional() }), query: z.record(z.string(), z.any()).optional().default({}) }));

function publicUser(user) {
  return { id: String(user._id), email: user.email, name: user.name, role: user.role, avatar: null };
}

export function webCompatRoutes({ tokens, virtualClassroomService }) {
  const r = Router();

  r.get('/meetings', authenticate(tokens), empty, asyncHandler(async (req, res) => {
    if (!virtualClassroomService?.list) return res.json({ success: true, meetings: [] });
    res.json(await virtualClassroomService.list(req.auth, req.query));
  }));

  r.get('/users', authenticate(tokens), requireRoles('admin', 'instructor'), empty, asyncHandler(async (_req, res) => {
    const users = await User.find({ deletedAt: null }).select('email name role').lean();
    res.json(users.map(publicUser));
  }));

  r.get('/users/:id', authenticate(tokens), empty, asyncHandler(async (req, res) => {
    if (req.auth.role !== 'admin' && String(req.auth.userId) !== String(req.validated.params.id)) throw forbidden();
    const user = await User.findOne({ _id: req.validated.params.id, deletedAt: null });
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
    const [progress, enrollments, completed] = await Promise.all([
      LessonProgress.find({ userId: user._id }).select('lessonId').lean(),
      Enrollment.find({ studentId: user._id, status: 'enrolled' }).select('courseId').lean(),
      Submission.find({ studentId: user._id, kind: 'assessment', attemptStatus: { $in: ['submitted', 'timed_out', 'finalized_due_date'] } }).select('assessmentId grading score').lean()
    ]);
    res.json({
      ...publicUser(user),
      completed_lessons: progress.map((item) => String(item.lessonId)),
      enrolled_courses: enrollments.map((item) => String(item.courseId)),
      completed_tasks: completed.map((item) => ({ task_id: String(item.assessmentId), score: item.grading?.score ?? null }))
    });
  }));

  r.post('/users/:userId/lessons/:lessonId/toggle', authenticate(tokens), empty, asyncHandler(async (req, res) => {
    if (req.auth.role !== 'admin' && String(req.auth.userId) !== String(req.validated.params.userId)) throw forbidden();
    const lesson = await Lesson.findById(req.validated.params.lessonId);
    if (!lesson) throw new AppError(404, 'LESSON_NOT_FOUND', 'Lesson not found.');
    const existing = await LessonProgress.findOne({ userId: req.validated.params.userId, lessonId: lesson._id });
    if (existing) await existing.deleteOne();
    else await LessonProgress.create({ userId: req.validated.params.userId, lessonId: lesson._id, courseId: lesson.courseId });
    const progress = await LessonProgress.find({ userId: req.validated.params.userId }).select('lessonId').lean();
    res.json({ completed_lessons: progress.map((item) => String(item.lessonId)) });
  }));

  r.get('/agent/guidelines/active/:id', authenticate(tokens), empty, asyncHandler(async (_req, res) => res.json([])));
  r.get('/agent/quizzes/completed/:id', authenticate(tokens), empty, asyncHandler(async (req, res) => {
    if (req.auth.role !== 'admin' && String(req.auth.userId) !== String(req.validated.params.id)) throw forbidden();
    const completed = await Submission.find({ studentId: req.validated.params.id, kind: 'assessment', attemptStatus: { $in: ['submitted', 'timed_out', 'finalized_due_date'] } }).lean();
    res.json({ completed_tasks: completed.map((item) => ({ task_id: String(item.assessmentId), score: item.grading?.score ?? null })) });
  }));

  return r;
}
