import { Assessment } from './assessment.model.js';
import { Submission } from '../submissions/submission.model.js';
import { Course } from '../courses/course.model.js';
import { Enrollment } from '../enrollments/enrollment.model.js';

export const assessmentRepository = {
  list: (filter) => Assessment.find(filter).sort({ publishedAt: -1, updatedAt: -1 }).lean(),
  enrolledCourseIds: async (studentId) => (await Enrollment.find({ studentId, status: 'enrolled' }).select('courseId').lean()).map((item) => item.courseId),
  create: (data) => Assessment.create(data),
  updateDraft: (id, data) => Assessment.findOneAndUpdate({ _id: id, status: 'draft' }, { $set: data }, { new: true, runValidators: true }).select('+questions.correctOptionIds'),
  course: (id) => Course.findById(id).lean(),
  activeEnrollment: (studentId, courseId) => Enrollment.findOne({ studentId, courseId, status: 'enrolled' }).lean(),
  latestInProgress: (studentId, assessmentId) => Submission.findOne({ studentId, assessmentId, kind: 'assessment', attemptStatus: 'in_progress' }).sort({ attemptNumber: -1 }).select('+questionSnapshot'),
  completedCount: (studentId, assessmentId) => Submission.countDocuments({ studentId, assessmentId, kind: 'assessment', attemptStatus: { $in: ['submitted', 'timed_out', 'finalized_due_date', 'finalized_eligibility_lost'] } }),
  createAttempt: (data) => Submission.create(data),
  attemptForStudent: (id, studentId) => Submission.findOne({ _id: id, kind: 'assessment', ...(studentId ? { studentId } : {}) }).select('+questionSnapshot +grading'),
  saveAnswers: (id, studentId, responses, now) => Submission.findOneAndUpdate({ _id: id, studentId, kind: 'assessment', attemptStatus: 'in_progress', expiresAt: { $gt: now } }, { $set: { responses } }, { new: true }).select('+questionSnapshot'),
  claimCompletion: (id, status, now, { force = false, reason, session } = {}) => Submission.findOneAndUpdate({ _id: id, kind: 'assessment', attemptStatus: 'in_progress', ...(force ? {} : ['timed_out', 'finalized_due_date'].includes(status) ? { expiresAt: { $lte: now } } : { expiresAt: { $gt: now } }) }, { $set: { attemptStatus: status, submittedAt: now, finalizationReason: reason } }, { new: true, session }).select('+questionSnapshot'),
  setGrading: (id, grading, session) => Submission.findByIdAndUpdate(id, { $set: { grading } }, { new: true, session }).select('+questionSnapshot +grading'),
  claimManualGrade: (id, grading, session) => Submission.findOneAndUpdate({ _id: id, kind: 'assessment', 'grading.status': 'manual_review' }, { $set: { grading } }, { new: true, session }).select('+questionSnapshot +grading'),
  expired: (now, limit = 100) => Submission.find({ kind: 'assessment', attemptStatus: 'in_progress', expiresAt: { $lte: now } }).select('_id').limit(limit).lean(),
  inProgressForEligibility: (courseId, studentId, session) => Submission.find({ courseId, kind: 'assessment', attemptStatus: 'in_progress', ...(studentId ? { studentId } : {}) }).select('_id studentId assessmentId').session(session),
  queue: (courseId) => Submission.find({ courseId, kind: 'assessment', 'grading.status': 'manual_review' }).sort({ submittedAt: 1 }).select('+grading')
};
