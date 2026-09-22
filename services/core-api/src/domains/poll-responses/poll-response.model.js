import mongoose from 'mongoose';

const { Schema } = mongoose;

const pollResponseSchema = new Schema({
  pollId: { type: Schema.Types.ObjectId, ref: 'Poll', required: true, immutable: true },
  sessionId: { type: Schema.Types.ObjectId, ref: 'LiveSession', required: true, immutable: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, immutable: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  optionKeys: { type: [String], default: undefined, immutable: true, validate: [(items) => Array.isArray(items) && items.length >= 1 && items.length <= 10 && items.every((key) => typeof key === 'string' && key.length <= 64) && new Set(items).size === items.length, 'Responses require 1–10 unique option keys.'] },
  responseText: { type: String, trim: true, minlength: 1, maxlength: 5000, default: null, immutable: true },
  submittedAt: { type: Date, required: true, default: Date.now, immutable: true }
}, { timestamps: true, versionKey: 'version', collection: 'PollResponses', strict: 'throw' });

pollResponseSchema.pre('validate', function enforceStudentOwnership(next) {
  const { actorRole, actorUserId } = this.$locals ?? {};
  if (actorRole === 'student' && (!actorUserId || String(this.studentId) !== String(actorUserId))) this.invalidate('studentId', 'Students may only submit poll responses as themselves.');
  if (!this.optionKeys?.length && !this.responseText) this.invalidate('optionKeys', 'A poll response must contain option keys or response text.');
  next();
});

pollResponseSchema.index({ pollId: 1, studentId: 1 }, { unique: true, name: 'poll_response_one_vote_per_student' });
pollResponseSchema.index({ pollId: 1, optionKeys: 1 }, { name: 'poll_response_tally_by_option' });
pollResponseSchema.index({ sessionId: 1, submittedAt: -1 }, { name: 'poll_response_session_submitted' });

export const PollResponse = mongoose.model('PollResponse', pollResponseSchema);
