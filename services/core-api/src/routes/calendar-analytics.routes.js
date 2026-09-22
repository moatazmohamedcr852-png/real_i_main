import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../shared/async-handler.js';
import { analyticsLimit, calendarReadLimit, notificationMutationLimit } from '../middleware/rate-limits.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const eventInput = z.object({ scope: z.enum(['global', 'course']).optional(), courseId: objectId.nullable().optional(), title: z.string().trim().min(1).max(200), description: z.string().max(5000).optional(), startsAt: z.coerce.date(), endsAt: z.coerce.date().nullable().optional() }).strict();
const calendarQuery = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });
const metricsQuery = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });
const wrap = (body, params = z.object({}), query = z.object({})) => validate(z.object({ body, params, query }));

export function calendarAnalyticsRoutes({ calendarAnalyticsService, notificationService, tokens }) {
  const r = Router();
  r.get('/calendar', authenticate(tokens), calendarReadLimit, wrap(z.object({}), z.object({}), calendarQuery), asyncHandler(async (req, res) => res.json(await calendarAnalyticsService.calendar(req.auth, req.validated.query))));
  r.post('/calendar/events', authenticate(tokens), requireRoles('admin'), wrap(eventInput), asyncHandler(async (req, res) => res.status(201).json(await calendarAnalyticsService.createPlatformEvent(req.auth, req.validated.body))));
  r.get('/analytics/kpis', authenticate(tokens), requireRoles('instructor', 'admin'), analyticsLimit, wrap(z.object({}), z.object({}), metricsQuery), asyncHandler(async (req, res) => res.json(await calendarAnalyticsService.metrics(req.auth, req.validated.query))));
  r.get('/notifications', authenticate(tokens), wrap(z.object({}), z.object({}), z.object({ unreadOnly: z.enum(['true', 'false']).transform((value) => value === 'true').optional(), limit: z.coerce.number().int().min(1).max(50).optional() })), asyncHandler(async (req, res) => res.json(await notificationService.list(req.auth, req.validated.query))));
  r.post('/notifications/:notificationId/read', authenticate(tokens), notificationMutationLimit, wrap(z.object({}), z.object({ notificationId: objectId })), asyncHandler(async (req, res) => res.json(await notificationService.markRead(req.auth, req.validated.params.notificationId))));
  return r;
}
