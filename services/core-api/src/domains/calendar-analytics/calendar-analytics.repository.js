import { Course } from '../courses/course.model.js';
import { Enrollment } from '../enrollments/enrollment.model.js';
import { Assessment } from '../assessments/assessment.model.js';
import { LiveSession } from '../live-sessions/live-session.model.js';
import { CalendarEvent } from '../calendar/calendar-event.model.js';
import { Submission } from '../submissions/submission.model.js';

export const calendarAnalyticsRepository = {
  instructorCourseIds: async (instructorId) => (await Course.find({ instructorId }).select('_id').lean()).map((item) => item._id),
  studentCourseIds: async (studentId) => {
    const enrolled = await Enrollment.find({ studentId, status: 'enrolled' }).select('courseId').lean();
    const allowed = await Course.find({ _id: { $in: enrolled.map((item) => item.courseId) }, status: 'published' }).select('_id').lean();
    return allowed.map((item) => item._id);
  },
  async calendar({ courseIds, from, to, allCourses }) {
    const courseMatch = allCourses ? {} : { courseId: { $in: courseIds } };
    const [assessments, sessions, events] = await Promise.all([
      Assessment.find({ ...courseMatch, status: 'published', dueAt: { $gte: from, $lte: to } }).select('courseId title dueAt').lean(),
      LiveSession.find({ ...courseMatch, status: { $in: ['scheduled', 'live'] }, startsAt: { $lte: to }, endsAt: { $gte: from } }).select('courseId title startsAt endsAt status').lean(),
      CalendarEvent.find({
        status: 'active',
        $or: [
          { startsAt: { $gte: from, $lte: to } },
          { startsAt: { $lt: from }, endsAt: { $gte: from } }
        ],
        $and: [{ $or: [{ scope: 'global' }, ...(allCourses ? [{ scope: 'course' }] : [{ scope: 'course', courseId: { $in: courseIds } }])] }]
      }).select('+description').lean()
    ]);
    return [
      ...assessments.map((item) => ({ id: String(item._id), type: 'assessment_deadline', courseId: String(item.courseId), title: item.title, startsAt: item.dueAt, endsAt: item.dueAt })),
      ...sessions.map((item) => ({ id: String(item._id), type: 'live_session', courseId: String(item.courseId), title: item.title, startsAt: item.startsAt, endsAt: item.endsAt, status: item.status })),
      ...events.map((item) => ({ id: String(item._id), type: 'platform_event', courseId: item.courseId ? String(item.courseId) : null, title: item.title, description: item.description, startsAt: item.startsAt, endsAt: item.endsAt }))
    ].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  },
  async metrics({ courseIds, allCourses, from, to }) {
    const courseMatch = allCourses ? {} : { courseId: { $in: courseIds } };
    const [activeLearners, lifecycle, scores, trend] = await Promise.all([
      Enrollment.distinct('studentId', { ...courseMatch, status: 'enrolled' }),
      Enrollment.aggregate([{ $match: { ...courseMatch, status: { $in: ['enrolled', 'completed'] } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Submission.aggregate([{ $match: { ...courseMatch, kind: 'assessment', 'grading.status': { $in: ['auto_graded', 'graded'] }, 'grading.score': { $ne: null } } }, { $group: { _id: null, average: { $avg: '$grading.score' }, count: { $sum: 1 } } }]),
      Enrollment.aggregate([{ $match: { ...courseMatch, enrolledAt: { $gte: from, $lte: to } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$enrolledAt', timezone: 'UTC' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }])
    ]);
    const enrolled = lifecycle.find((item) => item._id === 'enrolled')?.count ?? 0;
    const completed = lifecycle.find((item) => item._id === 'completed')?.count ?? 0;
    return { activeLearners: activeLearners.length, completionRate: { completed, eligible: enrolled + completed, percentage: enrolled + completed ? Math.round((completed / (enrolled + completed)) * 10000) / 100 : 0 }, averageAssessmentScore: { value: scores[0]?.average ?? null, gradedAttempts: scores[0]?.count ?? 0 }, enrollmentTrend: trend.map((item) => ({ date: item._id, enrollments: item.count })), revenue: { notAvailable: true, reason: 'No payment or transaction ledger exists.' } };
  }
};
