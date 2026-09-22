from __future__ import annotations

import re
from uuid import uuid4

from .schemas import StoredChunk


def chunk_material(course_id: str, document_id: str, source_title: str, content: str, max_chunks: int, target_chars: int = 1400, overlap_chars: int = 180) -> list[StoredChunk]:
    """Bounded, deterministic text chunks. Embeddings are populated after batching."""
    normalized = re.sub(r"\s+", " ", content).strip()
    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(len(normalized), start + target_chars)
        if end < len(normalized):
            boundary = normalized.rfind(" ", start + target_chars // 2, end)
            end = boundary if boundary > start else end
        chunks.append(normalized[start:end].strip())
        if len(chunks) > max_chunks:
            raise ValueError("Document exceeds the configured chunk limit.")
        if end >= len(normalized):
            break
        start = max(end - overlap_chars, start + 1)
    return [StoredChunk(chunk_id=uuid4().hex[:24], course_id=course_id, document_id=document_id, source_title=source_title, ordinal=ordinal, content=text, embedding=[]) for ordinal, text in enumerate(chunks)]


def with_embeddings(chunks: list[StoredChunk], vectors: list[list[float]], expected_dimensions: int) -> list[StoredChunk]:
    if len(chunks) != len(vectors) or any(len(vector) != expected_dimensions for vector in vectors):
        raise ValueError("Embedding count did not match chunks.")
    return [chunk.model_copy(update={"embedding": vector}) for chunk, vector in zip(chunks, vectors)]


def citation_excerpt(content: str, limit: int = 300) -> str:
    return content[:limit].rstrip() + ("…" if len(content) > limit else "")
