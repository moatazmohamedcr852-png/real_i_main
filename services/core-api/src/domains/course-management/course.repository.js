import mongoose from 'mongoose';
import { Course } from '../courses/course.model.js';
import { Lesson } from '../lessons/lesson.model.js';
import { Enrollment } from '../enrollments/enrollment.model.js';

export const courseRepository = {
  byId: (id) => Course.findById(id), create: (data) => Course.create(data), update: (id, data, session) => Course.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true, session }),
  publicList: ({ category, difficulty, limit = 20 }) => Course.find({ status: 'published', ...(category ? { category } : {}), ...(difficulty ? { difficulty } : {}) }).sort({ publishedAt: -1, _id: 1 }).limit(Math.min(limit, 50)).lean()
};
export const lessonRepository = {
  byId: (id) => Lesson.findById(id), create: (data) => Lesson.create(data), nextPosition: async (courseId) => ((await Lesson.findOne({ courseId }).sort({ position: -1 }).select('position').lean())?.position ?? 0) + 1,
  listPublished: (courseId) => Lesson.find({ courseId, status: 'published' }).sort({ position: 1, _id: 1 }).lean(),
  listAll: (courseId) => Lesson.find({ courseId }).sort({ position: 1, _id: 1 }).lean(),
  update: (courseId, id, data) => Lesson.findOneAndUpdate({ _id: id, courseId }, { $set: data }, { new: true, runValidators: true }),
  async remove(courseId, id, session) { const lesson = await Lesson.findOneAndDelete({ _id: id, courseId }, { session }); if (lesson) await Lesson.updateMany({ courseId, position: { $gt: lesson.position } }, { $inc: { position: -1 } }, { session }); return lesson; },
  async reorder(courseId, lessonId, targetPosition, session) {
    const ordered = await Lesson.find({ courseId }).sort({ position: 1, _id: 1 }).session(session);
    const current = ordered.findIndex((lesson) => String(lesson._id) === String(lessonId));
    if (current === -1) throw new Error('Lesson not found');
    if (targetPosition > ordered.length) throw new RangeError('Target lesson position is outside this course.');
    const [moving] = ordered.splice(current, 1);
    ordered.splice(targetPosition - 1, 0, moving);
    // Offset every existing key first, then assign the complete new ordering: no intermediate unique-key collision.
    await Lesson.updateMany({ courseId }, { $inc: { position: 100000 } }, { session });
    await Lesson.bulkWrite(ordered.map((lesson, index) => ({ updateOne: { filter: { _id: lesson._id }, update: { $set: { position: index + 1 } } } })), { session });
    return Lesson.findById(lessonId).session(session);
  }
};
export const enrollmentRepository = { active: (studentId, courseId) => Enrollment.findOne({ studentId, courseId, status: 'enrolled' }).lean() };
export const withTransaction = async (work) => { const session = await mongoose.startSession(); try { let result; await session.withTransaction(async () => { result = await work(session); }); return result; } finally { await session.endSession(); } };
