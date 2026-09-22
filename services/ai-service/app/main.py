from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from time import perf_counter

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.uri_parser import parse_uri

from .agents import AdminCoordinatorAgent, AgentInputRejected, GroundingUnavailable, QuizSpecialistAgent, RaaedAgent
from .config import Settings
from .observability import configure_logger, elapsed_ms, log_event
from .provider import OpenRouterProvider, ProviderProtocol, ProviderUnavailable
from .rag import chunk_material, with_embeddings
from .repositories import ActorRateLimiter, CourseQuotaExceeded, GuidelineRepository, MongoRepository, VectorRepository
from .schemas import AdminDirectiveRequest, AdminDirectiveResponse, IngestMaterialRequest, IngestResult, QuizGenerateRequest, QuizResponse, RaaedChatRequest, RaaedResponse
from .security import InternalPrincipal, request_id_from_header, require_internal


def _staff(principal: InternalPrincipal) -> None:
    if principal.actor_role not in {"instructor", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Internal role is not authorized.")


def _student(principal: InternalPrincipal) -> None:
    if principal.actor_role != "student":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Internal role is not authorized.")


def create_app(*, settings: Settings, vectors: VectorRepository, guidelines: GuidelineRepository, provider: ProviderProtocol, limiter: ActorRateLimiter, logger: logging.Logger | None = None) -> FastAPI:
    logger = logger or configure_logger(settings.log_level)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if isinstance(vectors, MongoRepository):
            await vectors.ensure_indexes()
        yield
        if isinstance(vectors, MongoRepository):
            vectors.client.close()

    app = FastAPI(title="REAL_i internal AI service", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.settings = settings
    app.state.logger = logger
    raaed = RaaedAgent(vectors=vectors, guidelines=guidelines, provider=provider)
    quiz = QuizSpecialistAgent(vectors=vectors, provider=provider)
    coordinator = AdminCoordinatorAgent(guidelines=guidelines, provider=provider)

    @app.exception_handler(ProviderUnavailable)
    async def provider_error(request: Request, error: ProviderUnavailable) -> JSONResponse:
        log_event(request.app.state.logger, request_id=request.headers.get("x-request-id"), event="provider_unavailable", operation="ai", outcome="failed", error_name=type(error).__name__, status_code=503)
        return JSONResponse(status_code=503, content={"error": {"code": "AI_PROVIDER_UNAVAILABLE", "message": "AI generation is temporarily unavailable."}})

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
        log_event(request.app.state.logger, request_id=request.headers.get("x-request-id"), event="ai_request_validation_failed", operation="api", outcome="rejected", error_name=type(error).__name__, status_code=422)
        return JSONResponse(status_code=422, content={"error": {"code": "VALIDATION_ERROR", "message": "Invalid request input."}})

    @app.exception_handler(AgentInputRejected)
    async def rejected_input(request: Request, error: AgentInputRejected) -> JSONResponse:
        log_event(request.app.state.logger, request_id=request.headers.get("x-request-id"), event="unsafe_agent_input_rejected", operation="ai", outcome="rejected", error_name=type(error).__name__, status_code=400)
        return JSONResponse(status_code=400, content={"error": {"code": "UNSAFE_AGENT_INPUT", "message": "The request cannot be processed."}})

    @app.exception_handler(GroundingUnavailable)
    async def grounding_error(request: Request, error: GroundingUnavailable) -> JSONResponse:
        log_event(request.app.state.logger, request_id=request.headers.get("x-request-id"), event="grounding_unavailable", operation="ai", outcome="rejected", error_name=type(error).__name__, status_code=422)
        return JSONResponse(status_code=422, content={"error": {"code": "GROUNDING_UNAVAILABLE", "message": "No authorized course material supports this operation."}})

    @app.exception_handler(CourseQuotaExceeded)
    async def quota_error(request: Request, error: CourseQuotaExceeded) -> JSONResponse:
        log_event(request.app.state.logger, request_id=request.headers.get("x-request-id"), event="course_material_quota_rejected", operation="ingest", outcome="rejected", error_name=type(error).__name__, status_code=409)
        return JSONResponse(status_code=409, content={"error": {"code": "COURSE_MATERIAL_QUOTA_EXCEEDED", "message": "Course material capacity has been reached."}})

    @app.exception_handler(Exception)
    async def unknown_error(request: Request, error: Exception) -> JSONResponse:
        log_event(request.app.state.logger, request_id=request.headers.get("x-request-id"), event="internal_ai_error", operation="ai", outcome="failed", error_name=type(error).__name__, status_code=500)
        return JSONResponse(status_code=500, content={"error": {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred."}})

    @app.get("/internal/health")
    async def health(_: InternalPrincipal = Depends(require_internal("ai:health")), request_id: str = Depends(request_id_from_header)) -> dict:
        log_event(logger, request_id=request_id, event="internal_health", operation="health", outcome="ok")
        return {"status": "ok"}

    @app.post("/internal/ingest", response_model=IngestResult, status_code=status.HTTP_201_CREATED)
    async def ingest(payload: IngestMaterialRequest, principal: InternalPrincipal = Depends(require_internal("ai:ingest")), request_id: str = Depends(request_id_from_header)) -> IngestResult:
        _staff(principal)
        started = perf_counter()
        if len(payload.content.encode("utf-8")) > settings.max_ingest_bytes:
            raise HTTPException(status_code=413, detail="Material exceeds the configured document size limit.")
        try:
            chunks = chunk_material(payload.course_id, payload.document_id, payload.source_title, payload.content, settings.max_chunks_per_document)
        except ValueError:
            raise HTTPException(status_code=413, detail="Material exceeds the configured document chunk limit.")
        vectors_with_embeddings = with_embeddings(chunks, await provider.embed([chunk.content for chunk in chunks], request_id), settings.embedding_dimensions)
        await vectors.replace_document(payload.course_id, payload.document_id, vectors_with_embeddings, settings.max_chunks_per_course)
        log_event(logger, request_id=request_id, event="material_ingested", operation="ingest", outcome="ok", course_id=payload.course_id, document_id=payload.document_id, chunk_count=len(vectors_with_embeddings), provider="openrouter", model=settings.openrouter_embedding_model, latency_ms=elapsed_ms(started), actor_id=principal.actor_id)
        return IngestResult(course_id=payload.course_id, document_id=payload.document_id, chunk_count=len(vectors_with_embeddings))

    @app.post("/internal/raaed/chat", response_model=RaaedResponse)
    async def raaed_chat(payload: RaaedChatRequest, principal: InternalPrincipal = Depends(require_internal("ai:tutor")), request_id: str = Depends(request_id_from_header)) -> RaaedResponse:
        _student(principal)
        if not await limiter.allow(principal.actor_id, "raaed_chat", settings.chat_rate_limit_per_minute):
            raise HTTPException(status_code=429, detail="AI chat rate limit exceeded.")
        started = perf_counter()
        response = await raaed.chat(payload, request_id)
        log_event(logger, request_id=request_id, event="raaed_completed", operation="tutor", outcome="ok", course_id=payload.course_id, provider="openrouter", model=response.model, latency_ms=elapsed_ms(started), actor_id=principal.actor_id, agent="raaed")
        return response

    @app.post("/internal/quiz/generate", response_model=QuizResponse)
    async def quiz_generate(payload: QuizGenerateRequest, principal: InternalPrincipal = Depends(require_internal("ai:quiz")), request_id: str = Depends(request_id_from_header)) -> QuizResponse:
        _staff(principal)
        started = perf_counter()
        response = await quiz.generate(payload, request_id)
        log_event(logger, request_id=request_id, event="quiz_generated", operation="quiz", outcome="ok", course_id=payload.course_id, provider="openrouter", model=response.model, latency_ms=elapsed_ms(started), actor_id=principal.actor_id, agent="quiz_specialist")
        return response

    @app.post("/internal/admin/guidelines", response_model=AdminDirectiveResponse, status_code=status.HTTP_201_CREATED)
    async def guideline_create(payload: AdminDirectiveRequest, principal: InternalPrincipal = Depends(require_internal("ai:guidelines")), request_id: str = Depends(request_id_from_header)) -> AdminDirectiveResponse:
        _staff(principal)
        started = perf_counter()
        response = await coordinator.create_guideline(payload, principal.actor_id, request_id)
        log_event(logger, request_id=request_id, event="guideline_drafted", operation="guideline", outcome="ok", course_id=payload.course_id, provider="openrouter", model=response.model, latency_ms=elapsed_ms(started), actor_id=principal.actor_id, agent="admin_coordinator")
        return response

    return app


def create_production_app() -> FastAPI:
    settings = Settings.from_env()
    client = AsyncIOMotorClient(settings.mongodb_uri)
    database_name = parse_uri(settings.mongodb_uri).get("database") or "real_i"
    repository = MongoRepository(client, database_name, settings.mongodb_vector_index, local_vector_search=settings.local_vector_search)
    provider = OpenRouterProvider(settings.openrouter_api_key, settings.openrouter_model_order, settings.openrouter_embedding_model, base_url=settings.llm_base_url, local_embeddings=settings.local_embeddings, embedding_dimensions=settings.embedding_dimensions)
    return create_app(settings=settings, vectors=repository, guidelines=repository, provider=provider, limiter=repository)
