import mongoose from 'mongoose';

const { Schema } = mongoose;

const lessonProgressSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true, immutable: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, immutable: true },
  completedAt: { type: Date, required: true, default: Date.now }
}, { timestamps: true, versionKey: 'version', collection: 'LessonProgress', strict: 'throw' });

lessonProgressSchema.index({ userId: 1, lessonId: 1 }, { unique: true, name: 'lesson_progress_user_lesson_unique' });
lessonProgressSchema.index({ userId: 1, courseId: 1 }, { name: 'lesson_progress_user_course' });

export const LessonProgress = mongoose.model('LessonProgress', lessonProgressSchema);
