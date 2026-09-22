import crypto from 'node:crypto';
import { AppError, forbidden } from '../../shared/errors.js';
import { safeErrorMetadata } from '../../shared/safe-error.js';

const str = (value) => String(value);
const shuffled = (items) => { const copy = [...items]; for (let i = copy.length - 1; i > 0; i -= 1) { const j = crypto.randomInt(i + 1); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; };
const studentQuestions = (submission) => submission.questionOrder.map((id) => submission.questionSnapshot.find((question) => question.id === id)).map(({ id, type, prompt, options, points, rubric }) => ({ id, type, prompt, options, points, ...(type === 'essay' ? { rubric } : {}) }));
const attemptView = (submission) => ({ id: str(submission._id), assessmentId: str(submission.assessmentId), attemptNumber: submission.attemptNumber, attemptStatus: submission.attemptStatus, startedAt: submission.startedAt, expiresAt: submission.expiresAt, submittedAt: submission.submittedAt, questions: studentQuestions(submission), responses: submission.responses, grading: submission.grading ? { status: submission.grading.status, score: submission.grading.score, feedback: submission.grading.feedback, gradedAt: submission.grading.gradedAt } : undefined });

function grade(snapshot, responses) {
  const answerByQuestion = new Map(responses.map((item) => [item.questionId, item.value]));
  let earned = 0; let total = 0; let needsManual = false;
  for (const question of snapshot) { total += question.points; if (['mcq', 'true_false'].includes(question.type)) { if (answerByQuestion.get(question.id) === question.correctOptionIds[0]) earned += question.points; } else needsManual = true; }
  return { status: needsManual ? 'manual_review' : 'auto_graded', score: total ? Math.round((earned / total) * 10000) / 100 : 0, gradedAt: new Date() };
}

export function createAssessmentService({ repo, logger = { info() {}, error() {} }, now = () => new Date(), transaction = async (work) => work(), notificationDispatcher = null }) {
  const owner = async (actor, courseId) => { const course = await repo.course(courseId); if (!course) throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.'); if (actor.role !== 'admin' && str(course.instructorId) !== str(actor.userId)) throw forbidden(); return course; };
  const activeStudent = async (actor, courseId) => { const course = await repo.course(courseId); if (!course || course.status !== 'published' || !await repo.activeEnrollment(actor.userId, courseId)) throw forbidden(); };
  const finish = async (submission, status, options = {}) => { const reason = options.reason ?? (status === 'timed_out' ? 'timeout' : status === 'finalized_due_date' ? 'due_date' : status === 'finalized_eligibility_lost' ? 'eligibility_lost' : 'manual_submit'); const claimed = await repo.claimCompletion(submission._id, status, now(), { ...options, reason }); if (!claimed) return repo.attemptForStudent(submission._id, submission.studentId); const grading = grade(claimed.questionSnapshot, claimed.responses); const graded = await repo.setGrading(claimed._id, grading, options.session); logger.info({ event: reason === 'eligibility_lost' ? 'assessment_eligibility_finalized' : reason === 'due_date' ? 'assessment_deadline_finalized' : status === 'timed_out' ? 'assessment_auto_submitted' : 'assessment_submitted', assessmentId: str(graded.assessmentId), submissionId: str(graded._id), studentId: str(graded.studentId), gradingStatus: grading.status, finalizationReason: reason }, 'Assessment attempt completed'); return graded; };
  const expire = async (submission) => submission.attemptStatus === 'in_progress' && submission.expiresAt <= now() ? finish(submission, submission.expirationReason === 'due_date' ? 'finalized_due_date' : 'timed_out') : submission;
  return {
    async list(actor, query = {}) {
      const filter = {};
      if (query.courseId || query.course_id) filter.courseId = query.courseId || query.course_id;
      if (query.status) filter.status = query.status;
      if (actor.role === 'student') {
        const enrolled = await repo.enrolledCourseIds(actor.userId);
        filter.courseId = filter.courseId ? filter.courseId : { $in: enrolled };
        filter.status = 'published';
      } else if (actor.role === 'instructor') {
        filter.authorId = actor.userId;
      }
      const items = await repo.list(filter);
      return items.map((item) => ({
        id: str(item._id),
        title: item.title,
        status: item.status,
        type: 'quiz',
        courseId: str(item.courseId),
        course_id: str(item.courseId),
        startDate: item.availableFrom,
        start_date: item.availableFrom,
        dueAt: item.dueAt,
        due_date: item.dueAt,
        timeLimitSeconds: item.timeLimitSeconds,
        maxAttempts: item.maxAttempts,
        instructions: item.instructions
      }));
    },
    async create(actor, input) { await owner(actor, input.courseId); const status = input.status ?? 'draft'; return repo.create({ ...input, authorId: actor.userId, status, ...(status === 'published' ? { publishedAt: now() } : {}) }); },
    async update(actor, assessmentId, input) { const assessment = await repo.byIdWithKey(assessmentId); if (!assessment) throw new AppError(404, 'ASSESSMENT_NOT_FOUND', 'Assessment not found.'); await owner(actor, assessment.courseId); if (assessment.status !== 'draft') throw new AppError(409, 'ASSESSMENT_LOCKED', 'Published assessments are immutable; create a new draft version.'); return repo.updateDraft(assessmentId, { ...input, ...(input.status === 'published' ? { publishedAt: now() } : {}) }); },
    async start(actor, assessmentId) { if (actor.role !== 'student') throw forbidden(); const assessment = await repo.byIdWithKey(assessmentId); if (!assessment || assessment.status !== 'published') throw new AppError(404, 'ASSESSMENT_NOT_FOUND', 'Assessment not found.'); const startedAt = now(); if ((assessment.availableFrom && new Date(assessment.availableFrom) > startedAt) || (assessment.dueAt && new Date(assessment.dueAt) <= startedAt)) throw new AppError(409, 'ASSESSMENT_NOT_AVAILABLE', 'This assessment is not currently available.'); await activeStudent(actor, assessment.courseId); const existing = await repo.latestInProgress(actor.userId, assessmentId); if (existing) return attemptView(await expire(existing)); const completed = await repo.completedCount(actor.userId, assessmentId); if (completed >= assessment.maxAttempts) throw new AppError(409, 'ATTEMPT_LIMIT_REACHED', 'No attempts remain for this assessment.'); const snapshot = assessment.questions.map((question) => question.toObject ? question.toObject() : question); const order = assessment.randomizeQuestions ? shuffled(snapshot.map((question) => question.id)) : snapshot.map((question) => question.id); const timeLimitExpiresAt = new Date(startedAt.getTime() + assessment.timeLimitSeconds * 1000); const dueAt = assessment.dueAt ? new Date(assessment.dueAt) : null; const expirationReason = dueAt && dueAt < timeLimitExpiresAt ? 'due_date' : 'time_limit'; const expiresAt = expirationReason === 'due_date' ? dueAt : timeLimitExpiresAt; try { const attempt = await repo.createAttempt({ studentId: actor.userId, courseId: assessment.courseId, assessmentId, kind: 'assessment', attemptNumber: completed + 1, submissionType: 'mcq', responses: [], startedAt, expiresAt, expirationReason, attemptStatus: 'in_progress', questionOrder: order, questionSnapshot: snapshot, submittedAt: null }); logger.info({ event: 'assessment_started', assessmentId: str(assessmentId), submissionId: str(attempt._id), studentId: str(actor.userId) }, 'Assessment attempt started'); return attemptView(attempt); } catch (error) { if (error?.code === 11000) return attemptView(await repo.latestInProgress(actor.userId, assessmentId)); throw error; } },
    async getAttempt(actor, submissionId) { if (actor.role !== 'student') throw forbidden(); const attempt = await repo.attemptForStudent(submissionId, actor.userId); if (!attempt) throw new AppError(404, 'ATTEMPT_NOT_FOUND', 'Assessment attempt not found.'); await activeStudent(actor, attempt.courseId); return attemptView(await expire(attempt)); },
    async save(actor, submissionId, responses) { if (actor.role !== 'student') throw forbidden(); const current = await repo.attemptForStudent(submissionId, actor.userId); if (!current) throw new AppError(404, 'ATTEMPT_NOT_FOUND', 'Assessment attempt not found.'); await activeStudent(actor, current.courseId); const checked = await expire(current); if (checked.attemptStatus !== 'in_progress') throw new AppError(409, 'ATTEMPT_CLOSED', 'This attempt has already been submitted.'); const allowed = new Set(checked.questionOrder); if (responses.some((item) => !allowed.has(item.questionId))) throw new AppError(400, 'INVALID_ANSWER', 'Response contains an unknown question.'); const saved = await repo.saveAnswers(submissionId, actor.userId, responses, now()); if (!saved) return attemptView(await expire(await repo.attemptForStudent(submissionId, actor.userId))); return attemptView(saved); },
    async submit(actor, submissionId) { if (actor.role !== 'student') throw forbidden(); const attempt = await repo.attemptForStudent(submissionId, actor.userId); if (!attempt) throw new AppError(404, 'ATTEMPT_NOT_FOUND', 'Assessment attempt not found.'); await activeStudent(actor, attempt.courseId); return attemptView(await expire(attempt).then((current) => current.attemptStatus === 'in_progress' ? finish(current, 'submitted') : current)); },
    async processExpired() { const expired = await repo.expired(now()); await Promise.all(expired.map(async ({ _id }) => { const attempt = await repo.attemptForStudent(_id, undefined); if (attempt) await expire(attempt); })); return expired.length; },
    async finalizeEligibilityLoss({ courseId, studentId, session }) { const attempts = await repo.inProgressForEligibility(courseId, studentId, session); await Promise.all(attempts.map((attempt) => finish(attempt, 'finalized_eligibility_lost', { force: true, reason: 'eligibility_lost', session }))); return attempts.length; },
    async queue(actor, courseId) { await owner(actor, courseId); return repo.queue(courseId); },
    async grade(actor, submissionId, grading) { const submission = await repo.attemptForStudent(submissionId, undefined); if (!submission) throw new AppError(404, 'ATTEMPT_NOT_FOUND', 'Assessment attempt not found.'); await owner(actor, submission.courseId); if (submission.grading?.status !== 'manual_review') throw new AppError(409, 'NOT_IN_GRADING_QUEUE', 'This submission is not awaiting manual review.'); try { return await transaction(async (session) => { const graded = await repo.claimManualGrade(submissionId, { status: 'graded', score: grading.score, feedback: grading.feedback ?? null, gradedBy: actor.userId, gradedAt: now() }, session); if (!graded) throw new AppError(409, 'NOT_IN_GRADING_QUEUE', 'This submission is not awaiting manual review.'); if (notificationDispatcher) await notificationDispatcher.assessmentGraded({ recipientId: graded.studentId, courseId: graded.courseId, assessmentId: graded.assessmentId, submissionId: graded._id, session }); return graded; }); } catch (error) { logger.error({ ...safeErrorMetadata(error), event: 'assessment_grade_notification_failed', submissionId: String(submissionId) }, 'Assessment grade transaction failed'); throw error; } }
  };
}
