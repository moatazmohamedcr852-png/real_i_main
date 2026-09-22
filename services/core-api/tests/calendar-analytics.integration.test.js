import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { User } from '../src/domains/auth/user.model.js';
import { Course } from '../src/domains/courses/course.model.js';
import { Enrollment } from '../src/domains/enrollments/enrollment.model.js';
import { Assessment } from '../src/domains/assessments/assessment.model.js';
import { Submission } from '../src/domains/submissions/submission.model.js';
import { LiveSession } from '../src/domains/live-sessions/live-session.model.js';
import { CalendarEvent } from '../src/domains/calendar/calendar-event.model.js';
import { Notification } from '../src/domains/notifications/notification.model.js';
import { calendarAnalyticsRepository } from '../src/domains/calendar-analytics/calendar-analytics.repository.js';
import { createCalendarAnalyticsService } from '../src/domains/calendar-analytics/calendar-analytics.service.js';
import { createNotificationService } from '../src/domains/notifications/notification.service.js';

let mongo;
let calendarService;
let notificationService;
const models = [User, Course, Enrollment, Assessment, Submission, LiveSession, CalendarEvent, Notification];
const from = new Date('2026-05-01T00:00:00.000Z');
const to = new Date('2026-05-31T23:59:59.999Z');

before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri(), { dbName: 'real_i_calendar_analytics_tests' });
  await Promise.all(models.map((model) => model.syncIndexes()));
});
beforeEach(async () => {
  await Promise.all(models.map((model) => model.deleteMany({})));
  calendarService = createCalendarAnalyticsService({ repo: calendarAnalyticsRepository, now: () => new Date('2026-05-10T12:00:00.000Z'), logger: { error() {} } });
  notificationService = createNotificationService({ logger: { error() {} } });
});
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

async function fixture() {
  const [instructor, otherInstructor, student, completedStudent, outsider, admin] = await User.create([
    { name: 'Instructor', email: 'calendar-instructor@example.test', passwordHash: 'x'.repeat(60), role: 'instructor' },
    { name: 'Other instructor', email: 'calendar-other-instructor@example.test', passwordHash: 'x'.repeat(60), role: 'instructor' },
    { name: 'Student', email: 'calendar-student@example.test', passwordHash: 'x'.repeat(60), role: 'student' },
    { name: 'Completed student', email: 'calendar-completed@example.test', passwordHash: 'x'.repeat(60), role: 'student' },
    { name: 'Outsider', email: 'calendar-outsider@example.test', passwordHash: 'x'.repeat(60), role: 'student' },
    { name: 'Admin', email: 'calendar-admin@example.test', passwordHash: 'x'.repeat(60), role: 'admin' }
  ]);
  const [course, otherCourse] = await Course.create([
    { title: 'Visible course', description: 'Course one', instructorId: instructor._id, status: 'published', publishedAt: from },
    { title: 'Other course', description: 'Course two', instructorId: otherInstructor._id, status: 'published', publishedAt: from }
  ]);
  await Enrollment.create([
    { studentId: student._id, courseId: course._id, status: 'enrolled', enrolledAt: new Date('2026-05-02T09:00:00.000Z') },
    { studentId: completedStudent._id, courseId: course._id, status: 'completed', enrolledAt: new Date('2026-05-03T09:00:00.000Z'), completedAt: new Date('2026-05-09T09:00:00.000Z') }
  ]);
  const question = { id: 'q1', type: 'mcq', prompt: 'One?', options: [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }], correctOptionIds: ['yes'], points: 1 };
  const [assessment, otherAssessment] = await Assessment.create([
    { courseId: course._id, authorId: instructor._id, title: 'Deadline one', status: 'published', publishedAt: from, timeLimitSeconds: 600, questions: [question], dueAt: new Date('2026-05-20T12:00:00.000Z') },
    { courseId: otherCourse._id, authorId: otherInstructor._id, title: 'Deadline two', status: 'published', publishedAt: from, timeLimitSeconds: 600, questions: [question], dueAt: new Date('2026-05-21T12:00:00.000Z') }
  ]);
  const snapshot = [{ ...question }];
  await Submission.create([
    { studentId: student._id, courseId: course._id, assessmentId: assessment._id, kind: 'assessment', attemptNumber: 1, submissionType: 'mcq', startedAt: new Date('2026-05-04T09:00:00.000Z'), expiresAt: new Date('2026-05-04T09:10:00.000Z'), expirationReason: 'time_limit', attemptStatus: 'submitted', finalizationReason: 'manual_submit', questionOrder: ['q1'], questionSnapshot: snapshot, submittedAt: new Date('2026-05-04T09:05:00.000Z'), grading: { status: 'auto_graded', score: 80, gradedAt: new Date('2026-05-04T09:05:00.000Z') } },
    { studentId: completedStudent._id, courseId: course._id, assessmentId: assessment._id, kind: 'assessment', attemptNumber: 1, submissionType: 'mcq', startedAt: new Date('2026-05-05T09:00:00.000Z'), expiresAt: new Date('2026-05-05T09:10:00.000Z'), expirationReason: 'time_limit', attemptStatus: 'submitted', finalizationReason: 'manual_submit', questionOrder: ['q1'], questionSnapshot: snapshot, submittedAt: new Date('2026-05-05T09:05:00.000Z'), grading: { status: 'auto_graded', score: 100, gradedAt: new Date('2026-05-05T09:05:00.000Z') } }
  ]);
  await LiveSession.create([
    { courseId: course._id, hostId: instructor._id, providerRoomId: 'calendar-room-one', title: 'Visible session', startsAt: new Date('2026-05-15T10:00:00.000Z'), endsAt: new Date('2026-05-15T11:00:00.000Z') },
    { courseId: otherCourse._id, hostId: otherInstructor._id, providerRoomId: 'calendar-room-two', title: 'Other session', startsAt: new Date('2026-05-16T10:00:00.000Z'), endsAt: new Date('2026-05-16T11:00:00.000Z') }
  ]);
  await CalendarEvent.create([
    { scope: 'global', title: 'Platform maintenance', description: 'Public schedule notice', startsAt: new Date('2026-05-12T08:00:00.000Z'), createdBy: admin._id },
    { scope: 'course', courseId: course._id, title: 'Visible course event', startsAt: new Date('2026-05-13T08:00:00.000Z'), createdBy: admin._id },
    { scope: 'course', courseId: otherCourse._id, title: 'Other course event', startsAt: new Date('2026-05-14T08:00:00.000Z'), createdBy: admin._id }
  ]);
  return {
    course,
    otherCourse,
    instructor: { userId: instructor._id, role: 'instructor' },
    otherInstructor: { userId: otherInstructor._id, role: 'instructor' },
    student: { userId: student._id, role: 'student' },
    completedStudent: { userId: completedStudent._id, role: 'student' },
    outsider: { userId: outsider._id, role: 'student' },
    admin: { userId: admin._id, role: 'admin' }
  };
}

test('calendar applies student enrollment, instructor ownership, and admin-all scopes without leaks', async () => {
  const { student, instructor, otherInstructor, admin } = await fixture();
  const visibleTitles = (items) => items.map((item) => item.title).sort();
  assert.deepEqual(visibleTitles(await calendarService.calendar(student, { from, to })), ['Deadline one', 'Platform maintenance', 'Visible course event', 'Visible session']);
  assert.deepEqual(visibleTitles(await calendarService.calendar(instructor, { from, to })), ['Deadline one', 'Platform maintenance', 'Visible course event', 'Visible session']);
  assert.deepEqual(visibleTitles(await calendarService.calendar(otherInstructor, { from, to })), ['Deadline two', 'Other course event', 'Other session', 'Platform maintenance']);
  assert.deepEqual(visibleTitles(await calendarService.calendar(admin, { from, to })), ['Deadline one', 'Deadline two', 'Other course event', 'Other session', 'Platform maintenance', 'Visible course event', 'Visible session']);
});

test('notifications are recipient-scoped, durable, and enforce their deduplication index', async () => {
  const { student, outsider, course } = await fixture();
  const notification = await notificationService.createSystem(student.userId, { courseId: course._id });
  await notificationService.createSystem(outsider.userId, { courseId: course._id });
  const mine = await notificationService.list(student);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, String(notification._id));
  assert.equal((await notificationService.list(outsider))[0].id === mine[0].id, false);
  await assert.rejects(() => notificationService.markRead(outsider, notification._id), { code: 'NOTIFICATION_NOT_FOUND' });
  assert.ok((await notificationService.markRead(student, notification._id)).readAt);
  await assert.rejects(() => Notification.create({ recipientId: student.userId, type: 'system', payload: {}, deduplicationKey: 'once' }).then(() => Notification.create({ recipientId: student.userId, type: 'system', payload: {}, deduplicationKey: 'once' })), (error) => error?.code === 11000);
});

test('KPI aggregations return exact scoped values and keep revenue unavailable', async () => {
  const { course, instructor, otherInstructor, student, admin } = await fixture();
  const metrics = await calendarService.metrics(instructor, { from, to });
  assert.equal(metrics.activeLearners, 1);
  assert.deepEqual(metrics.completionRate, { completed: 1, eligible: 2, percentage: 50 });
  assert.deepEqual(metrics.averageAssessmentScore, { value: 90, gradedAttempts: 2 });
  assert.deepEqual(metrics.enrollmentTrend, [{ date: '2026-05-02', enrollments: 1 }, { date: '2026-05-03', enrollments: 1 }]);
  assert.deepEqual(metrics.revenue, { notAvailable: true, reason: 'No payment or transaction ledger exists.' });
  const otherMetrics = await calendarService.metrics(otherInstructor, { from, to });
  assert.deepEqual(otherMetrics, { activeLearners: 0, completionRate: { completed: 0, eligible: 0, percentage: 0 }, averageAssessmentScore: { value: null, gradedAttempts: 0 }, enrollmentTrend: [], revenue: { notAvailable: true, reason: 'No payment or transaction ledger exists.' } });
  assert.equal((await calendarService.metrics(admin, { from, to })).activeLearners, 1);
  await assert.rejects(() => calendarService.metrics(student, { from, to }), { code: 'FORBIDDEN' });
  const plan = await Enrollment.find({ courseId: course._id, status: 'enrolled' }).sort({ enrolledAt: -1 }).hint('enrollment_course_status_enrolled').explain('queryPlanner');
  assert.match(JSON.stringify(plan), /enrollment_course_status_enrolled/);
});

test('calendar and notification schemas reject invalid persistent shapes', async () => {
  const { admin } = await fixture();
  await assert.rejects(() => CalendarEvent.create({ scope: 'global', title: 'Bad event', startsAt: new Date('2026-05-12T10:00:00.000Z'), endsAt: new Date('2026-05-12T09:00:00.000Z'), createdBy: admin.userId }), mongoose.Error.ValidationError);
  await assert.rejects(() => CalendarEvent.create({ scope: 'course', courseId: new mongoose.Types.ObjectId(), title: 'Orphaned event', startsAt: new Date('2026-05-12T10:00:00.000Z'), createdBy: admin.userId }), mongoose.Error.ValidationError);
  await assert.rejects(() => Notification.create({ type: 'system', payload: {} }), mongoose.Error.ValidationError);
});
