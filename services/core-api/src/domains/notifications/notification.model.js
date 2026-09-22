import mongoose from 'mongoose';

const { Schema } = mongoose;
const payloadSchema = new Schema({ courseId: { type: Schema.Types.ObjectId, ref: 'Course', default: null }, assessmentId: { type: Schema.Types.ObjectId, ref: 'Assessment', default: null }, submissionId: { type: Schema.Types.ObjectId, ref: 'Submission', default: null }, calendarEventId: { type: Schema.Types.ObjectId, ref: 'CalendarEvent', default: null } }, { _id: false, strict: 'throw' });
const notificationSchema = new Schema({
  recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  type: { type: String, enum: ['assessment_graded', 'calendar_reminder', 'system'], required: true, immutable: true },
  payload: { type: payloadSchema, required: true, immutable: true },
  deduplicationKey: { type: String, trim: true, maxlength: 200, default: null, immutable: true },
  readAt: { type: Date, default: null }
}, { timestamps: true, versionKey: 'version', collection: 'Notifications', strict: 'throw' });
notificationSchema.index({ recipientId: 1, readAt: 1, createdAt: -1 }, { name: 'notification_recipient_read_created' });
notificationSchema.index({ recipientId: 1, deduplicationKey: 1 }, { unique: true, partialFilterExpression: { deduplicationKey: { $type: 'string' } }, name: 'notification_recipient_dedup_unique' });
export const Notification = mongoose.model('Notification', notificationSchema);
