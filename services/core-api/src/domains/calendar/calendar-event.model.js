import mongoose from 'mongoose';
import { Course } from '../courses/course.model.js';

const { Schema } = mongoose;
const calendarEventSchema = new Schema({
  scope: { type: String, enum: ['global', 'course'], required: true, default: 'global' },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', default: null, immutable: true },
  title: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
  description: { type: String, maxlength: 5000, default: '', select: false },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, default: null },
  status: { type: String, enum: ['active', 'cancelled'], required: true, default: 'active' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true }
}, { timestamps: true, versionKey: 'version', collection: 'CalendarEvents', strict: 'throw' });
calendarEventSchema.pre('validate', async function validateScope() {
  if (this.scope === 'course' && !this.courseId) this.invalidate('courseId', 'Course events require courseId.');
  if (this.scope === 'global' && this.courseId) this.invalidate('courseId', 'Global events may not have courseId.');
  if (this.endsAt && this.endsAt <= this.startsAt) this.invalidate('endsAt', 'Event end must be after start.');
  if (this.scope === 'course' && this.courseId && !await Course.exists({ _id: this.courseId })) this.invalidate('courseId', 'Course does not exist.');
});
calendarEventSchema.index({ scope: 1, courseId: 1, status: 1, startsAt: 1 }, { name: 'calendar_event_scope_course_start' });
calendarEventSchema.index({ status: 1, startsAt: 1 }, { name: 'calendar_event_active_start' });
export const CalendarEvent = mongoose.model('CalendarEvent', calendarEventSchema);
