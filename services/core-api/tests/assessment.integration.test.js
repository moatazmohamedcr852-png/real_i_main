import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { User } from '../src/domains/auth/user.model.js';
import { Course } from '../src/domains/courses/course.model.js';
import { Enrollment } from '../src/domains/enrollments/enrollment.model.js';
import { Submission } from '../src/domains/submissions/submission.model.js';
import { Assessment } from '../src/domains/assessments/assessment.model.js';
import { assessmentRepository } from '../src/domains/assessments/assessment.repository.js';
import { createAssessmentService } from '../src/domains/assessments/assessment.service.js';
import { createCourseService } from '../src/domains/course-management/course.service.js';
import { courseRepository, enrollmentRepository, lessonRepository, withTransaction } from '../src/domains/course-management/course.repository.js';
import { createEnrollmentService } from '../src/domains/enrollments/enrollment.service.js';
import { enrollmentCourseRepository, enrollmentLifecycleRepository } from '../src/domains/enrollments/enrollment.repository.js';
import { Notification } from '../src/domains/notifications/notification.model.js';
import { notificationDispatcher } from '../src/domains/notifications/notification.service.js';

let mongo; let clock;
const models = [User, Course, Enrollment, Assessment, Submission, Notification];
let service;
before(async () => { mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(mongo.getUri(), { dbName: 'real_i_assessment_tests' }); await Promise.all(models.map((model) => model.syncIndexes())); });
beforeEach(async () => { await Promise.all(models.map((model) => model.deleteMany({}))); clock = new Date('2026-02-01T10:00:00Z'); service = createAssessmentService({ repo: assessmentRepository, now: () => new Date(clock), logger: { info() {}, error() {} }, transaction: withTransaction, notificationDispatcher }); });
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

async function fixture() {
  const [instructor, student, other] = await User.create([
    { name: 'Instructor', email: 'assessment-instructor@example.test', passwordHash: 'x'.repeat(60), role: 'instructor' },
    { name: 'Student', email: 'assessment-student@example.test', passwordHash: 'x'.repeat(60), role: 'student' },
    { name: 'Other', email: 'assessment-other@example.test', passwordHash: 'x'.repeat(60), role: 'student' }
  ]);
  const course = await Course.create({ title: 'Assessment course', description: 'Course', instructorId: instructor._id, status: 'published', publishedAt: clock });
  await Enrollment.create({ studentId: student._id, courseId: course._id });
  const assessment = await Assessment.create({ courseId: course._id, authorId: instructor._id, title: 'Quick check', status: 'published', publishedAt: clock, timeLimitSeconds: 60, randomizeQuestions: true, maxAttempts: 2, questions: [
    { id: 'mcq-1', type: 'mcq', prompt: '2 + 2?', options: [{ id: 'a', text: '4' }, { id: 'b', text: '5' }], correctOptionIds: ['a'], points: 50 },
    { id: 'tf-1', type: 'true_false', prompt: 'The sky is blue.', options: [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }], correctOptionIds: ['true'], points: 50 }
  ] });
  return { instructor: { userId: instructor._id, role: 'instructor' }, student: { userId: student._id, role: 'student' }, other: { userId: other._id, role: 'student' }, course, assessment };
}

test('assessment start locks randomization, autosave is idempotent, and MCQ grading is server-side', async () => {
  const { student, assessment } = await fixture();
  const started = await service.start(student, assessment._id);
  const reloaded = await service.start(student, assessment._id);
  assert.equal(reloaded.id, started.id);
  assert.deepEqual(reloaded.questions.map((question) => question.id), started.questions.map((question) => question.id));
  assert.equal(JSON.stringify(started).includes('correctOptionIds'), false);
  const answers = [{ questionId: 'mcq-1', value: 'a' }, { questionId: 'tf-1', value: 'true' }];
  await service.save(student, started.id, answers);
  const savedAgain = await service.save(student, started.id, answers);
  assert.deepEqual(savedAgain.responses.map((item) => item.toObject()), answers);
  const completed = await service.submit(student, started.id);
  assert.equal(completed.attemptStatus, 'submitted');
  assert.equal(completed.grading.status, 'auto_graded');
  assert.equal(completed.grading.score, 100);
  await assert.rejects(() => service.save(student, started.id, answers), { code: 'ATTEMPT_CLOSED' });
});

test('expired attempts are submitted by server time, and only course owner can rubric-grade essays', async () => {
  const { instructor, student, other, course, assessment } = await fixture();
  const timed = await service.start(student, assessment._id);
  clock = new Date(clock.getTime() + 61000);
  const expired = await service.getAttempt(student, timed.id);
  assert.equal(expired.attemptStatus, 'timed_out');
  await assert.rejects(() => service.save(student, timed.id, []), { code: 'ATTEMPT_CLOSED' });
  const essay = await Assessment.create({ courseId: course._id, authorId: instructor.userId, title: 'Essay', status: 'published', publishedAt: clock, timeLimitSeconds: 60, randomizeQuestions: false, questions: [{ id: 'essay-1', type: 'essay', prompt: 'Explain.', points: 10, rubric: [{ label: 'Reasoning', points: 10 }] }] });
  const attempt = await service.start(student, essay._id);
  await service.save(student, attempt.id, [{ questionId: 'essay-1', value: 'Private essay answer' }]);
  await service.submit(student, attempt.id);
  await assert.rejects(() => service.grade(student, attempt.id, { score: 10 }), { code: 'FORBIDDEN' });
  await assert.rejects(() => service.grade(other, attempt.id, { score: 10 }), { code: 'FORBIDDEN' });
  const graded = await service.grade(instructor, attempt.id, { score: 10, feedback: 'Strong reasoning.' });
  assert.equal(graded.grading.status, 'graded');
  assert.equal(graded.grading.score, 10);
  const notification = await Notification.findOne({ recipientId: student.userId, type: 'assessment_graded' }).lean();
  assert.equal(String(notification.payload.submissionId), String(attempt.id));
});

test('a due date cuts an attempt off with its own terminal status and blocks later starts', async () => {
  const { instructor, student, course } = await fixture();
  const deadline = new Date(clock.getTime() + 30_000);
  const assessment = await Assessment.create({ courseId: course._id, authorId: instructor.userId, title: 'Deadline check', status: 'published', publishedAt: clock, timeLimitSeconds: 60, randomizeQuestions: false, maxAttempts: 2, dueAt: deadline, questions: [{ id: 'mcq-1', type: 'mcq', prompt: '2 + 2?', options: [{ id: 'a', text: '4' }, { id: 'b', text: '5' }], correctOptionIds: ['a'], points: 1 }] });
  const attempt = await service.start(student, assessment._id);
  assert.equal(attempt.expiresAt.getTime(), deadline.getTime());
  clock = new Date(deadline.getTime() + 1);
  const finalized = await service.getAttempt(student, attempt.id);
  assert.equal(finalized.attemptStatus, 'finalized_due_date');
  const stored = await Submission.findById(attempt.id).select('+grading').lean();
  assert.equal(stored.finalizationReason, 'due_date');
  await assert.rejects(() => service.start(student, assessment._id), { code: 'ASSESSMENT_NOT_AVAILABLE' });
});

test('course archival cuts off an enrolled student from an active assessment attempt', async () => {
  const { instructor, student, course, assessment } = await fixture();
  const attempt = await service.start(student, assessment._id);
  const courseService = createCourseService({ courses: courseRepository, lessons: lessonRepository, enrollments: enrollmentRepository, transaction: withTransaction, finalizeEligibilityLoss: service.finalizeEligibilityLoss });
  await courseService.archive(instructor, course._id);
  const finalized = await Submission.findById(attempt.id).select('+grading').lean();
  assert.equal(finalized.attemptStatus, 'finalized_eligibility_lost');
  assert.equal(finalized.finalizationReason, 'eligibility_lost');
  assert.equal(finalized.grading.status, 'auto_graded');
  await assert.rejects(() => service.getAttempt(student, attempt.id), { code: 'FORBIDDEN' });
});

test('dropping enrollment immediately finalizes the student\'s in-progress assessment', async () => {
  const { student, course, assessment } = await fixture();
  const attempt = await service.start(student, assessment._id);
  const enrollment = await Enrollment.findOne({ studentId: student.userId, courseId: course._id });
  const enrollmentService = createEnrollmentService({ enrollments: enrollmentLifecycleRepository, courses: enrollmentCourseRepository, transaction: withTransaction, finalizeEligibilityLoss: service.finalizeEligibilityLoss });
  await enrollmentService.drop(student, enrollment._id);
  const finalized = await Submission.findById(attempt.id).select('+grading').lean();
  assert.equal(finalized.attemptStatus, 'finalized_eligibility_lost');
  assert.equal(finalized.finalizationReason, 'eligibility_lost');
  assert.equal(finalized.grading.status, 'auto_graded');
});
