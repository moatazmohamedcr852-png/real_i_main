import mongoose from 'mongoose';

const { Schema } = mongoose;

const liveSessionSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, immutable: true },
  hostId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  provider: { type: String, enum: ['jitsi'], required: true, default: 'jitsi', immutable: true },
  providerRoomId: { type: String, required: true, trim: true, minlength: 8, maxlength: 200, immutable: true },
  title: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  status: { type: String, enum: ['scheduled', 'live', 'ended', 'cancelled'], required: true, default: 'scheduled' },
  summaryStatus: { type: String, enum: ['pending', 'ready', 'failed'], required: true, default: 'pending' }
}, { timestamps: true, versionKey: 'version', collection: 'LiveSessions', strict: 'throw' });

liveSessionSchema.path('endsAt').validate(function endsAfterStarts(value) { return !this.startsAt || value > this.startsAt; }, 'endsAt must be after startsAt.');
liveSessionSchema.index({ provider: 1, providerRoomId: 1 }, { unique: true, name: 'live_session_provider_room_unique' });
liveSessionSchema.index({ courseId: 1, startsAt: -1 }, { name: 'live_session_course_starts' });
liveSessionSchema.index({ hostId: 1, startsAt: -1 }, { name: 'live_session_host_starts' });
liveSessionSchema.index({ status: 1, startsAt: 1 }, { name: 'live_session_status_starts' });

export const LiveSession = mongoose.model('LiveSession', liveSessionSchema);
