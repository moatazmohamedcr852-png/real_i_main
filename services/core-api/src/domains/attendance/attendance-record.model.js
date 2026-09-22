import mongoose from 'mongoose';

const { Schema } = mongoose;
const intervalSchema = new Schema({ joinedAt: { type: Date, required: true }, leftAt: { type: Date, required: true } }, { _id: false, strict: 'throw' });
const attendanceRecordSchema = new Schema({
  sessionId: { type: Schema.Types.ObjectId, ref: 'LiveSession', required: true, immutable: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, immutable: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  intervals: { type: [intervalSchema], default: [], validate: [(items) => items.length <= 100, 'Attendance reconnect intervals are limited to 100 per session.'] },
  activeJoinedAt: { type: Date, default: null },
  totalSeconds: { type: Number, required: true, default: 0, min: 0 },
  lastEventAt: { type: Date, required: true, default: Date.now }
}, { timestamps: true, versionKey: 'version', collection: 'AttendanceRecords', strict: 'throw' });

attendanceRecordSchema.index({ sessionId: 1, studentId: 1 }, { unique: true, name: 'attendance_session_student_unique' });
attendanceRecordSchema.index({ sessionId: 1, totalSeconds: -1 }, { name: 'attendance_session_total_seconds' });
attendanceRecordSchema.index({ studentId: 1, courseId: 1, updatedAt: -1 }, { name: 'attendance_student_course_updated' });

export const AttendanceRecord = mongoose.model('AttendanceRecord', attendanceRecordSchema);
