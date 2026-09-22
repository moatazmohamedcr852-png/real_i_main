# Observability and sensitive-data handling

This policy applies to every REAL_i service boundary, including Core API → AI service and AI service → model-provider calls.

## Required trace fields

Each inbound request receives an `x-request-id`. Internal HTTP clients must forward it as `x-request-id`; logs must include it, the service name, route or operation, outcome, latency, and a non-content resource identifier when available. Do not use learner names or emails as correlation fields.

## Never log

- Credentials and secrets: passwords, password hashes, bearer tokens, cookies, refresh-token hashes, MongoDB URIs, service credentials, provider API keys, or tokenized Jitsi claims.
- Educational content: prompts, chat messages, retrieved passages, lesson/course content, calendar-event descriptions, assessment questions and answer keys, assignment/exam answers, auto-saved assessment responses, essay responses, rubric feedback, poll free-text responses (`PollResponses.responseText`), AI-guideline content, uploaded document contents, or unredacted model output.
- Direct learner profile data: names, emails, and contact details.

Structured loggers must redact the named fields in `services/core-api/src/shared/logger.js` (and equivalent fields in the AI service). Redaction is defense in depth, not authorization to attach sensitive payloads to logs.

## Permitted operational metadata

Request/correlation IDs, opaque database IDs where access is controlled, agent name, model identifier, status code, error class/code, retry count, token *counts* (not tokens), chunk count, and latency may be logged. Error logs must contain safe reproduction context without request bodies or model content.

## Boundary rules

Only Core API exposes public endpoints. The AI service accepts authenticated internal requests, forwards the correlation ID, and logs metadata only. All services must use the same policy; a policy change requires changes to both service logger configurations and tests.

For the AI service, Core API forwards `x-request-id` on every internal call and the service requires it before processing. The AI service forwards the same ID to the configured model provider. Its JSON logger is allow-list based: it emits only operational IDs, operation/outcome, latency, provider/model, safe error class/code, and counts. It never passes raw `Error`/exception payloads, material, prompts, learner messages, guideline content, or model responses into a log record.
