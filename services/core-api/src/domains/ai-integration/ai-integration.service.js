import { AppError, forbidden } from '../../shared/errors.js';
import { assessmentInput } from '../assessments/assessment.schemas.js';

const value = (id) => String(id);

export function createAiIntegrationService({ repo, client, assessmentService, config }) {
  const ownedCourse = async (actor, courseId) => {
    const course = await repo.course(courseId);
    if (!course) throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
    if (actor.role !== 'admin' && value(course.instructorId) !== value(actor.userId)) throw forbidden();
    return course;
  };
  const enrolledCourse = async (actor, courseId) => {
    const course = await repo.course(courseId);
    if (!course || course.status !== 'published' || !await repo.activeEnrollment(actor.userId, courseId)) throw forbidden();
    return course;
  };
  const call = (actor, course, scopes, path, body, requestId, timeoutMs) => client.request({ actor, courseId: course._id, scopes, path, body, requestId, timeoutMs });
  return {
    async ingest(actor, courseId, input, requestId) {
      const course = await ownedCourse(actor, courseId);
      return call(actor, course, ['ai:ingest'], '/internal/ingest', { course_id: value(course._id), document_id: input.documentId, source_title: input.sourceTitle, content: input.content }, requestId, config.AI_INGEST_TIMEOUT_MS);
    },
    async chat(actor, courseId, input, requestId) {
      const course = await enrolledCourse(actor, courseId);
      const ai = await call(actor, course, ['ai:tutor'], '/internal/raaed/chat', { course_id: value(course._id), message: input.message, top_k: input.topK }, requestId, config.AI_CHAT_TIMEOUT_MS);
      return { ...ai, answer: ai?.answer, response: ai?.answer, citations: ai?.citations || [], session_id: requestId };
    },
    async generateQuiz(actor, courseId, input, requestId) {
      const course = await ownedCourse(actor, courseId);
      const ai = await call(actor, course, ['ai:quiz'], '/internal/quiz/generate', { course_id: value(course._id), topic: input.topic, count: input.count }, requestId, config.AI_QUIZ_TIMEOUT_MS);
      const parsed = assessmentInput.safeParse({ courseId: value(course._id), title: input.title, instructions: input.instructions, status: 'draft', timeLimitSeconds: input.timeLimitSeconds, randomizeQuestions: input.randomizeQuestions, maxAttempts: input.maxAttempts, dueAt: input.dueAt, availableFrom: input.availableFrom, questions: ai?.questions });
      if (!parsed.success) throw new AppError(502, 'INVALID_AI_ASSESSMENT', 'AI service returned an invalid assessment.');
      return assessmentService.create(actor, parsed.data);
    },
    async directive(actor, courseId, input, requestId) {
      const course = await ownedCourse(actor, courseId);
      return call(actor, course, ['ai:guidelines'], '/internal/admin/guidelines', { scope: 'course', course_id: value(course._id), directive: input.directive }, requestId, config.AI_DIRECTIVE_TIMEOUT_MS);
    }
  };
}
