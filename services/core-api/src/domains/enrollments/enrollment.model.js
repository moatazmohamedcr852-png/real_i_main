import mongoose from 'mongoose';
import { Course } from '../courses/course.model.js';

const { Schema } = mongoose;

const enrollmentSchema = new Schema({
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, immutable: true },
  status: { type: String, enum: ['enrolled', 'dropped', 'completed'], required: true, default: 'enrolled' },
  enrolledAt: { type: Date, required: true, default: Date.now, immutable: true },
  droppedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  completionSource: { type: String, enum: ['instructor', 'system'], default: null }
}, { timestamps: true, versionKey: 'version', collection: 'Enrollments', strict: 'throw' });

enrollmentSchema.pre('validate', async function enforceStudentOwnership() {
  const { actorRole, actorUserId } = this.$locals ?? {};
  if (actorRole === 'student') {
    if (!actorUserId || String(this.studentId) !== String(actorUserId)) this.invalidate('studentId', 'Students may only create or modify their own enrollment.');
    if ((this.isNew && this.status !== 'enrolled') || this.status === 'completed' || this.isModified('completedAt') || this.isModified('completionSource')) {
      this.invalidate('status', 'Students may not set enrollment completion state.');
    }
  }
  if (this.status === 'dropped' && !this.droppedAt) this.droppedAt = new Date();
  if (this.isNew) {
    const course = await Course.findById(this.courseId).select('status enrollmentOpen').lean();
    if (!course) this.invalidate('courseId', 'Course does not exist.');
    else if (course.status !== 'published' || !course.enrollmentOpen) this.invalidate('courseId', 'This course is not accepting enrollments.');
  }
});

enrollmentSchema.index({ studentId: 1, courseId: 1 }, { unique: true, partialFilterExpression: { status: 'enrolled' }, name: 'enrollment_one_active_student_course' });
enrollmentSchema.index({ studentId: 1, status: 1, enrolledAt: -1 }, { name: 'enrollment_student_status_enrolled' });
enrollmentSchema.index({ courseId: 1, status: 1, enrolledAt: -1 }, { name: 'enrollment_course_status_enrolled' });
enrollmentSchema.index({ courseId: 1, enrolledAt: 1 }, { name: 'enrollment_course_enrolled_trend' });
enrollmentSchema.index({ enrolledAt: 1 }, { name: 'enrollment_platform_enrolled_trend' });

export const Enrollment = mongoose.model('Enrollment', enrollmentSchema);
