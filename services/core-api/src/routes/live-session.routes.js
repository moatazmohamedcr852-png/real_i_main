import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../shared/async-handler.js';
import { pollVoteLimit } from '../middleware/rate-limits.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const sessionInput = z.object({ courseId: objectId, title: z.string().trim().min(1).max(200), providerRoomId: z.string().trim().min(8).max(200), startsAt: z.coerce.date(), endsAt: z.coerce.date(), hostId: objectId.optional() }).strict();
const pollInput = z.object({ question: z.string().trim().min(1).max(2000), responseType: z.enum(['single_choice', 'multiple_choice', 'free_text']), options: z.array(z.object({ key: z.string().trim().min(1).max(64), label: z.string().trim().min(1).max(500) }).strict()).max(10).optional(), status: z.enum(['draft', 'open']).optional(), closesAt: z.coerce.date().optional() }).strict();
const responseInput = z.object({ optionKeys: z.array(z.string().min(1).max(64)).max(10).optional(), responseText: z.string().trim().min(1).max(5000).optional() }).strict();
const wrap = (body) => validate(z.object({ body, params: z.object({ sessionId: objectId.optional(), pollId: objectId.optional() }), query: z.object({ status: z.string().max(40).optional(), courseId: objectId.optional(), seriesId: z.string().optional() }) }));

export function liveSessionRoutes({ service, tokens }) {
  const r = Router();
  r.get('/', authenticate(tokens), wrap(z.object({})), asyncHandler(async (req, res) => res.json(await service.list(req.auth, req.query))));
  r.post('/', authenticate(tokens), requireRoles('instructor', 'admin'), wrap(sessionInput), asyncHandler(async (req, res) => res.status(201).json(await service.createSession(req.auth, req.validated.body))));
  r.post('/:sessionId/join-token', authenticate(tokens), wrap(z.object({})), asyncHandler(async (req, res) => res.json(await service.issueJoinToken(req.auth, req.validated.params.sessionId))));
  r.post('/:sessionId/attendance/join', authenticate(tokens), requireRoles('student'), wrap(z.object({})), asyncHandler(async (req, res) => res.json(await service.recordJoin(req.auth, req.validated.params.sessionId))));
  r.post('/:sessionId/attendance/leave', authenticate(tokens), requireRoles('student'), wrap(z.object({})), asyncHandler(async (req, res) => res.json(await service.recordLeave(req.auth, req.validated.params.sessionId))));
  r.get('/:sessionId/attendance', authenticate(tokens), requireRoles('instructor', 'admin'), wrap(z.object({})), asyncHandler(async (req, res) => res.json(await service.attendance(req.auth, req.validated.params.sessionId))));
  r.post('/:sessionId/polls', authenticate(tokens), requireRoles('instructor', 'admin'), wrap(pollInput), asyncHandler(async (req, res) => res.status(201).json(await service.createPoll(req.auth, req.validated.params.sessionId, req.validated.body))));
  r.post('/:sessionId/polls/:pollId/votes', authenticate(tokens), requireRoles('student'), pollVoteLimit, wrap(responseInput), asyncHandler(async (req, res) => res.status(201).json(await service.vote(req.auth, req.validated.params.sessionId, req.validated.params.pollId, req.validated.body))));
  r.get('/:sessionId/polls/:pollId/tally', authenticate(tokens), wrap(z.object({})), asyncHandler(async (req, res) => res.json(await service.tally(req.auth, req.validated.params.sessionId, req.validated.params.pollId))));
  return r;
}
