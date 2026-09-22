import mongoose from 'mongoose';

const { Schema } = mongoose;

const responseSchema = new Schema({
  questionId: { type: String, required: true, trim: true, minlength: 1, maxlength: 128 },
  value: { type: String, required: true, maxlength: 50000 }
}, { _id: false, strict: 'throw' });

const gradingSchema = new Schema({
  status: { type: String, enum: ['pending', 'auto_graded', 'manual_review', 'graded'], required: true },
  score: { type: Number, min: 0, max: 100, default: null },
  feedback: { type: String, maxlength: 20000, default: null },
  gradedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  gradedAt: { type: Date, default: null }
}, { _id: false, strict: 'throw' });

const snapshotQuestionSchema = new Schema({ id: String, type: String, prompt: String, options: [{ id: String, text: String, _id: false }], correctOptionIds: [String], points: Number, rubric: [{ label: String, points: Number, _id: false }] }, { _id: false, strict: 'throw' });

const submissionSchema = new Schema({
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, immutable: true },
  lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', default: null, immutable: true },
  assessmentId: { type: Schema.Types.ObjectId, ref: 'Assessment', default: null, immutable: true },
  kind: { type: String, enum: ['lesson', 'assessment'], required: true, default: 'lesson' },
  attemptNumber: { type: Number, required: true, min: 1, max: 1000 },
  submissionType: { type: String, enum: ['mcq', 'short_answer', 'true_false', 'essay'], required: true },
  responses: { type: [responseSchema], default: [], validate: [(items) => items.length <= 500, 'At most 500 responses are allowed.'] },
  startedAt: { type: Date, default: null, immutable: true },
  expiresAt: { type: Date, default: null, immutable: true },
  attemptStatus: { type: String, enum: ['in_progress', 'submitted', 'timed_out', 'finalized_due_date', 'finalized_eligibility_lost'], required: true, default: 'submitted' },
  expirationReason: { type: String, enum: ['time_limit', 'due_date'], default: null, immutable: true },
  finalizationReason: { type: String, enum: ['manual_submit', 'timeout', 'due_date', 'eligibility_lost'], default: null },
  questionOrder: { type: [String], default: [] },
  questionSnapshot: { type: [snapshotQuestionSchema], default: undefined, select: false },
  submittedAt: { type: Date, default: Date.now },
  grading: { type: gradingSchema, default: undefined, select: false }
}, { timestamps: true, versionKey: 'version', collection: 'Submissions', strict: 'throw' });

function hasGradingWrite(update) {
  return Object.keys(update ?? {}).some((key) => key === 'grading' || key.startsWith('grading.'))
    || Object.keys(update?.$set ?? {}).some((key) => key === 'grading' || key.startsWith('grading.'));
}
function hasAttemptDefinitionWrite(update) {
  const fields = ['kind', 'questionOrder', 'questionSnapshot', 'assessmentId', 'studentId', 'courseId', 'lessonId', 'startedAt', 'expiresAt'];
  const keys = [...Object.keys(update ?? {}), ...Object.keys(update?.$set ?? {})];
  return keys.some((key) => fields.includes(key) || fields.some((field) => key.startsWith(`${field}.`)));
}

submissionSchema.pre('validate', function studentCannotGrade(next) {
  if (this.$locals?.actorRole === 'student' && this.isModified('grading')) this.invalidate('grading', 'Students cannot create or modify grading data.');
  next();
});
submissionSchema.pre('validate', function validateAttemptShape(next) {
  if (!this.isNew && (this.isModified('kind') || this.isModified('questionOrder') || this.isModified('questionSnapshot'))) this.invalidate('kind', 'Attempt definition fields are immutable after creation.');
  if (this.kind === 'lesson' && !this.lessonId) this.invalidate('lessonId', 'Lesson submissions require lessonId.');
  if (this.kind === 'assessment') {
    if (!this.assessmentId || !this.startedAt || !this.expiresAt || !this.expirationReason || !this.questionSnapshot?.length || !this.questionOrder.length) this.invalidate('assessmentId', 'Assessment attempts require an assessment, server times, an expiry reason, and a question snapshot.');
    if (this.lessonId) this.invalidate('lessonId', 'Assessment attempts may not have lessonId.');
    if (this.attemptStatus !== 'in_progress' && !this.submittedAt) this.invalidate('submittedAt', 'Completed assessment attempts require submittedAt.');
  } else if (!this.responses.length) this.invalidate('responses', 'Lesson submissions require at least one response.');
  next();
});
submissionSchema.pre(['updateOne', 'findOneAndUpdate'], function studentCannotUpdateGrading(next) {
  if (this.getOptions().actorRole === 'student' && hasGradingWrite(this.getUpdate())) return next(new mongoose.Error('Students cannot modify grading data.'));
  if (hasAttemptDefinitionWrite(this.getUpdate())) return next(new mongoose.Error('Attempt definition fields are immutable.'));
  next();
});

submissionSchema.index({ studentId: 1, lessonId: 1, attemptNumber: 1 }, { unique: true, partialFilterExpression: { kind: 'lesson' }, name: 'submission_student_lesson_attempt_unique' });
submissionSchema.index({ studentId: 1, assessmentId: 1, attemptNumber: 1 }, { unique: true, partialFilterExpression: { kind: 'assessment' }, name: 'submission_student_assessment_attempt_unique' });
submissionSchema.index({ studentId: 1, assessmentId: 1, attemptStatus: 1 }, { name: 'submission_student_assessment_status' });
submissionSchema.index({ courseId: 1, kind: 1, 'grading.status': 1, submittedAt: -1 }, { name: 'submission_course_assessment_grading' });
submissionSchema.index({ studentId: 1, courseId: 1, submittedAt: -1 }, { name: 'submission_student_course_submitted' });
submissionSchema.index({ courseId: 1, lessonId: 1, 'grading.status': 1, submittedAt: -1 }, { name: 'submission_course_lesson_grading_submitted' });

export const Submission = mongoose.model('Submission', submissionSchema);
