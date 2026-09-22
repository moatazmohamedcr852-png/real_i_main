import mongoose from 'mongoose';
import { AppError, forbidden } from '../../shared/errors.js';

const isAdmin = (actor) => actor.role === 'admin';
const id = (value) => String(value);
const publicCourse = (course) => ({ id: id(course._id), project_id: id(course._id), title: course.title, description: course.description, category: course.category, difficulty: course.difficulty, level: course.difficulty, pricing: course.pricing, enrollmentOpen: course.enrollmentOpen, publishedAt: course.publishedAt });
const privateCourse = (course) => ({ ...publicCourse(course), status: course.status, instructorId: id(course.instructorId), createdAt: course.createdAt, updatedAt: course.updatedAt });
const lessonView = (lesson, includeContent) => ({ id: id(lesson._id), title: lesson.title, position: lesson.position, status: lesson.status, ...(includeContent ? { content: lesson.content } : {}) });
const withCurriculum = (view, lessonDocs, { enrolled = false, includeContent = false } = {}) => {
  const curriculum = (lessonDocs || []).map((lesson) => lessonView(lesson, includeContent));
  return { ...view, is_enrolled: enrolled, lessons_count: curriculum.length, modules: [{ id: 'curriculum', title: 'Curriculum', lessons: curriculum }] };
};

export function createCourseService({ courses, lessons, enrollments, transaction, finalizeEligibilityLoss = async () => 0 }) {
  const assertOwner = async (actor, courseId) => { const course = await courses.byId(courseId); if (!course) throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.'); if (!isAdmin(actor) && id(course.instructorId) !== id(actor.userId)) throw forbidden(); return course; };
  const assertStudentAccess = async (actor, course) => { if (isAdmin(actor) || id(course.instructorId) === id(actor.userId)) return; const enrollment = await enrollments.active(actor.userId, course._id); if (!enrollment || course.status !== 'published') throw forbidden(); };
  const publishedLessons = async (courseId) => (lessons.listPublished ? lessons.listPublished(courseId) : []);
  return {
    async listPublic(filters) { return (await courses.publicList(filters)).map(publicCourse); },
    async decorateCatalog(actor, listed) {
      return Promise.all(listed.map(async (course) => {
        const courseId = course.id;
        const enrolled = actor?.role === 'student' && Boolean(await enrollments.active(actor.userId, courseId));
        const lessonDocs = await publishedLessons(courseId);
        return withCurriculum(course, lessonDocs, { enrolled, includeContent: false });
      }));
    },
    async create(actor, input) { if (!['instructor', 'admin'].includes(actor.role)) throw forbidden(); const status = input.status ?? 'draft'; return privateCourse(await courses.create({ ...input, status, ...(status === 'published' ? { publishedAt: new Date() } : {}), instructorId: actor.role === 'admin' && input.instructorId ? input.instructorId : actor.userId })); },
    async get(actor, courseId) {
      const course = await courses.byId(courseId);
      if (!course) throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
      if (!actor) {
        if (course.status !== 'published') throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
        return withCurriculum(publicCourse(course), await publishedLessons(courseId), { enrolled: false, includeContent: false });
      }
      const owner = isAdmin(actor) || id(course.instructorId) === id(actor.userId);
      if (actor.role === 'student') {
        if (course.status !== 'published') throw forbidden();
        const enrollment = await enrollments.active(actor.userId, course._id);
        return withCurriculum(publicCourse(course), await publishedLessons(courseId), { enrolled: Boolean(enrollment), includeContent: Boolean(enrollment) });
      }
      if (!owner) throw forbidden();
      const lessonDocs = lessons.listAll ? await lessons.listAll(courseId) : await publishedLessons(courseId);
      return withCurriculum(privateCourse(course), lessonDocs, { enrolled: false, includeContent: true });
    },
    async update(actor, courseId, input) { const course = await assertOwner(actor, courseId); return privateCourse(await courses.update(courseId, { ...input, ...(input.status === 'published' && course.status !== 'published' ? { publishedAt: new Date() } : {}) })); },
    async archive(actor, courseId) { await assertOwner(actor, courseId); const archived = await transaction(async (session) => { const updated = await courses.update(courseId, { status: 'archived', archivedAt: new Date() }, session); await finalizeEligibilityLoss({ courseId, session }); return updated; }); return privateCourse(archived); },
    async addLesson(actor, courseId, input) { await assertOwner(actor, courseId); const position = await lessons.nextPosition(courseId); const status = input.status ?? 'draft'; try { return await lessons.create({ ...input, status, ...(status === 'published' ? { publishedAt: new Date() } : {}), courseId, position }); } catch (error) { if (error?.code === 11000) throw new AppError(409, 'LESSON_POSITION_CONFLICT', 'Lesson position is already in use.'); throw error; } },
    async updateLesson(actor, courseId, lessonId, input) { await assertOwner(actor, courseId); const existing = await lessons.byId(lessonId); const lesson = await lessons.update(courseId, lessonId, { ...input, ...(input.status === 'published' && existing?.status !== 'published' ? { publishedAt: new Date() } : {}) }); if (!lesson) throw new AppError(404, 'LESSON_NOT_FOUND', 'Lesson not found.'); return lesson; },
    async getLesson(actor, courseId, lessonId) { const course = await courses.byId(courseId); const lesson = await lessons.byId(lessonId); if (!course || !lesson || id(lesson.courseId) !== id(courseId)) throw new AppError(404, 'LESSON_NOT_FOUND', 'Lesson not found.'); if (!actor) throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.'); if (actor.role === 'student') { await assertStudentAccess(actor, course); if (lesson.status !== 'published') throw forbidden(); } else if (!isAdmin(actor) && id(course.instructorId) !== id(actor.userId)) throw forbidden(); return lesson; },
    async reorderLesson(actor, courseId, lessonId, targetPosition) { await assertOwner(actor, courseId); try { return await transaction(async (session) => lessons.reorder(courseId, lessonId, targetPosition, session)); } catch (error) { if (error instanceof RangeError) throw new AppError(400, 'INVALID_LESSON_POSITION', error.message); if (error.message === 'Lesson not found') throw new AppError(404, 'LESSON_NOT_FOUND', 'Lesson not found.'); throw error; } },
    async removeLesson(actor, courseId, lessonId) { await assertOwner(actor, courseId); const lesson = await transaction((session) => lessons.remove(courseId, lessonId, session)); if (!lesson) throw new AppError(404, 'LESSON_NOT_FOUND', 'Lesson not found.'); return lesson; }
  };
}
