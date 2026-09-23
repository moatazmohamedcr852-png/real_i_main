# AI tutor and generated quizzes

Three Groq-backed capabilities ship today: the conversational tutor, on-demand quiz generation, and post-lecture summaries. All call the Groq Chat Completions API directly from `backend/routes/` — there is no separate AI service, no queue, and no vector store.

**Model:** `qwen/qwen3.8-27b`, hardcoded at three call sites (`backend/routes/data.js:217`, `data.js:291`, `backend/routes/meetings.js:547`). Extract to configuration before changing providers.

**Key:** `GROQ_API_KEY` in `backend/.env`. Requests come from the server; the key never reaches the browser.

## Chat — `POST /v1/courses/:courseId/ai/chat`

Also mounted as `POST /v1/agent/chat/:courseId`, which is the fallback the compiled client retries.

1. A missing `session_id` creates a `chat_sessions` row scoped to the user and course.
2. The learner's message is written to `chat_messages`.
3. Context is assembled from the **10 most recent messages** in that session plus a system prompt naming the course's `title` and `description`.
4. The reply is persisted and returned under `session_id`, `content`, `message`, **and** `response`.

That last point is a real constraint, not redundancy: the student and admin chat screens read different keys off the same response. `StudentChat` renders `response`, `AdminChat` renders `message`. A response shape that drops either field silently renders empty bubbles on one screen.

`courseId` is validated against a UUID pattern before touching Postgres (`safeCourseId` in `data.js`). Without it a non-UUID value from the client reaches a `UUID` column and Postgres aborts with `22P02`, surfacing to the user as "Invalid identifier syntax".

Every Groq call sends at least one `user`-role message. A system-only `messages` array is rejected by Groq with *"No user query found in messages"* — the quiz generator hit exactly this and is written to avoid it.

## Quizzes — `POST /v1/courses/:courseId/ai/quizzes`

Also `POST /v1/agent/quiz/:courseId`. Takes a `topic` and `count`, asks for a fixed JSON shape, and requests `response_format: { type: 'json_object' }` at `temperature: 0.5`.

Parsing is defensive because model output is not a contract: the response is accepted as a bare array or a `questions` key, truncated to the requested count, and each question is normalized to four options with a resolved `correctIndex` and an explanation. Unparseable output throws rather than returning a half-built quiz.

Generated quizzes are **not persisted** as `assessments`. They are transient, and answers are recorded separately in `quiz_results` under a free-text `task_id`.

## Lecture summaries — end-of-session

Ending a live session generates a summary through Groq and writes it to `live_sessions.ai_summary` with `summary_status` (`pending` → `ready` / `failed`).

## What is not implemented

Despite the wording in the frontend and the API surface, **there is no retrieval-augmented generation**:

| Endpoint | Advertises | Actually does |
| --- | --- | --- |
| `POST /v1/data/process/:courseId` | `processed_files: 1, inserted_chunks: 12` | Returns constants; reads nothing |
| `POST /v1/courses/:courseId/ai/materials` | Ingests teaching material | Same constants, shared handler |
| `POST /v1/nlp/index/push/:id` | `inserted_items_count: 12` | Returns a constant |
| `POST /v1/upload`, `/data/upload/:id` | Document ingestion | Writes a file to `backend/uploads/` and a `data_assets` row |

No chunking, no embeddings, no vector column, no similarity search. Uploaded PDFs are never opened. The tutor's entire course awareness is one title and one description string.

Building this for real needs four additions that do not exist yet: a chunk table with embeddings (a `vector` column via `pgvector`, or an external vector store), an embedding call at upload time, top-k retrieval injected into the chat context, and a replacement of those stub handlers with work that reports what it actually did.

## Known issues

- **Provider errors reach learners verbatim.** On a Groq failure, the fallback text embeds raw `llmErr.message` and is *persisted* to `chat_messages` as an assistant turn, so internal error strings are both displayed and stored.
- **Guidelines never reach the model.** `ai_guidelines` is stored and served by `GET /v1/agent/guidelines/active/:id`, but no chat, quiz, or summary handler reads it. Instructor directives therefore have no server-side effect on generation.
- **Prompt injection is unmitigated.** Course descriptions are interpolated into the system prompt, and learner messages are untrusted content, with no delimiter or instruction-override handling.
- **No output filtering or rate limiting**, so one authenticated user can drive unbounded paid provider calls.
- **No citations.** Answers cannot be traced to material, which matters once real course documents are in play.
