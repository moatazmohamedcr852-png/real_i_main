import assert from 'node:assert/strict';
import test from 'node:test';
import { createCourseService } from '../src/domains/course-management/course.service.js';

const course = { _id: 'c1', title: 'Published', description: 'Course', status: 'published', instructorId: 'i1', pricing: { access: 'free', currency: null, amount: null } };
const draft = { ...course, _id: 'c2', status: 'draft' };
function service(enrolled = false) { return createCourseService({ courses: { byId: async (id) => id === 'c1' ? course : id === 'c2' ? draft : null, publicList: async () => [course], create: async (x) => ({ ...course, ...x }), update: async (_id, x) => ({ ...course, ...x }) }, lessons: { byId: async () => ({ _id: 'l1', courseId: 'c1', status: 'published', content: 'content' }), nextPosition: async () => 1, create: async (x) => x, update: async (_courseId, id, x) => id === 'l1' ? { _id: id, ...x } : null, remove: async () => true, reorder: async () => ({}) }, enrollments: { active: async () => enrolled ? { status: 'enrolled' } : null }, transaction: async (work) => work(null) }); }
const student = { userId: 's1', role: 'student' }, owner = { userId: 'i1', role: 'instructor' }, other = { userId: 'i2', role: 'instructor' }, admin = { userId: 'a1', role: 'admin' };

test('course authorization matrix and public draft protection', async () => {
  await assert.rejects(() => service().get(null, 'c2'), { code: 'COURSE_NOT_FOUND' });
  await assert.rejects(() => service().get(student, 'c2'), { code: 'FORBIDDEN' });
  assert.equal((await service().get(student, 'c1')).title, 'Published');
  assert.equal((await service().get(student, 'c1')).is_enrolled, false);
  assert.equal((await service(true).get(student, 'c1')).is_enrolled, true);
  await assert.rejects(() => service().update(other, 'c1', { title: 'No' }), { code: 'FORBIDDEN' });
  assert.equal((await service().update(owner, 'c1', { title: 'Yes' })).title, 'Yes');
  assert.equal((await service().update(admin, 'c1', { title: 'Admin' })).title, 'Admin');
  await assert.rejects(() => service().create(student, { title: 'No' }), { code: 'FORBIDDEN' });
  await assert.rejects(() => service().updateLesson(other, 'c1', 'l1', { title: 'No' }), { code: 'FORBIDDEN' });
  assert.equal((await service().updateLesson(owner, 'c1', 'l1', { title: 'Updated' })).title, 'Updated');
});
