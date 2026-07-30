from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

LinkType = Literal["supports", "rebuts", "qualifies"]
RunMode = Literal["pairwise", "batched"]
InputKind = Literal["text", "claims"]


class SourceSpan(BaseModel):
    start: int
    end: int


class Claim(BaseModel):
    id: str = ""
    text: str
    span: Optional[SourceSpan] = None


class Link(BaseModel):
    id: str
    source: str  # claim id (the supporting / rebutting / qualifying claim)
    target: str  # claim id (the claim being acted on)
    type: LinkType
    rationale: str = ""
    # The isolated inferential warrant: the principle/assumption that must hold
    # for this relation to work (e.g. "proximity does not prove causation").
    assumption: str = ""
    confidence: float = 0.5
    # Provenance: list (not single id) so multi-call links fit later.
    call_ids: list[int] = Field(default_factory=list)
    model: str = ""


class RunRequest(BaseModel):
    input_kind: InputKind = "text"
    text: str = ""
    claims: list[Claim] = Field(default_factory=list)
    mode: RunMode = "batched"
    model: Optional[str] = None
    run_extract: bool = True


class CallSummary(BaseModel):
    id: int
    stage: str
    mode: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float
    latency_ms: int


class StageSummary(BaseModel):
    stage: str
    calls: int
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float


class RunResult(BaseModel):
    run_id: int
    mode: str
    model: str
    input_kind: str
    claims: list[Claim]
    links: list[Link]
    calls: list[CallSummary]
    stage_summary: list[StageSummary]
    total_tokens: int
    total_cost_usd: float
    cost_per_link: Optional[float] = None
    warnings: list[str] = Field(default_factory=list)
