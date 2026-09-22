import mongoose from 'mongoose';

const { Schema } = mongoose;

const aiGuidelineSchema = new Schema({
  scope: { type: String, enum: ['global', 'course'], required: true, default: 'global' },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', default: null, immutable: true },
  version: { type: Number, required: true, min: 1, max: 100000 },
  status: { type: String, enum: ['draft', 'active', 'archived'], required: true, default: 'draft' },
  content: { type: String, required: true, minlength: 1, maxlength: 100000, select: false },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  activatedAt: { type: Date, default: null },
  archivedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: 'version', collection: 'AIGuidelines', strict: 'throw' });

aiGuidelineSchema.pre('validate', function validateScope(next) {
  if (this.scope === 'course' && !this.courseId) this.invalidate('courseId', 'Course-scoped guidelines require courseId.');
  if (this.scope === 'global' && this.courseId) this.invalidate('courseId', 'Global guidelines may not have courseId.');
  next();
});

aiGuidelineSchema.index({ scope: 1, courseId: 1, version: 1 }, { unique: true, name: 'ai_guideline_scope_course_version_unique' });
aiGuidelineSchema.index({ scope: 1, courseId: 1, status: 1, activatedAt: -1 }, { name: 'ai_guideline_scope_course_active' });
aiGuidelineSchema.index({ scope: 1, courseId: 1 }, { unique: true, partialFilterExpression: { status: 'active' }, name: 'ai_guideline_one_active_per_scope' });

export const AIGuideline = mongoose.model('AIGuideline', aiGuidelineSchema);
