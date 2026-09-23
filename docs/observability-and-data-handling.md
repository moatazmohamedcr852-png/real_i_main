# Observability and sensitive-data handling

One process, one boundary: `backend/` serves the API and the static frontend. Everything below is the policy this project should follow; the **current state** section records where it does not yet.

## Current state

| Concern | Reality today |
| --- | --- |
| Request logging | `morgan('dev')` in `server.js:31` — plain text, human-oriented |
| Correlation IDs | None. No `x-request-id` is generated, forwarded, or logged |
| Error logging | `errorHandler.js:11` passes the **raw error object** to `console.error` |
| Structured logging | None — no logger abstraction, no JSON output, no redaction layer |
| Metrics | None; `GET /health` and `GET /v1/admin/health` are the only liveness signals |

Two concrete consequences to fix first:

1. **`morgan` logs full request URLs including query strings.** Any credential passed as a query parameter is written to stdout. Keep tokens in headers and bodies; treat query-string secrets as prohibited.
2. **`console.error(..., err)` prints stack traces and any message a driver attached.** A Postgres error can carry parameter values, and Groq SDK errors are already echoed into stored chat replies (see [ai-tutor.md](ai-tutor.md)). Log `err.name` and `err.code`, not the object.

## Required trace fields (target)

Each inbound request should receive an `x-request-id`, echoed on the response and included with every log line for that request: service name, route or operation, outcome, latency, and a non-content resource identifier. Correlate on opaque IDs — never on learner names or emails.

## Never log

- **Credentials and secrets:** passwords, password hashes, access or refresh tokens, cookies, refresh-token hashes, `DATABASE_URL`, JWT secrets, `GROQ_API_KEY`, or tokenized Jitsi claims.
- **Educational content:** chat messages and prompts, lesson and course text, assessment questions and answer keys, submitted answers, essay responses, grading feedback, poll free text (`poll_responses.response_text`), AI-guideline content, uploaded document contents, or unredacted model output.
- **Learner profile data:** names, emails, contact details.

## Permitted operational metadata

Request and correlation IDs, opaque database UUIDs, model identifier, status code, error class or code, retry count, token *counts* (never tokens), and latency. Error logs must contain enough to reproduce a class of failure without carrying request bodies or model content.

## Where content legitimately lives

`chat_messages.content`, `submissions.responses`, `poll_responses.response_text`, and `assessments.questions` are stored in PostgreSQL because the product requires them. That is application data under access control — not a licence to repeat it in logs. `notifications.payload` holds identifiers only, never feedback or assessment text.

## Deployment note

Stdout logging behind `morgan` is adequate for local development. Before a real deployment, move to a JSON logger with an explicit allow-list of emitted fields — allow-listing, not deny-listing, so a newly added sensitive field cannot leak by being forgotten. Until that exists, do not pipe this server's stdout into a third-party log aggregation service.
