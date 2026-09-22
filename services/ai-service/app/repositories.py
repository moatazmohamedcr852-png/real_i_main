from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Protocol
from uuid import uuid4

from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from .schemas import StoredChunk


class CourseQuotaExceeded(RuntimeError):
    pass


class VectorRepository(Protocol):
    async def replace_document(self, course_id: str, document_id: str, chunks: list[StoredChunk], max_course_chunks: int) -> None: ...
    async def retrieve(self, course_id: str, embedding: list[float], limit: int) -> list[StoredChunk]: ...


class GuidelineRepository(Protocol):
    async def active(self, course_id: str) -> list[str]: ...
    async def create_draft(self, scope: str, course_id: str | None, content: str, created_by: str) -> tuple[str, int]: ...


class ActorRateLimiter(Protocol):
    async def allow(self, actor_id: str, operation: str, limit: int) -> bool: ...


class InMemoryRepository(VectorRepository, GuidelineRepository):
    def __init__(self) -> None:
        self.chunks: dict[tuple[str, str], list[StoredChunk]] = {}
        self.guidelines: list[dict] = []

    async def replace_document(self, course_id: str, document_id: str, chunks: list[StoredChunk], max_course_chunks: int) -> None:
        retained = sum(len(items) for (stored_course, stored_document), items in self.chunks.items() if stored_course == course_id and stored_document != document_id)
        if retained + len(chunks) > max_course_chunks:
            raise CourseQuotaExceeded("Course material quota exceeded.")
        self.chunks[(course_id, document_id)] = chunks

    async def retrieve(self, course_id: str, embedding: list[float], limit: int) -> list[StoredChunk]:
        candidates = [chunk for (stored_course, _), chunks in self.chunks.items() if stored_course == course_id for chunk in chunks]
        return sorted(candidates, key=lambda chunk: _cosine(embedding, chunk.embedding), reverse=True)[:limit]

    async def active(self, course_id: str) -> list[str]:
        return [item["content"] for item in self.guidelines if item["status"] == "active" and ((item["scope"] == "global" and item["course_id"] is None) or (item["scope"] == "course" and item["course_id"] == course_id))]

    async def create_draft(self, scope: str, course_id: str | None, content: str, created_by: str) -> tuple[str, int]:
        version = 1 + max((item["version"] for item in self.guidelines if item["scope"] == scope and item["course_id"] == course_id), default=0)
        identifier = uuid4().hex[:24]
        self.guidelines.append({"_id": identifier, "scope": scope, "course_id": course_id, "content": content, "created_by": created_by, "version": version, "status": "draft"})
        return identifier, version


class InMemoryActorRateLimiter(ActorRateLimiter):
    def __init__(self) -> None:
        self.counts: dict[tuple[str, str, int], int] = {}

    async def allow(self, actor_id: str, operation: str, limit: int) -> bool:
        bucket = int(datetime.now(timezone.utc).timestamp() // 60)
        key = (actor_id, operation, bucket)
        next_count = self.counts.get(key, 0) + 1
        self.counts[key] = next_count
        return next_count <= limit


def _cosine(left: list[float], right: list[float]) -> float:
    numerator = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    return numerator / (left_norm * right_norm) if left_norm and right_norm else 0.0


class MongoRepository(VectorRepository, GuidelineRepository):
    """AI-owned vectors plus the pre-existing, Core-owned AIGuidelines collection."""

    def __init__(self, client: AsyncIOMotorClient, database_name: str, vector_index: str, local_vector_search: bool = False):
        self.client = client
        self.database = client[database_name]
        self.chunks = self.database["AIVectorChunks"]
        self.guidelines = self.database["AIGuidelines"]
        self.course_usage = self.database["AIVectorCourseUsage"]
        self.rate_limits = self.database["AIRateLimits"]
        self.vector_index = vector_index
        self.local_vector_search = local_vector_search

    async def ensure_indexes(self) -> None:
        await self.chunks.create_index([("courseId", 1), ("documentId", 1), ("ordinal", 1)], unique=True, name="ai_vector_chunk_document_ordinal_unique")
        await self.chunks.create_index([("courseId", 1), ("documentId", 1)], name="ai_vector_chunk_course_document")
        await self.course_usage.create_index("courseId", unique=True, name="ai_vector_course_usage_unique")
        await self.rate_limits.create_index([("actorId", 1), ("operation", 1), ("bucket", 1)], unique=True, name="ai_rate_limit_actor_operation_bucket_unique")
        await self.rate_limits.create_index("expiresAt", expireAfterSeconds=0, name="ai_rate_limit_expiry")
        async for existing in self.chunks.aggregate([{"$group": {"_id": "$courseId", "chunkCount": {"$sum": 1}}}]):
            await self.course_usage.update_one({"courseId": existing["_id"]}, {"$setOnInsert": {"chunkCount": existing["chunkCount"]}}, upsert=True)

    async def replace_document(self, course_id: str, document_id: str, chunks: list[StoredChunk], max_course_chunks: int) -> None:
        async with await self.client.start_session() as session:
            async def write_material(transaction_session) -> None:
                existing = await self.chunks.count_documents({"courseId": course_id, "documentId": document_id}, session=session)
                delta = len(chunks) - existing
                usage = await self.course_usage.find_one({"courseId": course_id}, session=transaction_session)
                if usage is None:
                    current = await self.chunks.count_documents({"courseId": course_id}, session=transaction_session)
                    if current + delta > max_course_chunks:
                        raise CourseQuotaExceeded("Course material quota exceeded.")
                    await self.course_usage.insert_one({"courseId": course_id, "chunkCount": current + delta}, session=transaction_session)
                elif delta > 0:
                    updated = await self.course_usage.find_one_and_update({"courseId": course_id, "chunkCount": {"$lte": max_course_chunks - delta}}, {"$inc": {"chunkCount": delta}}, return_document=ReturnDocument.AFTER, session=transaction_session)
                    if not updated:
                        raise CourseQuotaExceeded("Course material quota exceeded.")
                elif delta < 0:
                    await self.course_usage.update_one({"courseId": course_id}, {"$inc": {"chunkCount": delta}}, session=transaction_session)
                if delta == 0 and usage is not None and usage["chunkCount"] > max_course_chunks:
                    raise CourseQuotaExceeded("Course material quota exceeded.")
                await self.chunks.delete_many({"courseId": course_id, "documentId": document_id}, session=transaction_session)
                if chunks:
                    await self.chunks.insert_many([{"_id": chunk.chunk_id, "courseId": chunk.course_id, "documentId": chunk.document_id, "sourceTitle": chunk.source_title, "ordinal": chunk.ordinal, "content": chunk.content, "embedding": chunk.embedding, "createdAt": datetime.now(timezone.utc)} for chunk in chunks], ordered=True, session=transaction_session)
            await session.with_transaction(write_material)

    async def retrieve(self, course_id: str, embedding: list[float], limit: int) -> list[StoredChunk]:
        if self.local_vector_search:
            candidates = [StoredChunk(chunk_id=str(item["_id"]), course_id=item["courseId"], document_id=item["documentId"], source_title=item["sourceTitle"], ordinal=item["ordinal"], content=item["content"], embedding=item.get("embedding") or []) async for item in self.chunks.find({"courseId": course_id})]
            return sorted(candidates, key=lambda chunk: _cosine(embedding, chunk.embedding), reverse=True)[:limit]
        pipeline = [{"$vectorSearch": {"index": self.vector_index, "path": "embedding", "queryVector": embedding, "numCandidates": max(100, limit * 20), "limit": limit, "filter": {"courseId": course_id}}}, {"$project": {"_id": 1, "courseId": 1, "documentId": 1, "sourceTitle": 1, "ordinal": 1, "content": 1, "embedding": 1}}]
        return [StoredChunk(chunk_id=item["_id"], course_id=item["courseId"], document_id=item["documentId"], source_title=item["sourceTitle"], ordinal=item["ordinal"], content=item["content"], embedding=item["embedding"]) async for item in self.chunks.aggregate(pipeline)]

    async def active(self, course_id: str) -> list[str]:
        query = {"status": "active", "$or": [{"scope": "global", "courseId": None}, {"scope": "course", "courseId": ObjectId(course_id)}]}
        return [item["content"] async for item in self.guidelines.find(query, {"content": 1})]

    async def create_draft(self, scope: str, course_id: str | None, content: str, created_by: str) -> tuple[str, int]:
        mongo_course_id = ObjectId(course_id) if course_id else None
        for _ in range(3):
            latest = await self.guidelines.find_one({"scope": scope, "courseId": mongo_course_id}, sort=[("version", -1)], projection={"version": 1})
            version = (latest or {}).get("version", 0) + 1
            identifier = ObjectId()
            try:
                await self.guidelines.insert_one({"_id": identifier, "scope": scope, "courseId": mongo_course_id, "version": version, "status": "draft", "content": content, "createdBy": ObjectId(created_by), "activatedAt": None, "archivedAt": None, "createdAt": datetime.now(timezone.utc), "updatedAt": datetime.now(timezone.utc)})
                return str(identifier), version
            except DuplicateKeyError:
                continue
        raise RuntimeError("Could not allocate a unique guideline version.")

    async def allow(self, actor_id: str, operation: str, limit: int) -> bool:
        now = datetime.now(timezone.utc)
        bucket = int(now.timestamp() // 60)
        query = {"actorId": actor_id, "operation": operation, "bucket": bucket, "count": {"$lt": limit}}
        result = await self.rate_limits.find_one_and_update(query, {"$inc": {"count": 1}}, return_document=ReturnDocument.AFTER)
        if result:
            return True
        try:
            await self.rate_limits.insert_one({"actorId": actor_id, "operation": operation, "bucket": bucket, "count": 1, "expiresAt": datetime.fromtimestamp((bucket + 2) * 60, timezone.utc)})
            return True
        except DuplicateKeyError:
            result = await self.rate_limits.find_one_and_update(query, {"$inc": {"count": 1}}, return_document=ReturnDocument.AFTER)
            return result is not None
