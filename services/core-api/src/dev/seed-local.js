import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Course } from '../domains/courses/course.model.js';
import { Enrollment } from '../domains/enrollments/enrollment.model.js';
import { Lesson } from '../domains/lessons/lesson.model.js';
import { User } from '../domains/auth/user.model.js';
import { Assessment } from '../domains/assessments/assessment.model.js';
import { LiveSession } from '../domains/live-sessions/live-session.model.js';

const ACCOUNTS = [
  { email: 'admin@local.test', name: 'Local Admin', role: 'admin', password: 'LocalAdmin1234' },
  { email: 'instructor@local.test', name: 'Local Instructor', role: 'instructor', password: 'LocalInstructor1234' },
  { email: 'student@local.test', name: 'Local Student', role: 'student', password: 'LocalStudent1234' }
];

const LESSON_CONTENT = 'REAL_i is an enterprise multi-agent learning platform. Core API is the only public API. The AI tutor Raaed answers from ingested course material. Students enroll in published courses, complete lessons, take assessments, and join live classroom sessions.';

function hashedEmbedding(text, dimensions) {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const token of tokens) {
    const digest = crypto.createHash('md5').update(token).digest();
    const index = digest.readUInt32LE(0) % dimensions;
    vector[index] += digest[4] % 2 === 0 ? 1 : -1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

export async function seedLocalUsers(logger) {
  const users = {};
  for (const account of ACCOUNTS) {
    let user = await User.findOne({ email: account.email, deletedAt: null });
    if (!user) {
      user = await User.create({
        email: account.email,
        name: account.name,
        role: account.role,
        passwordHash: await bcrypt.hash(account.password, 12)
      });
      logger.info({ email: account.email, role: account.role }, 'Seeded local development user');
    }
    users[account.role] = user;
  }

  const title = 'REAL_i Local Demo Course';
  let course = await Course.findOne({ title, instructorId: users.instructor._id });
  if (!course) {
    course = await Course.create({
      title,
      description: 'A published sample course so local login, catalog, and enrollment have something to show.',
      category: 'Getting Started',
      difficulty: 'beginner',
      pricing: { access: 'free', currency: null, amount: null },
      instructorId: users.instructor._id,
      status: 'published',
      enrollmentOpen: true,
      publishedAt: new Date()
    });
    await Lesson.create({
      courseId: course._id,
      title: 'Welcome to REAL_i',
      content: LESSON_CONTENT,
      position: 1,
      status: 'published',
      publishedAt: new Date()
    });
    logger.info({ courseId: String(course._id) }, 'Seeded local demo course');
  }

  const enrolled = await Enrollment.findOne({ studentId: users.student._id, courseId: course._id, status: 'enrolled' });
  if (!enrolled) {
    await Enrollment.create({ studentId: users.student._id, courseId: course._id, status: 'enrolled' });
    logger.info({ courseId: String(course._id) }, 'Enrolled local student in demo course');
  }

  if (!await Assessment.findOne({ courseId: course._id, title: 'Getting Started Quiz' })) {
    await Assessment.create({
      courseId: course._id,
      authorId: users.instructor._id,
      title: 'Getting Started Quiz',
      instructions: 'Answer from the welcome lesson.',
      status: 'published',
      timeLimitSeconds: 600,
      randomizeQuestions: false,
      maxAttempts: 3,
      publishedAt: new Date(),
      questions: [
        { id: 'q1', type: 'mcq', prompt: 'What is the only public API in REAL_i?', options: [{ id: 'a', text: 'The AI service' }, { id: 'b', text: 'Core API' }, { id: 'c', text: 'MongoDB' }, { id: 'd', text: 'Jitsi' }], correctOptionIds: ['b'], points: 1, rubric: [] },
        { id: 'q2', type: 'true_false', prompt: 'Raaed answers only from ingested course material.', options: [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }], correctOptionIds: ['true'], points: 1, rubric: [] }
      ]
    });
    logger.info({ courseId: String(course._id) }, 'Seeded local demo assessment');
  }

  if (!await LiveSession.findOne({ courseId: course._id, title: 'REAL_i Live Orientation' })) {
    const startsAt = new Date();
    await LiveSession.create({
      courseId: course._id,
      hostId: users.instructor._id,
      provider: 'jitsi',
      providerRoomId: 'reali-local-orientation',
      title: 'REAL_i Live Orientation',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000),
      status: 'live'
    });
    logger.info({ courseId: String(course._id) }, 'Seeded local live session');
  }

  const chunks = mongoose.connection.collection('AIVectorChunks');
  if (!await chunks.findOne({ courseId: String(course._id), documentId: 'welcome-lesson' })) {
    const embedding = hashedEmbedding(LESSON_CONTENT, 1536);
    await chunks.insertOne({
      _id: new mongoose.Types.ObjectId(),
      courseId: String(course._id),
      documentId: 'welcome-lesson',
      sourceTitle: 'Welcome to REAL_i',
      ordinal: 0,
      content: LESSON_CONTENT,
      embedding,
      createdAt: new Date()
    });
    logger.info({ courseId: String(course._id) }, 'Seeded local AI course chunks');
  }
}
