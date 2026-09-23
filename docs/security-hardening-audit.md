# Security review

Reviewed against the code that actually runs: `backend/` (Express + PostgreSQL), 104 route handlers, one JWT middleware chain. Findings carry `file:line` evidence. Nothing in this document is inherited from earlier audits of the removed MongoDB services.

**Posture: appropriate for local development and private demos. Not ready for a hostile network.**

## Access-control baseline

Auth coverage is genuinely broad: only four of the 104 handlers are reachable without authentication — `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh` (`auth.js:58,104,154`) and `GET /courses/categories` (`courses.js:70`, a static list). Role gates appear across roughly 50 handlers via `requireRoles`.

Token handling is the strongest part of the system: passwords are bcrypt hashes; refresh tokens are stored only as hashes with `family_id` and `jti`, rotated on use, and a replayed spent token revokes the entire family (`auth.js:174-205`).

The gaps below are all in **per-record authorization** — the middleware proves *who* you are and *what role* you hold, but most handlers never check whether the row in question is yours.

## Critical

### 1. AI quizzes return the answer key to the student

`generateQuizHandler` builds each question with `correct_answer` and `correctIndex` and returns the full array to the caller (`data.js:310-311`, response at `data.js:319`). The client that renders the quiz is the client that receives the answers.

Server-side answers are fine; sending them before grading is not. Split the response into a student-facing payload (id, question, options) and an instructor/grading payload, or grade server-side against the stored questions.

### 2. Stored assessment questions are exposed without an enrollment check

`GET /agent/quizzes/:id` returns `questions` — the raw `JSONB` bank — for any `course_id`, guarded only by `authenticate` (`data.js:348-356`). Any logged-in student can enumerate course IDs and read the full question set, including whatever answer data an instructor stored in it.

This is not isolated to that one route: `assessments.js` contains **no enrollment check and no course-ownership check anywhere**. Its 17 handlers gate on role only, so `authenticate` plus `instructor` is sufficient to read any course's assessments, submissions, and grading queue regardless of who owns them.

### 3. Quiz scores can be written for any student

`POST /agent/quizzes/results` takes `student_id` from the request body and only falls back to `req.user.id` when absent (`data.js:364`). Any student can record a score for another student, or inflate their own. Accept the authenticated subject only.

### 4. Instructor reads leak learner contact details

`GET /assessments/:id/submissions` selects `u.name, u.email` for every submission of any assessment (`assessments.js:396`) behind role checks alone. Any instructor can therefore harvest the email addresses of learners in courses they do not teach. Scope the query to the caller's own courses and return only the identifiers the grading UI needs.

## High

### 5. Instructors can modify or archive any course

`DELETE /data/projects/:id` applies `requireRoles('instructor', 'admin')` and then archives by ID with no owner comparison (`data.js:52-56`). `courses.js:262` does perform the admin-or-owner comparison before deleting, which is the correct pattern; it is simply absent here. A non-owner instructor can archive any course in the system.

### 6. Uploaded documents are world-readable

`app.use('/uploads', express.static(...))` is mounted before any authentication (`server.js:34`). Files land at a guessable name — `document_${Date.now()}_${originalname}` (`data.js:114`) — so uploaded student documents are retrievable by an unauthenticated request that knows or brute-forces a filename. Serve uploads through an authorized route and store an unguessable key instead of a timestamp.

### 7. Cross-origin requests are accepted from any origin with credentials

`app.use(cors({ origin: true, credentials: true }))` (`server.js:30`) reflects whatever `Origin` header arrives and permits cookies. Combined with a bearer token in `localStorage`, this widens the blast radius of any XSS. Replace with an explicit allow-list from configuration; wildcard-plus-credentials is never correct.

### 8. No rate limiting, no `helmet`

No request throttling exists anywhere, including `/auth/login`, which is anonymous and returns a distinguishable "Invalid email or password" for every miss. Every Groq call — chat, quiz, summary — is also unthrottled, so one authenticated user can drive unbounded paid provider requests. Add `helmet`, an auth-specific limiter, and a per-user limiter on AI routes.

## Medium

### 9. Direct assessment submission awards a perfect score

`POST /assessments/:id/submit` inserts a submission with `grading_status = 'graded'` and `grading_score = 100` without evaluating a single answer (`assessments.js:386`). The scored path is `/attempts/:submissionId/submit`; this fallback should grade or reject rather than grant.

### 10. Draft content is visible to any authenticated user

`GET /data/projects` filters only `status != 'archived'` (`data.js:14-22`), so unpublished drafts appear in the project list with an `is_published` flag. Published-only should be enforced in the query for non-staff callers.

### 11. Provider error text reaches learners and is stored

On a Groq failure the fallback reply embeds raw `llmErr.message` and is written to `chat_messages` as an assistant turn (`data.js:227`). Internal failure detail becomes user-visible, persisted content.

### 12. Raw error objects are logged

`console.error('[Error] ...', err)` prints full stack traces (`errorHandler.js:11`), and Postgres driver messages can carry parameter values. Log `err.name` and `err.code`. See [observability-and-data-handling.md](observability-and-data-handling.md).

### 13. Session deletion is not ownership-checked

`DELETE /agent/session/:id` removes any chat session by ID behind `authenticate` alone (`data.js:251`), so one user can destroy another's history.

## Notes

- **Three mount prefixes.** `mountRouters()` runs for `/v1`, `/api`, and the bare root (`server.js:60-61`), so every finding above is reachable through three URLs at once. This is compatibility surface, not a vulnerability by itself, but it triples the audit surface and any future path-specific protection must be applied three times.
- **The startup log advertises `/v1/health`** as the health check, but the anonymous handler is registered at `/health` (`server.js:37`); `admin/health` is a separate authenticated route.
- **Jitsi join tokens** are signed per room with a bounded lifetime (`meetings.js:305-317`), which is the correct pattern for the rest of the API.
- **Attendance is self-reported** by authenticated client calls, so treat it as informational until verified against Jitsi events ([data-model.md](data-model.md)).

## Recommended order

1. Fix the answer-key and score-forging leaks (#1, #2, #3) — they undermine the grading the platform exists to provide.
2. Add per-record ownership and enrollment checks (#4, #5, #10, #13).
3. Move uploads behind authorization and set an explicit CORS allow-list (#6, #7).
4. Add `helmet` plus rate limiting on auth and AI routes (#8).
5. Correct scoring and error surfacing (#9, #11, #12).
