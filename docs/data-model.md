# Data model and query-index plan

`Courses` references its instructor; `Lessons` references a course; `Submissions` references student, course, and lesson; `LiveSessions` references course and host; `Polls` references session and course; `PollResponses` references poll, session, course, and student; `Enrollments` references student and course; and `AIGuidelines` is global or course-scoped. References use MongoDB ObjectIds and Mongoose `ref` metadata.

Lessons and submissions are deliberately separate collections: both grow independently and support cross-course dashboard/KPI queries. Enrollment is a separate collection so both the course-access gatekeeper (`studentId`, `courseId`, `status`) and student dashboard/roster reads are indexed without unbounded arrays. Poll definitions and responses are separate collections from sessions: one immutable response document per student/poll avoids hot-document contention, and `{ pollId, optionKeys }` supports real-time tally reads. Votes are single-submit; revoting needs an explicit future replace/version policy.

Named indexes are declared in each model. They serve the actual reads: instructor/published course listings; ordered course lessons; student history and grading queues; course/host session calendars; per-session poll lists; and guideline scope/version and active-resolution queries. Unique indexes protect lesson positions, submission attempts, provider rooms, and guideline versions/active state.

Course and lesson `status` are the visibility fields: only `published` data reaches public catalog/read serializers. Course catalog filtering uses optional `category` and `difficulty` fields plus the `course_catalog_filters` named index. Pricing stores only the display access/currency/amount in this scope; payment rules are not modeled.

`Courses.enrollmentOpen` is distinct from archival. Setting it to `false` prevents future enrollment creation (to be enforced by the enrollment write service when introduced) while preserving access for existing active enrollments; `archived` remains an immediate access cutoff.

`Assessments` embeds up to 200 structured questions because builder, serving, and grading-key reads are assessment-local. Published assessments are immutable. Assessment attempts extend `Submissions` with `assessmentId`, immutable start/expiry timestamps, stable randomized `questionOrder`, and a private grading snapshot. The private snapshot allows grading against the exact delivered version after future assessment changes. Named indexes support course assessment listings and `(studentId, assessmentId)` attempt lookup/uniqueness.

Assessment attempt status is authoritative: `in_progress`, `submitted`, `timed_out`, `finalized_due_date`, or `finalized_eligibility_lost`. `timed_out` is reserved for per-attempt time-limit expiry; `finalized_due_date` is reserved for an assessment deadline that cuts the allotted time short. Each assessment attempt retains an immutable `expirationReason` (`time_limit` or `due_date`), and `finalizationReason` (`manual_submit`, `timeout`, `due_date`, or `eligibility_lost`) supplements the terminal status for dispute reconstruction. Course archival and enrollment drop transactionally force-finalize matching in-progress attempts as `finalized_eligibility_lost`, using the snapshot for automated grading; they do not wait for client reconnection or timer expiry.

`AttendanceRecords` is one bounded reconnect-interval document per session/student, replacing the active write path for the legacy embedded LiveSession attendance field. Its unique session/student index supports idempotent joins, and session-total ordering supports the instructor roster. `LiveSessions.summaryStatus` is a pending placeholder only; no AI summary generation occurs until the AI service step.

Live poll tally is a pull endpoint backed by the named `poll_response_tally_by_option` index. Server push (SSE/WebSocket) is not part of the current transport and must be added explicitly if sub-second UI updates are required.

## Attendance authenticity decision

Attendance is currently self-reported through authenticated client calls by the enrolled application user; it is not verified against Jitsi connection events. This is accepted for the current phase because attendance is informational only. Revisit and replace it with a configured, signed Jitsi event/webhook integration before attendance is used for any real-stakes purpose, including grade weighting, compliance reporting, or certificate eligibility.

The partial unique enrollment index permits only one active (`enrolled`) record for a student/course pair while retaining dropped/completed history. A later re-enrollment creates a new record after the prior active record is dropped or completed.

## Calendar, notifications, and analytics

`CalendarEvents` stores bounded administrator-authored platform events. An event is either global or course-scoped, never both; range queries combine those events with published assessment deadlines and scheduled/live sessions. Calendar is a pull API in this phase. Students receive only global events and content from their currently active, published-course enrollments; instructors receive global events and their own course content; administrators receive all content.

`Notifications` stores recipient-owned delivery records. The initial types are assessment-grade completion, calendar reminder, and system notification. Grade-completion delivery is written inside the manual-grade transaction, keyed by submission so a retry cannot duplicate it. Payloads hold identifiers only, never feedback, essay text, or other assessment content. Recipient/read-time ordering supports the inbox; the recipient/deduplication partial unique index makes delivery idempotent.

KPIs are aggregation reads, not stored counters: active learners are distinct active enrollments, completion rate is completed divided by enrolled-plus-completed enrollment records, assessment average uses finalized scored assessment attempts, and enrollment trends group enrollment timestamps by UTC day. Instructors are scoped to their owned courses; administrators are platform-wide; students have no KPI access. Revenue is deliberately returned as `{ notAvailable: true }`: pricing metadata is not a payment ledger, so no revenue estimate is made until a payment/transaction model is explicitly introduced.

## AI retrieval material and rollout decisions

`AIVectorChunks` is an AI-service-owned collection. Each document carries a bounded course-material chunk, its source `documentId`/title/ordinal attribution, and an embedding. The unique named compound index on `(courseId, documentId, ordinal)` makes ingestion replacement idempotent; a MongoDB Atlas Search vector index named by `MONGODB_VECTOR_INDEX` must use the configured embedding dimension and cosine similarity, with `courseId` configured as a filter field. `AIGuidelines` remains the existing shared collection; the AI service may create draft guidelines, while active guideline reads inject the global and course-scoped records.

### AI quota decision

The AI service enforces configurable document limits plus `MAX_CHUNKS_PER_COURSE` across stored chunks. The current `MAX_CHUNKS_PER_COURSE=10000` and `AI_CHAT_RATE_LIMIT_PER_MINUTE=10` are deliberately conservative placeholders, not production capacity decisions. The latter is enforced through a shared Mongo-backed actor/minute counter so it is not multiplied by AI-service replicas. Before production rollout, choose evidence-based course-material and chat-rate values, record them in deployment configuration, and test them under expected ingestion and tutoring traffic; do not silently retain the development defaults.

### Vector-search production parity decision

Automated retrieval tests use a deterministic in-memory cosine repository because the real-Mongo test replica does not implement Atlas `$vectorSearch`. This validates chunking, course filtering, ranking logic, citation attribution, and agent grounding flow, but does not prove Atlas index configuration or production retrieval quality. Before production rollout, a smoke test against an actual Atlas/vector-search-capable instance is mandatory: ingest known materials, query with known embeddings, verify the configured index/filter/dimension, and confirm returned citations map to the expected chunks.
