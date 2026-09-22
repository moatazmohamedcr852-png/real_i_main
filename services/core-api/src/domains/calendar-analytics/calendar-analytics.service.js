import { AppError, forbidden } from '../../shared/errors.js';
import { CalendarEvent } from '../calendar/calendar-event.model.js';
import { safeErrorMetadata } from '../../shared/safe-error.js';

const asId = (value) => String(value);
export function createCalendarAnalyticsService({ repo, logger = { error() {} }, now = () => new Date() }) {
  const scope = async (actor) => {
    if (actor.role === 'admin') return { allCourses: true, courseIds: [] };
    if (actor.role === 'instructor') return { allCourses: false, courseIds: await repo.instructorCourseIds(actor.userId) };
    if (actor.role === 'student') return { allCourses: false, courseIds: await repo.studentCourseIds(actor.userId) };
    throw forbidden();
  };
  return {
    async calendar(actor, { from = now(), to = new Date(now().getTime() + 30 * 24 * 60 * 60 * 1000) } = {}) { if (new Date(to) < new Date(from) || new Date(to).getTime() - new Date(from).getTime() > 90 * 24 * 60 * 60 * 1000) throw new AppError(400, 'INVALID_CALENDAR_RANGE', 'Calendar range must be ordered and no more than 90 days.'); const access = await scope(actor); return repo.calendar({ ...access, from: new Date(from), to: new Date(to) }); },
    async createPlatformEvent(actor, input) { if (actor.role !== 'admin') throw forbidden(); return CalendarEvent.create({ ...input, createdBy: actor.userId }); },
    async metrics(actor, { from = new Date(now().getTime() - 30 * 24 * 60 * 60 * 1000), to = now() } = {}) { if (!['instructor', 'admin'].includes(actor.role)) throw forbidden(); try { return await repo.metrics({ ...(await scope(actor)), from: new Date(from), to: new Date(to) }); } catch (error) { logger.error({ ...safeErrorMetadata(error), event: 'kpi_computation_failed', actorRole: actor.role, actorId: asId(actor.userId) }, 'KPI computation failed'); throw error; } }
  };
}
