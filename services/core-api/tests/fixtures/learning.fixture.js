import { Course } from '../../src/domains/courses/course.model.js';
import { Lesson } from '../../src/domains/lessons/lesson.model.js';
import { Submission } from '../../src/domains/submissions/submission.model.js';
import { LiveSession } from '../../src/domains/live-sessions/live-session.model.js';
import { Poll } from '../../src/domains/polls/poll.model.js';
import { AIGuideline } from '../../src/domains/ai-guidelines/ai-guideline.model.js';
import { Enrollment } from '../../src/domains/enrollments/enrollment.model.js';
import { PollResponse } from '../../src/domains/poll-responses/poll-response.model.js';
import { User } from '../../src/domains/auth/user.model.js';

export async function seedLearningFixture() {
  const [instructor, student] = await User.create([
    { name: 'Instructor One', email: 'instructor@example.test', passwordHash: 'x'.repeat(60), role: 'instructor' },
    { name: 'Student One', email: 'student@example.test', passwordHash: 'x'.repeat(60), role: 'student' }
  ]);
  const course = await Course.create({ title: 'Applied Algebra', description: 'A foundational algebra course.', instructorId: instructor._id, status: 'published', publishedAt: new Date('2026-01-01') });
  const lesson = await Lesson.create({ courseId: course._id, title: 'Linear equations', content: 'Solve for x.', position: 1, status: 'published' });
  const submission = await Submission.create({ studentId: student._id, courseId: course._id, lessonId: lesson._id, attemptNumber: 1, submissionType: 'short_answer', responses: [{ questionId: 'q-1', value: 'x = 4' }] });
  const liveSession = await LiveSession.create({ courseId: course._id, hostId: instructor._id, providerRoomId: 'real-i-algebra-room', title: 'Office hours', startsAt: new Date('2026-02-01T10:00:00Z'), endsAt: new Date('2026-02-01T11:00:00Z') });
  const poll = await Poll.create({ sessionId: liveSession._id, courseId: course._id, createdBy: instructor._id, question: 'Ready to continue?', responseType: 'single_choice', options: [{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }] });
  const enrollment = await Enrollment.create({ studentId: student._id, courseId: course._id });
  const pollResponse = await PollResponse.create({ pollId: poll._id, sessionId: liveSession._id, courseId: course._id, studentId: student._id, optionKeys: ['yes'] });
  const guideline = await AIGuideline.create({ scope: 'course', courseId: course._id, version: 1, status: 'active', content: 'Use Socratic prompts before hints.', createdBy: instructor._id, activatedAt: new Date() });
  return { instructor, student, course, lesson, submission, liveSession, poll, enrollment, pollResponse, guideline };
}
