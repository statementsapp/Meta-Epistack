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


# —— Epistemic Criteria Designer ——

PortId = Literal[
    "canonical_form",
    "theorem",
    "observation_map",
    "layer_separation",
    "revision_protocol",
    "meta_exhaustiveness",
    "source_class_ranking",
]

InquiryType = Literal[
    "factual_closed",
    "causal_mechanistic",
    "comparative_evaluative",
    "historical_reconstruction",
    "predictive_constrained",
    "definitional_taxonomic",
]

RejectedType = Literal[
    "preference_aesthetic",
    "open_future_prediction",
    "pure_normative",
    "non_partitionable",
    "pure_personalization",
    "empty_prompt",
]

LogicFragment = Literal[
    "classical_propositional",
    "first_order",
    "temporal_bounded",
    "modal_epistemic",
    "comparative_order",
]


class CriteriaDesignRequest(BaseModel):
    prompt: str
    model: Optional[str] = None


class SurfaceFeatures(BaseModel):
    tense: Literal["past", "present", "future", "mixed", "untensed"] = "untensed"
    hasQuantifiers: bool = False
    hasModals: bool = False
    hasEvaluativeLanguage: bool = False
    closedness: Literal["closed", "semi_open", "open"] = "semi_open"


class AnswerhoodSketch(BaseModel):
    """What the prompt itself implies as a satisfactory answer (erotetic excavation)."""

    direct_answer: str = ""
    partial_answer: str = ""
    presupposition_challenge: str = ""
    partition_licensed: bool = False
    open_answerhood: str = ""


class Presupposition(BaseModel):
    text: str
    status: Literal["accepted", "contested", "challengeable"] = "accepted"


class CriteriaObject(BaseModel):
    prompt_hash: str
    inquiry_type: str
    logic_fragment: str
    required_ports: list[str]
    port_parameters: dict = Field(default_factory=dict)
    port_applicability: dict[str, str] = Field(default_factory=dict)
    # erotetic | stack | pragmatic for each required port
    port_layers: dict[str, str] = Field(default_factory=dict)
    answerhood: AnswerhoodSketch = Field(default_factory=AnswerhoodSketch)
    presuppositions: list[Presupposition] = Field(default_factory=list)
    prompt_fixes: str = ""
    prompt_leaves_open: str = ""
    version: str
    completeness_template: str = ""
    surface_features: SurfaceFeatures = Field(default_factory=SurfaceFeatures)


class BouncerAdmitted(BaseModel):
    admitted: Literal[True] = True
    inquiry_type: str
    features: SurfaceFeatures
    note: str = ""


class BouncerRejected(BaseModel):
    admitted: Literal[False] = False
    rejected_type: str
    label: str
    message: str
    features: SurfaceFeatures = Field(default_factory=SurfaceFeatures)


class CriteriaDesignResult(BaseModel):
    run_id: int
    model: str
    bouncer: dict  # admitted | rejected shape (kept loose for frontend union)
    criteria: Optional[CriteriaObject] = None
    calls: list[CallSummary] = Field(default_factory=list)
    total_tokens: int = 0
    total_cost_usd: float = 0.0
    warnings: list[str] = Field(default_factory=list)


class EvidenceNeedItem(BaseModel):
    """One planned retrieval/settlement need derived from audited criteria."""

    kind: Literal["scope", "settlement", "defeater", "class_hint"]
    statement: str
    salience: Literal["high", "medium", "low"] = "medium"
    derived_from: list[str] = Field(default_factory=list)


class EvidenceNonNeed(BaseModel):
    """Required port that shapes the answer but does not authorize retrieval."""

    port: str
    reason: str


class EvidenceNeedPlan(BaseModel):
    """Criteria-derived plan of what evidence would settle or defeat the answer.

    Not a search API and not port-keyed retrieval. Gather fills these needs;
    answer ports remain answer-facing.
    """

    version: str = "evidence-needs/v1"
    scope: str = ""
    settlement_checks: list[EvidenceNeedItem] = Field(default_factory=list)
    defeater_hunts: list[EvidenceNeedItem] = Field(default_factory=list)
    class_hints: list[EvidenceNeedItem] = Field(default_factory=list)
    non_needs: list[EvidenceNonNeed] = Field(default_factory=list)
    retrieval_status: Literal[
        "planned_only", "gathered", "gather_failed", "skipped"
    ] = "planned_only"
    note: str = (
        "No retrieval yet. These needs are derived from the audited criteria "
        "for a later gather stage."
    )


class EvidenceNeedRequest(BaseModel):
    prompt: str
    criteria: CriteriaObject
    model: Optional[str] = None
    run_id: int


class EvidenceNeedResult(BaseModel):
    run_id: int
    model: str
    evidence_needs: EvidenceNeedPlan
    calls: list[CallSummary] = Field(default_factory=list)
    total_tokens: int = 0
    total_cost_usd: float = 0.0
    warnings: list[str] = Field(default_factory=list)


class GatheredFind(BaseModel):
    """Provenance-bearing claim atom from gather (who said what, with source)."""

    id: str
    need_kind: Literal["scope", "settlement", "defeater", "class_hint"]
    need_statement: str = ""
    claim: str
    source_title: str = ""
    source_url: str = ""
    source_publisher: str = ""
    quoted_or_paraphrase: str = ""
    published_at: str = ""
    confidence_note: str = ""
    salience: Literal["high", "medium", "low"] = "medium"


class GatherPacket(BaseModel):
    version: str = "gather/v1"
    finds: list[GatheredFind] = Field(default_factory=list)
    unmet_needs: list[str] = Field(default_factory=list)
    citations: list[str] = Field(default_factory=list)
    retrieval_status: Literal["gathered", "gather_failed", "skipped"] = "skipped"
    note: str = ""


class GatherRequest(BaseModel):
    prompt: str
    criteria: CriteriaObject
    evidence_needs: EvidenceNeedPlan
    model: Optional[str] = None
    run_id: int


class GatherResult(BaseModel):
    run_id: int
    model: str
    gather: GatherPacket
    evidence_needs: EvidenceNeedPlan
    calls: list[CallSummary] = Field(default_factory=list)
    total_tokens: int = 0
    total_cost_usd: float = 0.0
    warnings: list[str] = Field(default_factory=list)


class CriteriaAnswerRequest(BaseModel):
    prompt: str
    criteria: CriteriaObject
    model: Optional[str] = None
    run_id: int
    evidence_needs: Optional[EvidenceNeedPlan] = None
    gather: Optional[GatherPacket] = None


class AnswerSection(BaseModel):
    port: str
    title: str
    body: str = ""
    items: list[str] = Field(default_factory=list)


class AnswerAssertion(BaseModel):
    statement: str
    basis: str = ""
    defeaters: list[str] = Field(default_factory=list)


class CriteriaAnswer(BaseModel):
    headline: str
    summary: str = ""
    sections: list[AnswerSection] = Field(default_factory=list)
    assertions: list[AnswerAssertion] = Field(default_factory=list)
    residual_uncertainty: list[str] = Field(default_factory=list)


class CriteriaAnswerResult(BaseModel):
    run_id: int
    model: str
    answer: CriteriaAnswer
    evidence_needs: Optional[EvidenceNeedPlan] = None
    gather: Optional[GatherPacket] = None
    calls: list[CallSummary] = Field(default_factory=list)
    total_tokens: int = 0
    total_cost_usd: float = 0.0
    warnings: list[str] = Field(default_factory=list)
