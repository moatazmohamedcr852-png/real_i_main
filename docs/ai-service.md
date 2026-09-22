# Internal AI service design

`services/ai-service` is FastAPI code with no public client-facing API and with OpenAPI/docs disabled. It is started on loopback by default and every `/internal/*` route requires an internal bearer JWT plus `x-request-id`. Core API remains the only frontend-facing API; Step 9 will be the only place that wires Core to these endpoints.

## Boundary authentication and tracing

Core signs an HS256 JWT with `kid`, `iss=real-i-core-api`, `aud=real-i-ai`, `sub=core-api`, `actor_id`, `actor_role`, `scopes`, `iat`, and short `exp`. AI accepts only configured key IDs, issuer/audience, required claims, and permitted scopes. `AI_INTERNAL_JWT_KEYS_JSON` supports an active and previous key during a short rotation overlap; remove the old `kid` after Core has switched. Missing, malformed, expired, unknown-key, or invalid credentials all receive the same 401 response. Scope/role failures receive 403.

The request ID is mandatory, emitted in AI safe-metadata logs, and forwarded as `X-Request-ID` to OpenRouter. Secrets come only from environment configuration. The service never logs content-bearing values or raw exceptions.

## Retrieval and ingestion

Core submits an authenticated course-material ingestion request; AI does not read course, lesson, submission, or user collections. AI chunks text, requests embeddings through OpenRouter, and persists source attribution in `AIVectorChunks`. Retrieval uses Atlas `$vectorSearch`, course filtering, and source IDs; Raaed derives citations only from the retrieved records, never from provider-supplied titles or excerpts.

Atlas Search must be provisioned outside application startup. Illustrative index shape (substitute the exact configured dimension):

```javascript
{
  name: "ai_vector_chunks_by_course",
  definition: {
    fields: [
      { type: "vector", path: "embedding", numDimensions: 1536, similarity: "cosine" },
      { type: "filter", path: "courseId" }
    ]
  }
}
```

The service is stateless with respect to vectors and rate accounting: both reside in MongoDB. Atlas Search throughput/index capacity must be monitored as material volume grows; the mandatory production parity smoke test is recorded in `docs/data-model.md`.

## Prompt safety and agents

Course material, learner messages, instructor directives, and active guidelines are untrusted content. Prompts delimit and HTML-escape delimiter-like markup in those values, prohibit execution of embedded instructions, constrain Raaed/Quiz Specialist outputs to retrieved chunks, and prohibit private data/system-prompt disclosure. Obvious instruction-override and exfiltration patterns are rejected before provider calls; the Admin Coordinator applies the same policy to its generated guideline. This is mitigation, not a guarantee, so answers remain citation-grounded and caller authorization is enforced in Core API in Step 9.

- **Raaed** retrieves course chunks and active global/course guidelines, then returns a grounded answer plus chunk-derived citations.
- **Quiz Specialist** retrieves course chunks and validates exactly four-option MCQs against the existing Core assessment-question shape. Rationales are returned separately and are not inserted into Core question records.
- **Admin Coordinator** converts instructor/admin directives into validated **draft** `AIGuidelines` records. Activation/review policy is intentionally not automated; existing active guideline records are what Raaed injects.

## Provider routing

`OPENROUTER_MODEL_ORDER` is the explicit primary-to-fallback generation order. Each model has a bounded timeout; the first valid JSON response wins. If all models fail, AI returns `503 AI_PROVIDER_UNAVAILABLE` rather than hanging or producing an ungrounded answer. `OPENROUTER_API_KEY` and model IDs are deployment configuration, never source code. The provider interface is fully stubbed in tests; no automated test calls OpenRouter.
