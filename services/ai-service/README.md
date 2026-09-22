# AI service

Internal FastAPI service for RAG ingestion/retrieval and the Raaed, Quiz Specialist, and Admin Coordinator agents. It has no frontend-facing API; only Core API may call its authenticated `/internal/*` routes.

Copy `.env.example` to `.env`, install `requirements.txt`, then run:

```powershell
python -m app
python -m pytest -q
```

Production uses `uvicorn app.main:create_production_app --factory` behind a private network/loopback binding. Provision the Atlas Search vector index before startup. Design, authentication claims, prompt-safety policy, and provider fallback are documented in [../../docs/ai-service.md](../../docs/ai-service.md).
