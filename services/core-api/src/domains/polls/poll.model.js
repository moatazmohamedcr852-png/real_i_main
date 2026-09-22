import mongoose from 'mongoose';

const { Schema } = mongoose;

const optionSchema = new Schema({
  key: { type: String, required: true, trim: true, minlength: 1, maxlength: 64 },
  label: { type: String, required: true, trim: true, minlength: 1, maxlength: 500 }
}, { _id: false, strict: 'throw' });

const pollSchema = new Schema({
  sessionId: { type: Schema.Types.ObjectId, ref: 'LiveSession', required: true, immutable: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  question: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
  responseType: { type: String, enum: ['single_choice', 'multiple_choice', 'free_text'], required: true },
  options: { type: [optionSchema], default: [], validate: [(items) => items.length <= 10 && new Set(items.map((item) => item.key)).size === items.length, 'Poll options must have unique keys and contain at most 10 options.'] },
  status: { type: String, enum: ['draft', 'open', 'closed'], required: true, default: 'draft' },
  opensAt: { type: Date, default: null },
  closesAt: { type: Date, default: null }
}, { timestamps: true, versionKey: 'version', collection: 'Polls', strict: 'throw' });

pollSchema.pre('validate', function validateOptions(next) {
  if (this.responseType === 'free_text' && this.options.length) this.invalidate('options', 'Free-text polls may not define options.');
  if (this.responseType !== 'free_text' && this.options.length < 2) this.invalidate('options', 'Choice polls require at least two options.');
  if (this.closesAt && this.opensAt && this.closesAt <= this.opensAt) this.invalidate('closesAt', 'closesAt must be after opensAt.');
  next();
});

pollSchema.index({ sessionId: 1, createdAt: -1 }, { name: 'poll_session_created' });
pollSchema.index({ sessionId: 1, status: 1, opensAt: 1 }, { name: 'poll_session_status_open' });

export const Poll = mongoose.model('Poll', pollSchema);
