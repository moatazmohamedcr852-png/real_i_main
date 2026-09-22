import mongoose from 'mongoose';

const { Schema } = mongoose;
const optionSchema = new Schema({ id: { type: String, required: true, trim: true, maxlength: 64 }, text: { type: String, required: true, trim: true, maxlength: 2000 } }, { _id: false, strict: 'throw' });
const rubricCriterionSchema = new Schema({ label: { type: String, required: true, trim: true, maxlength: 500 }, points: { type: Number, required: true, min: 0, max: 1000 } }, { _id: false, strict: 'throw' });
const questionSchema = new Schema({
  id: { type: String, required: true, trim: true, maxlength: 64 },
  type: { type: String, enum: ['mcq', 'true_false', 'short_answer', 'essay'], required: true },
  prompt: { type: String, required: true, trim: true, maxlength: 20000 },
  options: { type: [optionSchema], default: [] },
  correctOptionIds: { type: [String], default: [], select: false },
  points: { type: Number, required: true, min: 1, max: 1000 },
  rubric: { type: [rubricCriterionSchema], default: [] }
}, { _id: false, strict: 'throw' });

const assessmentSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, immutable: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  title: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
  instructions: { type: String, default: '', maxlength: 10000 },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', required: true },
  timeLimitSeconds: { type: Number, required: true, min: 60, max: 28800 },
  randomizeQuestions: { type: Boolean, required: true, default: true },
  maxAttempts: { type: Number, required: true, min: 1, max: 20, default: 1 },
  availableFrom: { type: Date, default: null },
  dueAt: { type: Date, default: null },
  questions: { type: [questionSchema], required: true, validate: [(items) => items.length >= 1 && items.length <= 200 && new Set(items.map((item) => item.id)).size === items.length, 'Assessments require 1–200 questions with unique IDs.'] },
  publishedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: 'version', collection: 'Assessments', strict: 'throw' });

assessmentSchema.pre('validate', function validateQuestions(next) {
  if (this.dueAt && this.availableFrom && this.dueAt <= this.availableFrom) this.invalidate('dueAt', 'Assessment dueAt must be after availableFrom.');
  for (const question of this.questions) {
    const optionIds = new Set(question.options.map((option) => option.id));
    if (['mcq', 'true_false'].includes(question.type) && (question.options.length < 2 || question.correctOptionIds.length !== 1 || !optionIds.has(question.correctOptionIds[0]))) this.invalidate('questions', 'Choice questions require valid options and exactly one correct answer.');
    if (question.type === 'true_false' && (question.options.length !== 2 || !optionIds.has('true') || !optionIds.has('false'))) this.invalidate('questions', 'True/false questions require true and false option IDs.');
    if (question.type === 'essay' && question.rubric.reduce((sum, criterion) => sum + criterion.points, 0) !== question.points) this.invalidate('questions', 'Essay rubric points must equal the question points.');
  }
  next();
});
assessmentSchema.index({ courseId: 1, status: 1, publishedAt: -1 }, { name: 'assessment_course_status_published' });
assessmentSchema.index({ authorId: 1, status: 1, updatedAt: -1 }, { name: 'assessment_author_status_updated' });
assessmentSchema.index({ courseId: 1, status: 1, dueAt: 1 }, { name: 'assessment_course_status_due' });

export const Assessment = mongoose.model('Assessment', assessmentSchema);
