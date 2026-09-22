# Security hardening audit

Audit performed after Steps 1–6 against the Core API route definitions, service authorization, validation, structured logging, and configuration.

## Route inventory and access controls

- `GET /health` — explicitly anonymous infrastructure status; no data.
- `POST /v1/auth/register` — explicitly anonymous; auth rate limit; strict Zod body.
- `POST /v1/auth/login` — explicitly anonymous; auth rate limit; strict Zod body.
- `POST /v1/auth/refresh` — explicitly anonymous; auth rate limit; strict Zod body.
- `POST /v1/auth/logout` — authenticated; strict empty Zod request; authenticated session owner is revoked.
- `GET /v1/auth/me` — authenticated; service reads only the caller's user record.
- `GET /v1/courses/catalog` — explicitly anonymous; validated filters; published public serializer only.
- `GET /v1/courses/:id` — optional authentication; service permits anonymous published view only, enrolled-student public view, or owner/admin private view.
- `POST /v1/courses` — authenticated instructor/admin; service assigns instructor ownership or permits explicit admin assignment.
- `PATCH /v1/courses/:id` — authenticated instructor/admin; service owner/admin check.
- `DELETE /v1/courses/:id` — authenticated instructor/admin; service owner/admin check and archival policy.
- `POST /v1/courses/:courseId/lessons` — authenticated instructor/admin; service owner/admin check.
- `PATCH /v1/courses/:courseId/lessons/:lessonId` — authenticated instructor/admin; service owner/admin check.
- `GET /v1/courses/:courseId/lessons/:lessonId` — optional authentication; service requires an authenticated enrolled student for published content, or owner/admin.
- `PATCH /v1/courses/:courseId/lessons/:lessonId/reorder` — authenticated instructor/admin; service owner/admin check.
- `DELETE /v1/courses/:courseId/lessons/:lessonId` — authenticated instructor/admin; service owner/admin check.
- `POST /v1/enrollments/:enrollmentId/drop` — authenticated; service restricts to enrolled student, course instructor, or admin.
- `POST /v1/courses/:courseId/assessments` — authenticated instructor/admin; service owner/admin check.
- `PATCH /v1/assessments/:assessmentId` — authenticated instructor/admin; service owner/admin check.
- `POST /v1/assessments/:assessmentId/start` — authenticated student; per-user start limit; service active-enrollment and availability check.
- `GET /v1/attempts/:submissionId` — authenticated student; service attempt-owner and active-enrollment check.
- `PUT /v1/attempts/:submissionId/answers` — authenticated student; per-user mutation limit; service attempt-owner and active-enrollment check.
- `POST /v1/attempts/:submissionId/submit` — authenticated student; per-user mutation limit; service attempt-owner and active-enrollment check.
- `GET /v1/courses/:courseId/grading-queue` — authenticated instructor/admin; service owner/admin check.
- `PATCH /v1/attempts/:submissionId/grade` — authenticated instructor/admin; service owner/admin check.
- `POST /v1/live-sessions` — authenticated instructor/admin; service course owner/admin check.
- `POST /v1/live-sessions/:sessionId/join-token` — authenticated; service permits only enrolled student or host/admin and mints the short-lived room-bound token.
- `POST /v1/live-sessions/:sessionId/attendance/join` — authenticated student; service active-enrollment check.
- `POST /v1/live-sessions/:sessionId/attendance/leave` — authenticated student; service active-enrollment check.
- `GET /v1/live-sessions/:sessionId/attendance` — authenticated instructor/admin; service host/admin check.
- `POST /v1/live-sessions/:sessionId/polls` — authenticated instructor/admin; service host/admin check.
- `POST /v1/live-sessions/:sessionId/polls/:pollId/votes` — authenticated student; per-user vote limit and active-enrollment check.
- `GET /v1/live-sessions/:sessionId/polls/:pollId/tally` — authenticated; service permits only enrolled student or host/admin.
- `GET /v1/calendar` — authenticated; per-user read limit; service scopes to active enrollment, owned courses, or admin.
- `POST /v1/calendar/events` — authenticated admin; service admin check and model-layer course reference validation.
- `GET /v1/analytics/kpis` — authenticated instructor/admin; per-user aggregation limit; service scopes owned courses or all courses.
- `GET /v1/notifications` — authenticated; repository query is constrained by caller `recipientId`.
- `POST /v1/notifications/:notificationId/read` — authenticated; per-user mutation limit and recipient-constrained update.

All 38 mounted routes are intentionally anonymous or authenticate before their handler. No route was found that depended on client-side role filtering.

## Findings fixed

1. Logout lacked an explicit validator. It now rejects non-empty input through the same strict Zod boundary as the remaining auth routes.
2. Assessment start/write, poll vote, calendar/KPI, and notification mutation endpoints lacked targeted throttles. Authenticated per-user limits were added: start 20/15 minutes, attempt writes 240/15 minutes (to support normal autosave), poll votes 10/5 minutes, calendar reads 120/minute, KPIs 30/5 minutes, and notification mutations 60/minute.
3. The centralized error handler and three service/background error paths passed raw `Error` objects to logs. They now log only error name/code plus safe request/resource metadata. This prevents incidental content embedded in an unexpected error from reaching logs.
4. `CORS_ORIGINS` accepted arbitrary strings. It now accepts only non-wildcard absolute HTTP(S) origins without paths. The repository's known development frontend is `http://localhost:5173`; production deployment origins must be supplied explicitly through configuration.

## Rate-limit deployment decision

Rate limiting currently uses process-local `express-rate-limit` stores. This is an explicit, accepted decision for the current single-Core-API-instance deployment only. It is not treated as a distributed security control: each additional API process would maintain a separate counter and multiply the effective limit.

**Mandatory revisit trigger:** before any deployment adds a second Core API replica, enables autoscaling, or otherwise load-balances requests across processes, replace these stores with a shared rate-limit store (for example, Redis) and verify the limits across replicas. Do not ship that horizontal-scaling change until the shared-store migration and its cross-replica tests are complete. Redis is not added in this step because no shared infrastructure is in the approved scope.

## Redaction and secrets

The existing observability policy explicitly covers course/lesson content, assessment questions/answers/feedback, essay and poll free text, guideline content, notification payloads, and calendar descriptions. Logger redaction includes the associated request fields. JWT, Jitsi, and MongoDB values originate only from validated environment configuration; they are not logged. Test-only secrets are isolated in test fixtures.
