from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


class ConfigurationError(RuntimeError):
    pass


def load_dotenv_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _required(name: str, source: dict[str, str]) -> str:
    value = source.get(name, "").strip()
    if not value:
        raise ConfigurationError(f"Missing required configuration: {name}")
    return value


@dataclass(frozen=True)
class Settings:
    mongodb_uri: str
    internal_jwt_keys: dict[str, str]
    internal_jwt_issuer: str
    internal_jwt_audience: str
    openrouter_api_key: str
    openrouter_model_order: tuple[str, ...]
    openrouter_embedding_model: str
    embedding_dimensions: int
    mongodb_vector_index: str
    max_ingest_bytes: int = 5 * 1024 * 1024
    max_chunks_per_document: int = 2000
    max_chunks_per_course: int = 10000
    chat_rate_limit_per_minute: int = 10
    log_level: str = "INFO"
    llm_base_url: str = "https://openrouter.ai/api/v1"
    local_embeddings: bool = False
    local_vector_search: bool = False

    @classmethod
    def from_env(cls, source: dict[str, str] | None = None) -> "Settings":
        if source is None:
            load_dotenv_file(Path(__file__).resolve().parent.parent / ".env")
        values = dict(os.environ if source is None else source)
        try:
            keys = json.loads(_required("AI_INTERNAL_JWT_KEYS_JSON", values))
        except json.JSONDecodeError as error:
            raise ConfigurationError("AI_INTERNAL_JWT_KEYS_JSON must be a JSON object.") from error
        if not isinstance(keys, dict) or not keys or any(not isinstance(key_id, str) or not isinstance(secret, str) or len(secret) < 32 for key_id, secret in keys.items()):
            raise ConfigurationError("AI_INTERNAL_JWT_KEYS_JSON must map key IDs to 32+ character secrets.")
        models = tuple(item.strip() for item in _required("OPENROUTER_MODEL_ORDER", values).split(",") if item.strip())
        if not models:
            raise ConfigurationError("OPENROUTER_MODEL_ORDER must contain at least one model.")
        try:
            dimensions = int(_required("OPENROUTER_EMBEDDING_DIMENSIONS", values))
            max_bytes = int(values.get("MAX_INGEST_BYTES", str(5 * 1024 * 1024)))
            max_chunks = int(values.get("MAX_CHUNKS_PER_DOCUMENT", "2000"))
            max_course_chunks = int(values.get("MAX_CHUNKS_PER_COURSE", "10000"))
            chat_rate_limit = int(values.get("AI_CHAT_RATE_LIMIT_PER_MINUTE", "10"))
        except ValueError as error:
            raise ConfigurationError("Ingestion limits must be integers.") from error
        if dimensions < 1 or max_bytes < 1 or max_chunks < 1 or max_course_chunks < 1 or chat_rate_limit < 1:
            raise ConfigurationError("Ingestion limits must be positive.")
        mongodb_uri = _required("MONGODB_URI", values)
        llm_base_url = values.get("LLM_BASE_URL", values.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")).strip()
        flag = lambda name: values.get(name, "").strip().lower() in {"1", "true", "yes"}
        local_host = any(token in mongodb_uri for token in ("localhost", "127.0.0.1"))
        return cls(
            mongodb_uri=mongodb_uri,
            internal_jwt_keys=keys,
            internal_jwt_issuer=_required("AI_INTERNAL_JWT_ISSUER", values),
            internal_jwt_audience=_required("AI_INTERNAL_JWT_AUDIENCE", values),
            openrouter_api_key=_required("OPENROUTER_API_KEY", values),
            openrouter_model_order=models,
            openrouter_embedding_model=_required("OPENROUTER_EMBEDDING_MODEL", values),
            embedding_dimensions=dimensions,
            mongodb_vector_index=values.get("MONGODB_VECTOR_INDEX", "ai_vector_chunks_by_course").strip() or "ai_vector_chunks_by_course",
            max_ingest_bytes=max_bytes,
            max_chunks_per_document=max_chunks,
            max_chunks_per_course=max_course_chunks,
            chat_rate_limit_per_minute=chat_rate_limit,
            log_level=values.get("LOG_LEVEL", "INFO").upper(),
            llm_base_url=llm_base_url,
            local_embeddings=flag("LOCAL_EMBEDDINGS") or "groq.com" in llm_base_url,
            local_vector_search=flag("LOCAL_VECTOR_SEARCH") or local_host,
        )
