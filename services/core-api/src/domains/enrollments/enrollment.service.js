import { AppError, forbidden } from '../../shared/errors.js';
import { Enrollment } from './enrollment.model.js';

const asString = (value) => String(value);

export function createEnrollmentService({ enrollments, courses, transaction, finalizeEligibilityLoss = async () => 0 }) {
  return {
    async enroll(actor, courseId, studentId = null) {
      const targetId = actor.role === 'student' ? actor.userId : (studentId || actor.userId);
      if (actor.role === 'student' && asString(targetId) !== asString(actor.userId)) throw forbidden();
      if (!['student', 'instructor', 'admin'].includes(actor.role)) throw forbidden();
      const course = await courses.byId(courseId);
      if (!course) throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
      if (actor.role === 'instructor' && asString(course.instructorId) !== asString(actor.userId) && asString(targetId) !== asString(actor.userId)) throw forbidden();
      const existing = await Enrollment.findOne({ studentId: targetId, courseId, status: 'enrolled' });
      if (existing) return { id: asString(existing._id), status: existing.status, courseId: asString(courseId), studentId: asString(targetId), enrolled: true };
      try {
        const enrollment = new Enrollment({ studentId: targetId, courseId, status: 'enrolled' });
        enrollment.$locals = { actorRole: actor.role, actorUserId: actor.userId };
        await enrollment.save();
        return { id: asString(enrollment._id), status: enrollment.status, courseId: asString(courseId), studentId: asString(targetId), enrolled: true, success: true };
      } catch (error) {
        if (error?.name === 'ValidationError') throw new AppError(409, 'ENROLLMENT_CLOSED', 'This course is not accepting enrollments.');
        if (error?.code === 11000) {
          const current = await Enrollment.findOne({ studentId: targetId, courseId, status: 'enrolled' });
          if (current) return { id: asString(current._id), status: current.status, courseId: asString(courseId), studentId: asString(targetId), enrolled: true, success: true };
        }
        throw error;
      }
    },
    async drop(actor, enrollmentId) {
      const enrollment = await enrollments.byId(enrollmentId);
      if (!enrollment) throw new AppError(404, 'ENROLLMENT_NOT_FOUND', 'Enrollment not found.');
      const course = await courses.byId(enrollment.courseId);
      const mayDrop = actor.role === 'admin' || (actor.role === 'student' && asString(actor.userId) === asString(enrollment.studentId)) || (actor.role === 'instructor' && asString(actor.userId) === asString(course?.instructorId));
      if (!mayDrop) throw forbidden();
      const result = await transaction(async (session) => {
        const dropped = await enrollments.dropActive(enrollmentId, session);
        if (!dropped) throw new AppError(409, 'ENROLLMENT_NOT_ACTIVE', 'Enrollment is no longer active.');
        await finalizeEligibilityLoss({ courseId: dropped.courseId, studentId: dropped.studentId, session });
        return dropped;
      });
      return { id: asString(result._id), status: result.status, droppedAt: result.droppedAt };
    }
  };
}
