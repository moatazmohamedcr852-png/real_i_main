from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


OBJECT_ID_PATTERN = r"^[a-fA-F0-9]{24}$"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class IngestMaterialRequest(StrictModel):
    course_id: str = Field(pattern=OBJECT_ID_PATTERN)
    document_id: str = Field(min_length=1, max_length=200)
    source_title: str = Field(min_length=1, max_length=500)
    content: str = Field(min_length=1)


class IngestResult(StrictModel):
    course_id: str
    document_id: str
    chunk_count: int


class RaaedChatRequest(StrictModel):
    course_id: str = Field(pattern=OBJECT_ID_PATTERN)
    message: str = Field(min_length=1, max_length=12000)
    top_k: int = Field(default=5, ge=1, le=8)


class Citation(StrictModel):
    chunk_id: str
    document_id: str
    source_title: str
    excerpt: str


class RaaedResponse(StrictModel):
    answer: str
    citations: list[Citation]
    model: str


class QuizGenerateRequest(StrictModel):
    course_id: str = Field(pattern=OBJECT_ID_PATTERN)
    topic: str = Field(min_length=1, max_length=1000)
    count: int = Field(default=5, ge=1, le=20)


class QuizOption(StrictModel):
    id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=2000)


class QuizQuestion(StrictModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["mcq"] = "mcq"
    prompt: str = Field(min_length=1, max_length=20000)
    options: list[QuizOption] = Field(min_length=4, max_length=4)
    correctOptionIds: list[str] = Field(min_length=1, max_length=1)
    points: float = Field(ge=1, le=1000)
    rubric: list[dict] = Field(default_factory=list, max_length=0)

    @field_validator("options")
    @classmethod
    def option_ids_are_unique(cls, options: list[QuizOption]) -> list[QuizOption]:
        if len({option.id for option in options}) != 4:
            raise ValueError("Quiz options must have four unique IDs.")
        return options

    @field_validator("correctOptionIds")
    @classmethod
    def correct_answer_is_present(cls, answer: list[str], info) -> list[str]:
        options = info.data.get("options", [])
        if options and answer[0] not in {option.id for option in options}:
            raise ValueError("The correct option must be one of the four options.")
        return answer


class QuizResponse(StrictModel):
    questions: list[QuizQuestion]
    rationales: dict[str, str]
    source_chunk_ids: list[str]
    model: str


class AdminDirectiveRequest(StrictModel):
    scope: Literal["global", "course"]
    course_id: str | None = Field(default=None, pattern=OBJECT_ID_PATTERN)
    directive: str = Field(min_length=1, max_length=12000)

    @model_validator(mode="after")
    def scope_matches_course(self) -> "AdminDirectiveRequest":
        if self.scope == "course" and not self.course_id:
            raise ValueError("Course guidelines require course_id.")
        if self.scope == "global" and self.course_id:
            raise ValueError("Global guidelines may not have course_id.")
        return self


class AdminDirectiveResponse(StrictModel):
    guideline_id: str
    version: int
    status: Literal["draft"]
    model: str


class ProviderAnswer(StrictModel):
    answer: str = Field(min_length=1, max_length=12000)
    source_chunk_ids: list[str] = Field(min_length=1, max_length=8)


class ProviderQuiz(StrictModel):
    questions: list[QuizQuestion]
    rationales: dict[str, str] = Field(min_length=1, max_length=20)
    source_chunk_ids: list[str] = Field(min_length=1, max_length=8)

    @field_validator("rationales")
    @classmethod
    def rationales_are_bounded(cls, rationales: dict[str, str]) -> dict[str, str]:
        if any(not key or not value.strip() or len(value) > 4000 for key, value in rationales.items()):
            raise ValueError("Quiz rationales must be non-empty and bounded.")
        return rationales


class ProviderGuideline(StrictModel):
    guideline: str = Field(min_length=1, max_length=100000)


class StoredChunk(StrictModel):
    chunk_id: str
    course_id: str
    document_id: str
    source_title: str
    ordinal: int
    content: str
    embedding: list[float]
