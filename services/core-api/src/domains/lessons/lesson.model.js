import mongoose from 'mongoose';

const { Schema } = mongoose;

const lessonSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, immutable: true },
  title: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
  content: { type: String, required: true, minlength: 1, maxlength: 100000 },
  position: { type: Number, required: true, min: 1, max: 100000 },
  status: { type: String, enum: ['draft', 'published', 'archived'], required: true, default: 'draft' },
  publishedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: 'version', collection: 'Lessons' });

lessonSchema.index({ courseId: 1, position: 1 }, { unique: true, name: 'lesson_course_position_unique' });
lessonSchema.index({ courseId: 1, status: 1, position: 1 }, { name: 'lesson_course_status_position' });

export const Lesson = mongoose.model('Lesson', lessonSchema);
