import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { User } from '../src/domains/auth/user.model.js';
import { Course } from '../src/domains/courses/course.model.js';
import { Lesson } from '../src/domains/lessons/lesson.model.js';
import { Submission } from '../src/domains/submissions/submission.model.js';
import { LiveSession } from '../src/domains/live-sessions/live-session.model.js';
import { Poll } from '../src/domains/polls/poll.model.js';
import { AIGuideline } from '../src/domains/ai-guidelines/ai-guideline.model.js';
import { Enrollment } from '../src/domains/enrollments/enrollment.model.js';
import { PollResponse } from '../src/domains/poll-responses/poll-response.model.js';
import { seedLearningFixture } from './fixtures/learning.fixture.js';

const models = [User, Course, Lesson, Submission, LiveSession, Poll, Enrollment, PollResponse, AIGuideline];
let mongo;

before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri(), { dbName: 'real_i_schema_tests' });
  await Promise.all(models.map((model) => model.syncIndexes()));
});

beforeEach(async () => {
  await Promise.all(models.map((model) => model.deleteMany({})));
});

after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test('required fields, ObjectIds, and model invariants are validated', async () => {
  await assert.rejects(() => Course.create({ description: 'No instructor or title.' }), mongoose.Error.ValidationError);
  await assert.rejects(() => Lesson.create({ courseId: 'not-an-object-id', title: 'Bad', content: 'Bad', position: 1 }), mongoose.Error.ValidationError);
  const { instructor, course, lesson, liveSession } = await seedLearningFixture();
  await assert.rejects(() => Poll.create({ sessionId: liveSession._id, courseId: course._id, createdBy: instructor._id, question: 'Invalid choices', responseType: 'single_choice', options: [{ key: 'a', label: 'A' }] }), mongoose.Error.ValidationError);
  await assert.rejects(() => AIGuideline.create({ scope: 'course', version: 2, content: 'Missing course scope reference.', createdBy: instructor._id }), mongoose.Error.ValidationError);
  const studentSubmission = new Submission({ studentId: instructor._id, courseId: course._id, lessonId: lesson._id, attemptNumber: 2, submissionType: 'essay', responses: [{ questionId: 'essay', value: 'Sensitive learner essay.' }], grading: { status: 'graded', score: 100 } });
  studentSubmission.$locals.actorRole = 'student';
  await assert.rejects(() => studentSubmission.validate(), mongoose.Error.ValidationError);
});

test('named unique indexes reject duplicate lesson positions and submission attempts', async () => {
  const { student, course, lesson } = await seedLearningFixture();
  await assert.rejects(() => Lesson.create({ courseId: course._id, title: 'Duplicate position', content: 'Content', position: 1 }), { code: 11000 });
  await assert.rejects(() => Submission.create({ studentId: student._id, courseId: course._id, lessonId: lesson._id, attemptNumber: 1, submissionType: 'mcq', responses: [{ questionId: 'q-2', value: 'a' }] }), { code: 11000 });
});

test('student course history uses the student/course/submitted compound index', async () => {
  const { student, course, lesson } = await seedLearningFixture();
  await Submission.create({ studentId: student._id, courseId: course._id, lessonId: lesson._id, attemptNumber: 2, submissionType: 'short_answer', responses: [{ questionId: 'q-2', value: 'A later attempt.' }], submittedAt: new Date('2026-02-02') });
  const plan = await Submission.find({ studentId: student._id, courseId: course._id }).sort({ submittedAt: -1 }).explain('queryPlanner');
  assert.match(JSON.stringify(plan.queryPlanner.winningPlan), /submission_student_course_submitted/);
});

test('enrollment ownership and poll-response shape are validated at the model layer', async () => {
  const { student, course, poll, liveSession } = await seedLearningFixture();
  await assert.rejects(() => Enrollment.create({ courseId: course._id }), mongoose.Error.ValidationError);
  const otherStudentEnrollment = new Enrollment({ studentId: new mongoose.Types.ObjectId(), courseId: course._id });
  otherStudentEnrollment.$locals = { actorRole: 'student', actorUserId: student._id };
  await assert.rejects(() => otherStudentEnrollment.validate(), mongoose.Error.ValidationError);
  await assert.rejects(() => PollResponse.create({ pollId: poll._id, sessionId: liveSession._id, courseId: course._id, studentId: student._id }), mongoose.Error.ValidationError);
  const impersonatedVote = new PollResponse({ pollId: poll._id, sessionId: liveSession._id, courseId: course._id, studentId: new mongoose.Types.ObjectId(), optionKeys: ['yes'] });
  impersonatedVote.$locals = { actorRole: 'student', actorUserId: student._id };
  await assert.rejects(() => impersonatedVote.validate(), mongoose.Error.ValidationError);
});

test('partial enrollment and poll-response uniqueness reject duplicate active records', async () => {
  const { student, course, poll, liveSession } = await seedLearningFixture();
  await assert.rejects(() => Enrollment.create({ studentId: student._id, courseId: course._id }), { code: 11000 });
  await assert.rejects(() => PollResponse.create({ pollId: poll._id, sessionId: liveSession._id, courseId: course._id, studentId: student._id, optionKeys: ['no'] }), { code: 11000 });
});

test('poll option tally lookup uses the poll/option compound index', async () => {
  const { instructor, course, poll, liveSession } = await seedLearningFixture();
  await PollResponse.create({ pollId: poll._id, sessionId: liveSession._id, courseId: course._id, studentId: instructor._id, optionKeys: ['yes'] });
  const plan = await PollResponse.find({ pollId: poll._id, optionKeys: 'yes' }).explain('queryPlanner');
  assert.match(JSON.stringify(plan.queryPlanner.winningPlan), /poll_response_tally_by_option/);
});
