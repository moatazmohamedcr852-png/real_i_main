import mongoose from 'mongoose';

const { Schema } = mongoose;

const courseSchema = new Schema({
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 200 },
  description: { type: String, required: true, trim: true, minlength: 1, maxlength: 10000 },
  category: { type: String, trim: true, maxlength: 80, default: null },
  difficulty: { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: null },
  pricing: { access: { type: String, enum: ['free', 'paid'], required: true, default: 'free' }, currency: { type: String, uppercase: true, minlength: 3, maxlength: 3, default: null }, amount: { type: Number, min: 0, default: null } },
  instructorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  status: { type: String, enum: ['draft', 'published', 'archived'], required: true, default: 'draft' },
  enrollmentOpen: { type: Boolean, required: true, default: true },
  publishedAt: { type: Date, default: null },
  archivedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: 'version', collection: 'Courses' });

courseSchema.pre('validate', function validatePricing(next) {
  if (this.pricing.access === 'paid' && (!this.pricing.currency || this.pricing.amount === null)) this.invalidate('pricing', 'Paid courses require currency and amount.');
  if (this.pricing.access === 'free' && (this.pricing.currency || this.pricing.amount !== null)) this.invalidate('pricing', 'Free courses may not have a price.');
  next();
});

courseSchema.index({ instructorId: 1, status: 1, updatedAt: -1 }, { name: 'course_instructor_status_updated' });
courseSchema.index({ status: 1, publishedAt: -1, _id: 1 }, { name: 'course_published_browse' });
courseSchema.index({ status: 1, category: 1, difficulty: 1, publishedAt: -1, _id: 1 }, { name: 'course_catalog_filters' });

export const Course = mongoose.model('Course', courseSchema);
