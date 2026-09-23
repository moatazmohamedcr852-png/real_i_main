# Data model and index plan

One PostgreSQL database, declared as plain DDL in `backend/db/schema.sql` and applied in a single transaction by `npm --prefix backend run migrate`. 19 tables, 26 indexes.

## Why relational here

The domain is reference-heavy and access-controlled: enrollment gates course reads, attendance and polls belong to a session, submissions belong to a student and an assessment. Foreign keys make those rules declarative instead of a convention every query has to remember. Two Postgres features carry real weight:

- **`JSONB`** for genuinely schema-less payloads — `assessments.questions`, `submissions.responses`, `polls.options`, `attendance_records.intervals`, `live_sessions.settings`, `notifications.payload`. Everything relational is a column; only per-row variable content is JSON.
- **Partial unique indexes** where history must survive. `enrollments` allows one active record per pair but keeps dropped and completed rows; `notifications` deduplicates only when a key is present.

Every primary key is `UUID DEFAULT gen_random_uuid()` from `pgcrypto`. Every table carries `created_at` / `updated_at` as `TIMESTAMPTZ`.

## Entity relationships

```
users ──┬──< courses (instructor_id) ──┬──< lessons
        │                              ├──< enrollments ──> users
        │                              ├──< assessments ──< submissions
        │                              ├──< live_sessions ──┬──< attendance_records ──> users
        │                              │                    └──< polls ──< poll_responses ──> users
        │                              ├──< calendar_events (scope = course)
        │                              └──< data_assets
        ├──< refresh_tokens
        ├──< lesson_progress
        ├──< notifications (recipient_id)
        ├──< chat_sessions ──< chat_messages
        ├──< quiz_results
        └──< ai_guidelines (scope = course)
```

Deleting a course cascades to lessons, enrollments, assessments, sessions, polls, calendar events, and assets. Users are never hard-deleted by this path: `users.deleted_at` is a soft delete and `submissions.student_id` deliberately does not cascade, because a learner's graded work must outlive account removal.

## Visibility and status

`status` on courses, lessons, assessments, and live sessions is the visibility gate: `draft` → `published` → `archived`. Only published rows reach catalog and student-facing reads; archival is the immediate access cutoff and keeps history queryable.

`courses.enrollment_open` is separate from status — `false` blocks new enrollments while existing students retain access.

`assessments.questions` holds the whole bank as `JSONB` because builder, serving, and grading-key reads are always assessment-local. An attempt copies `question_snapshot` at start, so a later edit to the assessment cannot change what a student is graded against. `attempt_status` is authoritative (`in_progress`, `submitted`, `timed_out`, `finalized_due_date`, `finalized_eligibility_lost`) with `expiration_reason` and `finalization_reason` retained for dispute reconstruction.

Submissions cover lesson work and assessment attempts in one table, separated by `kind`, because both feed the same dashboard and grading-queue reads. `max_attempts` is enforced in application code, not the schema.

## Index plan

Indexes exist for reads the routes actually perform:

| Index | Serves |
| --- | --- |
| `idx_courses_published` (partial) | Public catalog, newest first |
| `idx_courses_catalog` | Category and difficulty filtering |
| `idx_courses_instructor` | Instructor's own course list |
| `idx_lessons_course_position` | Ordered lesson playback |
| `idx_enrollment_active` (partial unique) | One active enrollment per student/course |
| `idx_enrollment_student` / `_course` | Student dashboard, course roster |
| `idx_submission_course` | Grading queue by course and grading status |
| `idx_submission_student` | Student attempt history |
| `idx_sessions_course` / `idx_sessions_status` | Course calendar, live-session lookup |
| `attendance_records UNIQUE(session_id, student_id)` | Idempotent join, per-session roster |
| `idx_polls_session` | Live poll list, tally reads |
| `poll_responses UNIQUE(poll_id, student_id)` | One vote per student per poll |
| `idx_ai_guidelines_scope` | Global plus course-scoped active resolution |
| `idx_notifications_recipient_dedup` (partial unique) | Idempotent delivery |
| `idx_chat_messages_session` | Session history in order |
| `quiz_results UNIQUE(student_id, task_id)` | Upsert on retake |

`UNIQUE(course_id, position)` on lessons makes duplicate positions a database error rather than a UI bug; reordering is a guarded update.

## Attendance authenticity — open decision

Attendance is written by authenticated client calls (`/attendance/join`, `/attendance/leave`), not by verified Jitsi connection events. Acceptable while attendance is informational only. **Before it feeds grades, certificates, or compliance reporting, replace it with signed Jitsi webhooks or a meeting-events API**; the reconnect-interval model transfers to a verified source without schema change.

Poll tallies are a pull endpoint. There is no SSE or WebSocket transport, so results update on the client's poll interval, not sub-second.

## KPIs are reads, not counters

Active learners, completion rate, assessment averages, and enrollment trends aggregate live tables — no stored counters to drift. Instructors are scoped to courses they own, admins platform-wide, students get none. Revenue is not modeled: `courses.pricing_*` is display metadata, not a ledger, so no revenue figure is reported.

## Tables that outgrew their original design

- `ai_guidelines` stores versioned instructor/admin directives with global or course scope. They are readable through `GET /v1/agent/guidelines/active/:id`, but no generation path reads them, so they currently shape nothing — see [ai-tutor.md](ai-tutor.md).
- `data_assets` records uploaded files. `file_path` exists but is unused by the upload route, and no chunking or embedding table backs the "processing" endpoints — see [ai-tutor.md](ai-tutor.md).
- `quiz_results` records AI-generated quiz attempts under a free-text `task_id`, a separate path from `submissions`.
