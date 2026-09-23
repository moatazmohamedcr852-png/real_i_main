import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AppError, forbidden } from '../../shared/errors.js';
import { calculatePresence } from '../attendance/attendance.service.js';

const id = (value) => String(value);
const moderator = (actor, session) => actor.role === 'admin' || id(actor.userId) === id(session.hostId);

export function createVirtualClassroomService({ repo, transaction, config, logger = { info() {}, warn() {} }, now = () => new Date() }) {
  const courseOwner = async (actor, courseId) => { const course = await repo.course(courseId); if (!course) throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.'); if (actor.role !== 'admin' && id(course.instructorId) !== id(actor.userId)) throw forbidden(); return course; };
  const sessionAccess = async (actor, sessionId) => {
    const session = await repo.session(sessionId);
    if (!session || ['cancelled', 'ended'].includes(session.status) || new Date(session.endsAt) <= now()) throw new AppError(404, 'SESSION_NOT_AVAILABLE', 'Live session is not available.');
    const course = await repo.course(session.courseId);
    if (!course || course.status !== 'published') throw forbidden();
    if (moderator(actor, session)) return session;
    if (actor.role !== 'student' || !await repo.activeEnrollment(actor.userId, session.courseId)) throw forbidden();
    return session;
  };
  const studentAccess = async (actor, sessionId) => { const session = await sessionAccess(actor, sessionId); if (actor.role !== 'student') throw forbidden(); return session; };
  return {
    async list(actor, query = {}) {
      const filter = {};
      if (query.courseId) filter.courseId = query.courseId;
      if (query.status) filter.status = query.status;
      if (actor.role === 'student') {
        const enrolled = await repo.enrolledCourseIds(actor.userId);
        filter.courseId = filter.courseId || { $in: enrolled };
      } else if (actor.role === 'instructor') {
        filter.hostId = actor.userId;
      }
      const sessions = await repo.listSessions(filter);
      return {
        success: true,
        meetings: sessions.map((session) => ({
          id: id(session._id),
          meetingId: id(session._id),
          sessionId: id(session._id),
          title: session.title,
          status: session.status,
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          courseId: id(session.courseId),
          hostId: id(session.hostId),
          roomSlug: session.providerRoomId,
          providerRoomId: session.providerRoomId
        }))
      };
    },
    async createSession(actor, input) {
      await courseOwner(actor, input.courseId);
      if (new Date(input.endsAt) <= new Date(input.startsAt)) throw new AppError(400, 'INVALID_SESSION_TIME', 'Session end must be after its start.');
      try { return await repo.createSession({ ...input, hostId: actor.role === 'admin' && input.hostId ? input.hostId : actor.userId }); } catch (error) { if (error?.code === 11000) throw new AppError(409, 'ROOM_ID_CONFLICT', 'A session already uses this room ID.'); throw error; }
    },
    async issueJoinToken(actor, sessionId) {
      const session = await sessionAccess(actor, sessionId);
      const user = await repo.user(actor.userId);
      if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
      const expiresAt = new Date(Math.min(new Date(session.endsAt).getTime(), now().getTime() + 5 * 60 * 1000));
      if (expiresAt <= now()) throw new AppError(409, 'SESSION_ENDED', 'This session has ended.');
      const isModerator = moderator(actor, session);
      const issuedAtSeconds = Math.floor(now().getTime() / 1000);
      const token = jwt.sign({ iat: issuedAtSeconds, aud: config.JITSI_APP_ID, iss: config.JITSI_APP_ID, sub: config.JITSI_DOMAIN, room: session.providerRoomId, sessionId: id(session._id), courseId: id(session.courseId), jti: crypto.randomUUID(), context: { user: { id: id(user._id), name: user.name, moderator: isModerator } } }, config.JITSI_JWT_SECRET, { algorithm: 'HS256', expiresIn: Math.max(1, Math.floor((expiresAt.getTime() - now().getTime()) / 1000)) });
      logger.info({ event: 'jitsi_join_token_issued', sessionId: id(session._id), courseId: id(session.courseId), userId: id(actor.userId), moderator: isModerator, expiresAt }, 'Jitsi join token issued');
      const meeting = {
        id: id(session._id),
        meetingId: id(session._id),
        sessionId: id(session._id),
        title: session.title,
        status: session.status,
        startsAt: session.startsAt,
        starts_at: session.startsAt,
        endsAt: session.endsAt,
        ends_at: session.endsAt,
        courseId: id(session.courseId),
        hostId: id(session.hostId),
        roomSlug: session.providerRoomId,
        roomName: session.providerRoomId,
        providerRoomId: session.providerRoomId,
        lobbyEnabled: true,
        security: { muteOnEntry: true, requireHostToStart: true, disableStudentScreenShare: false }
      };
      return {
        success: true,
        authorized: true,
        waitingForHost: false,
        isHost: isModerator,
        moderator: isModerator,
        user: { id: id(user._id), name: user.name, email: user.email, role: user.role },
        meeting,
        token,
        joinToken: token,
        room: session.providerRoomId,
        roomName: session.providerRoomId,
        expiresAt,
        roomSlug: session.providerRoomId
      };
    },
    async recordJoin(actor, sessionId) { const session = await studentAccess(actor, sessionId); const record = await repo.joinAttendance({ sessionId: session._id, courseId: session.courseId, studentId: actor.userId, at: now() }); logger.info({ event: 'attendance_join_recorded', sessionId: id(session._id), userId: id(actor.userId) }, 'Attendance join recorded'); return calculatePresence(record, session, now()); },
    async recordLeave(actor, sessionId) { const liveSession = await studentAccess(actor, sessionId); const record = await transaction((session) => repo.leaveAttendance({ sessionId: liveSession._id, studentId: actor.userId, at: now(), session })); logger.info({ event: 'attendance_leave_recorded', sessionId: id(liveSession._id), userId: id(actor.userId) }, 'Attendance leave recorded'); return record ? calculatePresence(record, liveSession, now()) : { totalSeconds: 0, sessionDurationSeconds: Math.floor((new Date(liveSession.endsAt) - new Date(liveSession.startsAt)) / 1000), presencePercentage: 0 }; },
    async attendance(actor, sessionId) { const session = await sessionAccess(actor, sessionId); if (!moderator(actor, session)) throw forbidden(); return (await repo.attendanceForSession(session._id)).map((record) => ({ studentId: id(record.studentId), ...calculatePresence(record, session, now()), active: Boolean(record.activeJoinedAt) })); },
    async createPoll(actor, sessionId, input) { const session = await repo.session(sessionId); if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Live session not found.'); if (!moderator(actor, session)) throw forbidden(); const status = input.status ?? 'draft'; return repo.createPoll({ ...input, sessionId: session._id, courseId: session.courseId, createdBy: actor.userId, status, ...(status === 'open' ? { opensAt: now() } : {}) }); },
    async vote(actor, sessionId, pollId, input) { const session = await studentAccess(actor, sessionId); const poll = await repo.poll(pollId); if (!poll || id(poll.sessionId) !== id(session._id) || poll.status !== 'open' || (poll.closesAt && new Date(poll.closesAt) <= now())) throw new AppError(404, 'POLL_NOT_OPEN', 'Poll is not open.'); if (poll.responseType === 'free_text') { if (!input.responseText || input.optionKeys?.length) throw new AppError(400, 'INVALID_POLL_RESPONSE', 'This poll requires a text response.'); } else { const options = new Set(poll.options.map((option) => option.key)); if (!input.optionKeys?.length || input.optionKeys.some((key) => !options.has(key)) || (poll.responseType === 'single_choice' && input.optionKeys.length !== 1)) throw new AppError(400, 'INVALID_POLL_RESPONSE', 'Response does not match this poll.'); }
      try { return await repo.createVote({ pollId: poll._id, sessionId: session._id, courseId: session.courseId, studentId: actor.userId, optionKeys: input.optionKeys, responseText: input.responseText ?? null }); } catch (error) { if (error?.code === 11000) throw new AppError(409, 'VOTE_ALREADY_RECORDED', 'You have already voted on this poll.'); throw error; }
    },
    async tally(actor, sessionId, pollId) { const session = await sessionAccess(actor, sessionId); const poll = await repo.poll(pollId); if (!poll || id(poll.sessionId) !== id(session._id)) throw new AppError(404, 'POLL_NOT_FOUND', 'Poll not found.'); const counts = await repo.tally(pollId); return { pollId: id(poll._id), totalResponses: counts.reduce((sum, item) => sum + item.count, 0), options: poll.options.map((option) => ({ key: option.key, label: option.label, count: counts.find((item) => item._id === option.key)?.count ?? 0 })) }; }
  };
}
