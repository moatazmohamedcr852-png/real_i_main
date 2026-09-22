import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { User } from '../src/domains/auth/user.model.js';
import { Course } from '../src/domains/courses/course.model.js';
import { Lesson } from '../src/domains/lessons/lesson.model.js';
import { Enrollment } from '../src/domains/enrollments/enrollment.model.js';
import { createCourseService } from '../src/domains/course-management/course.service.js';
import { courseRepository, enrollmentRepository, lessonRepository, withTransaction } from '../src/domains/course-management/course.repository.js';

let mongo;
const models = [User, Course, Lesson, Enrollment];
const service = createCourseService({ courses: courseRepository, lessons: lessonRepository, enrollments: enrollmentRepository, transaction: withTransaction });

before(async () => { mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(mongo.getUri(), { dbName: 'real_i_course_routes' }); await Promise.all(models.map((model) => model.syncIndexes())); });
beforeEach(async () => { await Promise.all(models.map((model) => model.deleteMany({}))); });
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

async function actors() {
  const [owner, other, student] = await User.create([
    { name: 'Owner', email: 'owner-course@example.test', passwordHash: 'x'.repeat(60), role: 'instructor' },
    { name: 'Other', email: 'other-course@example.test', passwordHash: 'x'.repeat(60), role: 'instructor' },
    { name: 'Student', email: 'student-course@example.test', passwordHash: 'x'.repeat(60), role: 'student' }
  ]);
  return { owner: { userId: owner._id, role: 'instructor' }, other: { userId: other._id, role: 'instructor' }, student: { userId: student._id, role: 'student' }, admin: { userId: new mongoose.Types.ObjectId(), role: 'admin' } };
}

test('CRUD, ownership, enrollment gates, draft privacy, and transactional ordering hold against Mongo', async () => {
  const { owner, other, student, admin } = await actors();
  const created = await service.create(owner, { title: 'Private course', description: 'Draft material', category: 'math', difficulty: 'beginner', pricing: { access: 'free' } });
  assert.equal(created.status, 'draft');
  assert.equal((await service.listPublic({})).length, 0);
  await assert.rejects(() => service.get(null, created.id), { code: 'COURSE_NOT_FOUND' });
  await assert.rejects(() => service.get(student, created.id), { code: 'FORBIDDEN' });
  await assert.rejects(() => service.update(other, created.id, { title: 'Nope' }), { code: 'FORBIDDEN' });
  const published = await service.update(owner, created.id, { status: 'published' });
  assert.ok(published.publishedAt);
  assert.equal((await service.listPublic({ category: 'math', difficulty: 'beginner' }))[0].id, created.id);
  await assert.rejects(() => service.getLesson(null, created.id, new mongoose.Types.ObjectId()), { code: 'LESSON_NOT_FOUND' });
  const first = await service.addLesson(owner, created.id, { title: 'First', content: 'Private curriculum body', status: 'published' });
  const second = await service.addLesson(owner, created.id, { title: 'Second', content: 'Second body', status: 'published' });
  await assert.rejects(() => service.getLesson(null, created.id, first._id), { code: 'UNAUTHORIZED' });
  await assert.rejects(() => service.getLesson(student, created.id, first._id), { code: 'FORBIDDEN' });
  await Enrollment.create({ studentId: student.userId, courseId: created.id });
  assert.equal((await service.getLesson(student, created.id, first._id)).content, 'Private curriculum body');
  const closedEnrollment = await service.update(owner, created.id, { enrollmentOpen: false });
  assert.equal(closedEnrollment.enrollmentOpen, false);
  assert.equal((await service.getLesson(student, created.id, first._id)).content, 'Private curriculum body');
  assert.equal((await service.listPublic({}))[0].enrollmentOpen, false);
  await assert.rejects(() => Enrollment.create({ studentId: new mongoose.Types.ObjectId(), courseId: created.id }), mongoose.Error.ValidationError);
  await assert.rejects(() => service.updateLesson(other, created.id, first._id, { title: 'No' }), { code: 'FORBIDDEN' });
  assert.equal((await service.updateLesson(owner, created.id, first._id, { title: 'Edited' })).title, 'Edited');
  await service.reorderLesson(admin, created.id, second._id, 1);
  assert.deepEqual((await Lesson.find({ courseId: created.id }).sort({ position: 1 }).lean()).map((item) => item.title), ['Second', 'Edited']);
  await service.removeLesson(owner, created.id, second._id);
  assert.deepEqual((await Lesson.find({ courseId: created.id }).sort({ position: 1 }).lean()).map((item) => item.position), [1]);
  await service.archive(owner, created.id);
  assert.equal((await service.listPublic({})).length, 0);
  await assert.rejects(() => service.getLesson(student, created.id, first._id), { code: 'FORBIDDEN' });
});
