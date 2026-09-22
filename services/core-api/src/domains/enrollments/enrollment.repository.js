import { Enrollment } from './enrollment.model.js';
import { Course } from '../courses/course.model.js';

export const enrollmentLifecycleRepository = {
  byId: (id) => Enrollment.findById(id),
  dropActive: (id, session) => Enrollment.findOneAndUpdate({ _id: id, status: 'enrolled' }, { $set: { status: 'dropped', droppedAt: new Date() } }, { new: true, session })
};
export const enrollmentCourseRepository = { byId: (id) => Course.findById(id).lean() };
