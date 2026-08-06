"""Epistemic Criteria Designer — LLM bouncer + port-based criteria emission.

Not registered on the claim-graph pipeline; invoked by POST /api/criteria/design.
Uses the same Grok client and call ledger as extract/resolve.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from ..llm import LLMError, client, parse_json_loose
from ..models import (
    AnswerAssertion,
    AnswerDefeater,
    AnswerhoodSketch,
    AnswerSection,
    CallSummary,
    CriteriaAnswer,
    CriteriaAnswerResult,
    CriteriaDesignResult,
    CriteriaObject,
    EvidenceNeedItem,
    EvidenceNeedPlan,
    EvidenceNeedResult,
    EvidenceNonNeed,
    GatheredFind,
    GatherPacket,
    GatherResult,
    Presupposition,
    SurfaceFeatures,
)
from .. import criteria_log, db
from ..config import cost_for

CRITERIA_VERSION = "criteria-schema/v2"
EVIDENCE_NEEDS_VERSION = "evidence-needs/v1"
GATHER_VERSION = "gather/v1"

# Ports that may authorize retrieval/settlement planning (not the ports themselves
# as search endpoints). Answer-form-only ports are listed as non_needs.
_NEED_AUTHORIZING_PORTS = frozenset(
    {
        "canonical_form",
        "observation_map",
        "revision_protocol",
        "source_class_ranking",
    }
)

_NON_NEED_REASONS: dict[str, str] = {
    "theorem": "Shapes derivational answer form; does not authorize retrieval.",
    "layer_separation": "Shapes how the answer separates layers; not a gather target.",
    "meta_exhaustiveness": "Shapes structural coverage in the answer; not a gather target.",
    "canonical_form": "Scopes the inquiry; listed under scope, not as a fetch endpoint.",
}

PORT_IDS = [
    "canonical_form",
    "theorem",
    "observation_map",
    "layer_separation",
    "revision_protocol",
    "meta_exhaustiveness",
    "source_class_ranking",
]

_SYSTEM = """You are the Epistemic Criteria Designer for an investigation stack.

Your job: given a user prompt, BEFORE any search or answer generation,
(1) act as a bouncer that classifies epistemic type and admits or rejects,
(2) if admitted, excavate the prompt's own answerhood conditions, then encode
them as a criteria object: a tailored subset of structural ports that the best
possible answer must satisfy.

PROCESS (admitted prompts only; do this in order)
1. EXCAVATE: reconstruct what the prompt already implies as a satisfactory
   answer (direct complete answer; admissible partial answer; when challenging a
   presupposition is in-bounds vs evasion). State operative presuppositions and
   whether a partition of answer-space is licensed by the question's form.
   Also set resolution_mode:
   - mechanism_inference: what happened / caused it / which hypothesis or
     scientific program constraints hold (even if public materials are debates)
   - discourse_map: who argued what / who won a debate / position structure
   - mixed: both layers in-bounds; keep them separate
2. SEPARATE LAYERS: erotetic (from the question), stack (standing investigation
   norms), pragmatic (chatbot/helpfulness surplus). Prefer erotetic for optional
   ports. revision_protocol is a standing stack norm for any non-trivial answer
   assertion; label it stack unless the question itself clearly demands
   defeaters. Add other stack only where the best answer still needs it; add
   pragmatic rarely and label it.
3. ENCODE: map the excavation onto the fixed port schema. Do not start from
   port shopping. Every required port must catch a failure of answering THIS
   prompt. If it only catches "failure to look like our stack," do not require it.
   Tailor required_ports and port_parameters to resolution_mode (see RULES).
4. MARK UNDERDETERMINATION: say what the prompt fixes vs what remains a choice.

RULES
- Criteria are requirements on the eventual answer only. Do not emit criteria
  about upstream search, retrieval, ingestion, or how sources are pulled in.
- Criteria stay abstract: never hard-code domain-specific hypotheses or content.
- Prefer explicit observation maps over free-form probability language when the
  question licenses that form. Do not require theorem for ordinary empirical or
  predictive forecasts.
- Keep intersubjective (publicly checkable) and agent-relative layers
  syntactically separate when both appear.
- Every non-trivial assertion made by the eventual answer needs a revision
  protocol (declared defeaters). These answer assertions are not the source
  claims that may later be ingested as evidence. The revision_protocol port
  ACCEPTS salience-weighted defeaters. Salience means importance under the
  prompt's subject and working horizon; base rate is one input, not the
  definition. Lead with high-salience defeaters; subject-salient rare or
  long-horizon defeaters MUST appear at least briefly; do not omit all of them;
  they must not dominate. Encode salience_weighted: true in
  port_parameters.revision_protocol.
- Meta-exhaustiveness covers the declared working schema when completeness is
  meaningful. Do not claim exhaustiveness over undeclared futures.
- Ambition test: owning items in prompt_leaves_open with a labeled working
  query schema tightens answerhood and is allowed. Unasked exams are not.
- The port schema never changes; only required_ports and port_parameters vary.
- Generated criteria are a fallible working schema for this run, not a rigid
  prior. Mid-run automatic rewrite of the criteria object is not assumed.
- PARTITION VS OPEN QUERY SCHEMA: if the prompt is partition-like (yes/no, who
  among alternatives, closed identification with clear cells), canonical_form
  should state the cells. If open, do NOT invent a fake exhaustive partition.
  Use open_answerhood. When prompt_leaves_open includes horizon, metric, or
  conditioning frame (or open_answerhood says incomplete without it), require
  canonical_form as an open query schema (working horizons / scenario-driver
  axes, labeled as working choices). Dropping that merely because the prompt
  did not fix calendar years is an audit error.
- RESOLUTION MODE AND DYNAMIC PORT ESSENTIALS:
  * mechanism_inference: prefer licensed hypothesis partitions when licensed;
    else open schema over constraints/non-exhaustive programs. Prefer requiring
    observation_map with observable settlement predicates first (not talking
    points). revision_protocol defeaters rule cells/programs in or out; "lost
    the debate" is not a defeater. meta_exhaustiveness covers the declared
    mechanism/hypothesis schema only. source_class_ranking weights evidence
    classes, not speaker prestige. Answerhood targets supported / ruled out /
    underdetermined; not debate scores or unbacked numeric posteriors. For
    unsettled speculative science, keep partition_licensed false when no
    exhaustive cell set is licensed.
  * discourse_map: speaker/position structure may be in-bounds; do not force
    mechanism-first observation maps merely to look scientific.
  * mixed: require layer_separation when both layers appear; do not conflate.
- Direct / partial / presupposition-challenge: state which response kinds are
  in-bounds. Do not treat only "looks complete under ports" as success.

BOUNCER: SCOPE TEST, NOT A DIFFICULTY TEST
Admission is the default. Ask: does a question arise for which a workable
answerhood schema (possibly open, possibly partition-like) can be stated?
It does not ask whether the prompt is easy, narrow, well-posed, or answerable
with confidence. Hard, broad, vague, and contested prompts are in scope; the
criteria carry that load. When admission is arguable, admit.

Do not reject for: breadth, vagueness, missing specifics, long time horizons,
genuine uncertainty, multi-causal subject matter, or contested subject matter.
A prompt that would need reframing to answer well is admitted; reframing is
what canonical_form is for.

REJECT (admitted=false) only when one of these holds:
- preference_aesthetic: resolves entirely to the asker's taste; no factual
  core survives once preference is set aside (no coherent public answerhood)
- open_future_prediction: the future outcome has NO regularity, base rate,
  structural driver, bounding constraint, OR workable conditioning/query schema
  any evidence could speak to. Long horizon or missing specifics alone is not
  enough: if standing regularities, trends, mechanisms, or a workable
  conditioning frame exist, ADMIT as predictive_constrained and let
  canonical_form declare an open query schema or conditioning frame (not a fake
  exhaustive partition unless partition_licensed).
- pure_normative: asks only what ought to be, with no factual, empirical, or
  policy-text core to check. A normative prompt with a separable factual layer
  is admitted (layer_separation handles the split).
- non_partitionable: no workable answerhood schema at all (not even an open
  one), so no completeness claim could ever be stated
- pure_personalization: answerable only from the asker's private situation,
  with no separable intersubjective layer

On rejection: do NOT emit criteria. Set required_ports to []. Rejection
messages state which structural precondition is missing, not that the
question is difficult or underspecified.

ADMITTED inquiry_type (one of):
factual_closed | causal_mechanistic | comparative_evaluative |
historical_reconstruction | predictive_constrained | definitional_taxonomic

logic_fragment (one of):
classical_propositional | first_order | temporal_bounded |
modal_epistemic | comparative_order

Ports (always defined; selectively require a subset):
canonical_form, theorem, observation_map, layer_separation,
revision_protocol, meta_exhaustiveness, source_class_ranking

Inspect surface features: tense, quantifiers, modals, evaluative language,
degree of closedness. Tailor required_ports from the excavation and those
features, not from a fixed checklist.

Respond with ONE JSON object only, matching this shape:
{
  "admitted": boolean,
  "rejected_type": string|null,
  "rejected_label": string|null,
  "rejected_message": string|null,
  "inquiry_type": string|null,
  "note": string,
  "surface_features": {
    "tense": "past"|"present"|"future"|"mixed"|"untensed",
    "hasQuantifiers": boolean,
    "hasModals": boolean,
    "hasEvaluativeLanguage": boolean,
    "closedness": "closed"|"semi_open"|"open"
  },
  "answerhood": {
    "direct_answer": string,
    "partial_answer": string,
    "presupposition_challenge": string,
    "partition_licensed": boolean,
    "open_answerhood": string
  },
  "resolution_mode": "mechanism_inference"|"discourse_map"|"mixed",
  "presuppositions": [
    {"text": string, "status": "accepted"|"contested"|"challengeable"}
  ],
  "prompt_fixes": string,
  "prompt_leaves_open": string,
  "logic_fragment": string|null,
  "required_ports": string[],
  "port_layers": { "<port_id>": "erotetic"|"stack"|"pragmatic" },
  "port_parameters": { "<port_id>": { ... } },
  "completeness_template": string
}

completeness_template should state that a complete answer is any set of
attachments covering every required port without contradiction under the
declared logic fragment, while still resolving the excavated answerhood
conditions. port_parameters may be {} for unused ports; only include keys for
required ports. Keep parameters structural (flags, modes), not domain facts.
When revision_protocol is required, port_parameters.revision_protocol must
include salience_weighted: true (defeater acceptance is salience-weighted).
Every required port must appear in port_layers.
"""

_USER_TEMPLATE = (
    "Design epistemic criteria for the following user prompt.\n\n"
    "PROMPT:\n{prompt}"
)

_AUDIT_SYSTEM = """You are the applicability auditor for an epistemic criteria
designer. You receive a user prompt, an answerhood excavation, and a candidate
criteria object. Your only job is to prevent inapplicable ports from becoming
requirements.

Evaluate every candidate required port independently. A port is applicable only
when ALL of these hold:
1. NECESSARY: fulfilling it would materially constrain what counts as the best
   possible answer to this prompt; it is not merely generic good practice and
   not an upstream retrieval/ingest concern.
2. FULFILLABLE: its declared type can actually be supplied for this inquiry.
3. NON-DUPLICATIVE: another selected port does not already do the same work.
4. ROLE-CORRECT: it performs its own epistemic role, not a role borrowed from
   another port.
5. ANSWER-FACING: it is a requirement on the content of the answer, not on how
   sources are searched, ranked, or ingested before answering.
6. EROTETICALLY GROUNDED: it catches a failure of answering THIS prompt given
   the excavated answerhood conditions, OR it is an explicitly labeled stack
   surplus that is still necessary for the best answer (including standing
   revision_protocol). Drop ports that only enforce looking like the stack.
   If partition_licensed is false, reject canonical_form / meta_exhaustiveness
   parameters that invent a fake exhaustive licensed partition.
   OPEN-SCHEMA EXCEPTION (decisive): if open_answerhood or prompt_leaves_open
   says resolution is incomplete without a horizon, metric, or conditioning
   frame, then canonical_form as an open QuerySchema is NECESSARY. Do not drop
   it for uncertainty, and do not drop it merely because the prompt did not
   fix calendar years.

Port contracts (also respect resolution_mode on the candidate criteria):
- canonical_form: proposition, licensed partition, or open query schema. For
  mechanism_inference, prefer hypothesis cells or open program/constraint
  schemas (not debater lists). For open predictive prompts, approve an open
  query schema with working horizons when prompt_leaves_open includes horizon
  or open_answerhood says incomplete without a frame.
- theorem: genuine derivational constraint only. Do not approve for ordinary
  empirical or predictive forecasts.
- observation_map: settlement predicates for answer assertions. Under
  mechanism_inference, usually approve when observables can speak; parameters
  should be observable-first. Not auto-required for discourse_map. For
  predictive prompts, approve when driver-to-outcome settlement is part of
  direct answerhood and is not already fixed by canonical_form.
- layer_separation: when intersubjective and agent-relative layers both appear,
  or when resolution_mode is mixed.
- revision_protocol: standing stack norm for non-trivial answer assertions.
  Salience = importance under subject and working horizon (base rate is one
  input). High-salience first; subject-salient rare/long-horizon tails must
  appear at least briefly and must not dominate. Under mechanism_inference,
  defeaters rule cells/programs in or out; "lost the debate" is not a defeater.
  Parameters: salience_weighted: true.
- meta_exhaustiveness: coverage of the declared working schema only. Under
  mechanism_inference, that schema is hypothesis/mechanism structure, not
  discourse coverage. No fake exhaustiveness over undeclared futures.
- source_class_ranking: answer must weight evidence classes it relies on.
  Under mechanism_inference, classes are evidential (not speaker prestige).
  Not a search ranker; gather may later treat classes as consult hints.

Approve only ports that constrain the best possible answer to this question.
Uncertainty about whether a port is answer-facing or erotetically grounded
means do not approve it. Do not add ports that were not proposed. Return
strict JSON:
{
  "assessments": [
    {"port": "<candidate port>", "applicable": true|false,
     "reason": "<prompt-specific epistemic reason>",
     "layer": "erotetic"|"stack"|"pragmatic"|null}
  ]
}
Every candidate port must appear exactly once. Reasons must explain fit to the
prompt's answerhood conditions, not restate the generic port definition.
"""


def _prompt_hash(prompt: str) -> str:
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:16]


def _features_from(raw: Any) -> SurfaceFeatures:
    if not isinstance(raw, dict):
        return SurfaceFeatures()
    tense = raw.get("tense", "untensed")
    if tense not in ("past", "present", "future", "mixed", "untensed"):
        tense = "untensed"
    closedness = raw.get("closedness", "semi_open")
    if closedness not in ("closed", "semi_open", "open"):
        closedness = "semi_open"
    return SurfaceFeatures(
        tense=tense,
        hasQuantifiers=bool(raw.get("hasQuantifiers", False)),
        hasModals=bool(raw.get("hasModals", False)),
        hasEvaluativeLanguage=bool(raw.get("hasEvaluativeLanguage", False)),
        closedness=closedness,
    )


def _filter_ports(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    allowed = set(PORT_IDS)
    out: list[str] = []
    for p in raw:
        if isinstance(p, str) and p in allowed and p not in out:
            out.append(p)
    return out


def _resolution_mode_from(raw: Any) -> str:
    mode = str(raw or "").strip()
    if mode in ("mechanism_inference", "discourse_map", "mixed"):
        return mode
    return "mechanism_inference"


def _answerhood_from(raw: Any) -> AnswerhoodSketch:
    if not isinstance(raw, dict):
        return AnswerhoodSketch()
    return AnswerhoodSketch(
        direct_answer=str(raw.get("direct_answer") or "").strip(),
        partial_answer=str(raw.get("partial_answer") or "").strip(),
        presupposition_challenge=str(raw.get("presupposition_challenge") or "").strip(),
        partition_licensed=bool(raw.get("partition_licensed", False)),
        open_answerhood=str(raw.get("open_answerhood") or "").strip(),
    )


def _presuppositions_from(raw: Any) -> list[Presupposition]:
    if not isinstance(raw, list):
        return []
    out: list[Presupposition] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        status = item.get("status") or "accepted"
        if status not in ("accepted", "contested", "challengeable"):
            status = "accepted"
        out.append(Presupposition(text=text, status=status))
    return out


def _port_layers_from(raw: Any, ports: list[str]) -> dict[str, str]:
    allowed = {"erotetic", "stack", "pragmatic"}
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, str] = {}
    for port in ports:
        layer = src.get(port) or "erotetic"
        if layer not in allowed:
            layer = "erotetic"
        out[port] = layer
    return out


def _completeness(ports: list[str], fragment: str) -> str:
    listed = ", ".join(f"«{p}»" for p in ports) or "(none)"
    return (
        f"A complete answer is any set of attachments that covers required ports "
        f"{{ {listed} }} without contradiction under logic fragment «{fragment}». "
        f"External data attaches by matching each port’s type signature."
    )


def _call_summaries(run_id: int) -> list[CallSummary]:
    rows = db.calls_for_run(run_id)
    return [
        CallSummary(
            id=r["id"],
            stage=r["stage"],
            mode=r["mode"],
            model=r["model"],
            prompt_tokens=r["prompt_tokens"],
            completion_tokens=r["completion_tokens"],
            total_tokens=r["total_tokens"],
            cost_usd=r["cost_usd"],
            latency_ms=r["latency_ms"],
        )
        for r in rows
    ]


async def _audit_ports(
    prompt: str,
    inquiry: str,
    fragment: str,
    ports: list[str],
    port_parameters: dict,
    model: str,
    run_id: int,
    answerhood: AnswerhoodSketch,
    presuppositions: list[Presupposition],
    port_layers: dict[str, str],
    resolution_mode: str,
) -> tuple[list[str], dict[str, str], dict[str, str], list[str]]:
    audit_prompt = json.dumps(
        {
            "prompt": prompt,
            "inquiry_type": inquiry,
            "logic_fragment": fragment,
            "resolution_mode": resolution_mode,
            "answerhood": answerhood.model_dump(),
            "presuppositions": [p.model_dump() for p in presuppositions],
            "candidate_required_ports": ports,
            "candidate_port_parameters": port_parameters,
            "candidate_port_layers": port_layers,
        },
        ensure_ascii=False,
        indent=2,
    )
    audit = await client.chat(
        messages=[
            {"role": "system", "content": _AUDIT_SYSTEM},
            {"role": "user", "content": audit_prompt},
        ],
        model=model,
        temperature=0.0,
    )
    db.log_call(run_id, "criteria_applicability", "criteria", audit, audit_prompt)

    parsed = parse_json_loose(audit.content)
    assessments = parsed.get("assessments") if isinstance(parsed, dict) else None
    if not isinstance(assessments, list):
        raise LLMError("Criteria applicability audit returned no assessments.")

    by_port: dict[str, dict] = {}
    for item in assessments:
        if not isinstance(item, dict):
            continue
        port = item.get("port")
        if port in ports and port not in by_port:
            by_port[port] = item

    # Fail closed: an omitted assessment is not silently treated as approval.
    if any(port not in by_port for port in ports):
        raise LLMError("Criteria applicability audit omitted candidate ports.")

    approved: list[str] = []
    rationale: dict[str, str] = {}
    layers: dict[str, str] = {}
    removed: list[str] = []
    for port in ports:
        item = by_port[port]
        reason = str(item.get("reason") or "").strip()
        if bool(item.get("applicable")) and reason:
            approved.append(port)
            rationale[port] = reason
            layer = item.get("layer") or port_layers.get(port) or "erotetic"
            if layer not in ("erotetic", "stack", "pragmatic"):
                layer = port_layers.get(port) or "erotetic"
            layers[port] = layer
        else:
            removed.append(port)

    if not approved:
        raise LLMError("Criteria applicability audit approved no usable ports.")
    return approved, rationale, layers, removed


def _persist_design(prompt: str, result: CriteriaDesignResult) -> CriteriaDesignResult:
    criteria_log.persist_design(
        run_id=result.run_id,
        prompt=prompt,
        design=result.model_dump(),
    )
    return result


async def design_criteria(prompt: str, model: str) -> CriteriaDesignResult:
    trimmed = prompt.strip()
    warnings: list[str] = []

    if not trimmed:
        run_id = db.create_run("criteria", model, "criteria", None)
        return _persist_design(
            trimmed,
            CriteriaDesignResult(
                run_id=run_id,
                model=model,
                bouncer={
                    "admitted": False,
                    "rejected_type": "empty_prompt",
                    "label": "Empty prompt",
                    "message": "Enter a prompt before generating criteria.",
                    "features": SurfaceFeatures().model_dump(),
                },
                criteria=None,
                calls=[],
                total_tokens=0,
                total_cost_usd=0.0,
                warnings=[],
            ),
        )

    doc_hash = _prompt_hash(trimmed)
    run_id = db.create_run("criteria", model, "criteria", doc_hash)
    user_prompt = _USER_TEMPLATE.format(prompt=trimmed)

    result = await client.chat(
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": user_prompt},
        ],
        model=model,
        temperature=0.1,
    )
    call_id = db.log_call(run_id, "criteria", "criteria", result, user_prompt)

    try:
        data = parse_json_loose(result.content)
    except LLMError:
        calls = _call_summaries(run_id)
        total_tokens = sum(c.total_tokens for c in calls)
        total_cost = sum(c.cost_usd for c in calls)
        return _persist_design(
            trimmed,
            CriteriaDesignResult(
                run_id=run_id,
                model=model,
                bouncer={
                    "admitted": False,
                    "rejected_type": "non_partitionable",
                    "label": "Parse failure",
                    "message": "Model returned unparseable criteria JSON.",
                    "features": SurfaceFeatures().model_dump(),
                },
                criteria=None,
                calls=calls,
                total_tokens=total_tokens,
                total_cost_usd=total_cost,
                warnings=["Failed to parse model JSON."],
            ),
        )

    if not isinstance(data, dict):
        data = {}

    features = _features_from(data.get("surface_features"))
    admitted = bool(data.get("admitted", False))

    calls = _call_summaries(run_id)
    total_tokens = sum(c.total_tokens for c in calls)
    total_cost = sum(c.cost_usd for c in calls)
    # Ensure cost matches ledger even if rows empty (shouldn't happen)
    if not total_cost and call_id:
        total_cost = cost_for(result.model, result.prompt_tokens, result.completion_tokens)

    if not admitted:
        return _persist_design(
            trimmed,
            CriteriaDesignResult(
                run_id=run_id,
                model=result.model,
                bouncer={
                    "admitted": False,
                    "rejected_type": data.get("rejected_type") or "non_partitionable",
                    "label": data.get("rejected_label") or "Rejected",
                    "message": data.get("rejected_message")
                    or "Prompt falls outside the design envelope.",
                    "features": features.model_dump(),
                },
                criteria=None,
                calls=calls,
                total_tokens=total_tokens,
                total_cost_usd=total_cost,
                warnings=warnings,
            ),
        )

    ports = _filter_ports(data.get("required_ports"))
    if not ports:
        raise LLMError("Criteria designer admitted the prompt but proposed no ports.")

    fragment = data.get("logic_fragment") or "classical_propositional"
    inquiry = data.get("inquiry_type") or "factual_closed"
    raw_params = data.get("port_parameters")
    port_parameters = raw_params if isinstance(raw_params, dict) else {}
    # Drop params for ports that are not required
    port_parameters = {k: v for k, v in port_parameters.items() if k in ports}

    answerhood = _answerhood_from(data.get("answerhood"))
    resolution_mode = _resolution_mode_from(data.get("resolution_mode"))
    presuppositions = _presuppositions_from(data.get("presuppositions"))
    port_layers = _port_layers_from(data.get("port_layers"), ports)
    prompt_fixes = str(data.get("prompt_fixes") or "").strip()
    prompt_leaves_open = str(data.get("prompt_leaves_open") or "").strip()

    ports, port_applicability, port_layers, removed = await _audit_ports(
        prompt=trimmed,
        inquiry=str(inquiry),
        fragment=str(fragment),
        ports=ports,
        port_parameters=port_parameters,
        model=model,
        run_id=run_id,
        answerhood=answerhood,
        presuppositions=presuppositions,
        port_layers=port_layers,
        resolution_mode=resolution_mode,
    )
    port_parameters = {k: v for k, v in port_parameters.items() if k in ports}
    if "revision_protocol" in ports:
        rp = port_parameters.get("revision_protocol")
        if not isinstance(rp, dict):
            rp = {}
        else:
            rp = dict(rp)
        rp["salience_weighted"] = True
        port_parameters["revision_protocol"] = rp
    if removed:
        warnings.append(
            "Applicability audit removed: " + ", ".join(removed) + "."
        )

    # Always rebuild this after the audit so removed ports cannot linger in it.
    template = _completeness(ports, str(fragment))
    calls = _call_summaries(run_id)
    total_tokens = sum(c.total_tokens for c in calls)
    total_cost = sum(c.cost_usd for c in calls)

    criteria = CriteriaObject(
        prompt_hash=doc_hash,
        inquiry_type=str(inquiry),
        logic_fragment=str(fragment),
        required_ports=ports,
        port_parameters=port_parameters,
        port_applicability=port_applicability,
        port_layers=port_layers,
        answerhood=answerhood,
        resolution_mode=resolution_mode,  # type: ignore[arg-type]
        presuppositions=presuppositions,
        prompt_fixes=prompt_fixes,
        prompt_leaves_open=prompt_leaves_open,
        version=CRITERIA_VERSION,
        completeness_template=template,
        surface_features=features,
    )

    note = (data.get("note") or "").strip() or (
        f"Admitted as {inquiry} ({resolution_mode}). "
        f"Criteria are a tailored subset of structural ports."
    )

    return _persist_design(
        trimmed,
        CriteriaDesignResult(
            run_id=run_id,
            model=result.model,
            bouncer={
                "admitted": True,
                "inquiry_type": str(inquiry),
                "features": features.model_dump(),
                "note": note,
            },
            criteria=criteria,
            calls=calls,
            total_tokens=total_tokens,
            total_cost_usd=total_cost,
            warnings=warnings,
        ),
    )


def _item_from_raw(
    raw: Any,
    *,
    default_kind: str,
    default_derived: list[str],
) -> EvidenceNeedItem | None:
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return None
        return EvidenceNeedItem(
            kind=default_kind,  # type: ignore[arg-type]
            statement=text,
            salience="medium",
            derived_from=list(default_derived),
        )
    if not isinstance(raw, dict):
        return None
    statement = str(raw.get("statement") or "").strip()
    if not statement:
        return None
    kind = raw.get("kind") or default_kind
    if kind not in ("scope", "settlement", "defeater", "class_hint"):
        kind = default_kind
    salience = raw.get("salience") or "medium"
    if salience not in ("high", "medium", "low"):
        salience = "medium"
    derived = raw.get("derived_from")
    if isinstance(derived, list):
        derived_from = [str(x) for x in derived if str(x).strip()]
    else:
        derived_from = list(default_derived)
    return EvidenceNeedItem(
        kind=kind,  # type: ignore[arg-type]
        statement=statement,
        salience=salience,  # type: ignore[arg-type]
        derived_from=derived_from,
    )


def _non_needs_for(criteria: CriteriaObject) -> list[EvidenceNonNeed]:
    out: list[EvidenceNonNeed] = []
    for port in criteria.required_ports:
        if port in _NEED_AUTHORIZING_PORTS and port != "canonical_form":
            continue
        if port == "canonical_form":
            # Scope absorbs canonical_form; still record as non-fetch endpoint.
            out.append(
                EvidenceNonNeed(
                    port=port,
                    reason=_NON_NEED_REASONS["canonical_form"],
                )
            )
            continue
        reason = _NON_NEED_REASONS.get(
            port,
            "Answer-facing port; does not authorize retrieval by itself.",
        )
        out.append(EvidenceNonNeed(port=port, reason=reason))
    return out


def _skeleton_evidence_needs(criteria: CriteriaObject, prompt: str) -> EvidenceNeedPlan:
    """Deterministic plan from audited criteria. Used as base and LLM fallback."""
    ports = set(criteria.required_ports)
    ah = criteria.answerhood
    params = criteria.port_parameters or {}
    mode = criteria.resolution_mode

    scope_parts: list[str] = []
    if mode == "mechanism_inference":
        scope_parts.append(
            "Mechanism-inference scope: prioritize observables and evidence that "
            "rule hypothesis cells or research programs in or out."
        )
    elif mode == "discourse_map":
        scope_parts.append(
            "Discourse-map scope: prioritize who said what and how positions relate."
        )
    elif mode == "mixed":
        scope_parts.append(
            "Mixed scope: keep mechanism-settling evidence distinct from discourse mapping."
        )
    if ah.direct_answer:
        scope_parts.append(ah.direct_answer.strip())
    elif ah.open_answerhood:
        scope_parts.append(ah.open_answerhood.strip())
    if criteria.prompt_fixes:
        scope_parts.append(f"Prompt fixes: {criteria.prompt_fixes.strip()}")
    if "canonical_form" in ports:
        cf = params.get("canonical_form")
        if isinstance(cf, dict) and cf:
            scope_parts.append(
                "Canonical form parameters: "
                + json.dumps(cf, ensure_ascii=False)[:400]
            )
        elif isinstance(cf, str) and cf.strip():
            scope_parts.append(cf.strip())
        else:
            scope_parts.append(
                "Respect the required canonical_form port when scoping finds."
            )
    if not scope_parts:
        scope_parts.append(
            f"Evidence must bear on this {criteria.inquiry_type} inquiry: "
            f"{prompt.strip()[:240]}"
        )
    scope = " ".join(scope_parts)

    settlement: list[EvidenceNeedItem] = []
    if "observation_map" in ports:
        om = params.get("observation_map")
        if isinstance(om, dict):
            for key, val in om.items():
                if isinstance(val, list):
                    for item in val[:6]:
                        text = str(item).strip()
                        if text:
                            settlement.append(
                                EvidenceNeedItem(
                                    kind="settlement",
                                    statement=f"Check observable for «{key}»: {text}",
                                    salience="high",
                                    derived_from=["observation_map"],
                                )
                            )
                elif val is not None and str(val).strip():
                    settlement.append(
                        EvidenceNeedItem(
                            kind="settlement",
                            statement=f"Check observable for «{key}»: {val}",
                            salience="high",
                            derived_from=["observation_map"],
                        )
                    )
        elif isinstance(om, list):
            for item in om[:8]:
                text = str(item).strip()
                if text:
                    settlement.append(
                        EvidenceNeedItem(
                            kind="settlement",
                            statement=text,
                            salience="high",
                            derived_from=["observation_map"],
                        )
                    )
        if not settlement:
            settlement.append(
                EvidenceNeedItem(
                    kind="settlement",
                    statement=(
                        "Find observations or measurements that would settle the "
                        "empirical answer assertions implied by this prompt."
                    ),
                    salience="high",
                    derived_from=["observation_map"],
                )
            )

    defeaters: list[EvidenceNeedItem] = []
    if "revision_protocol" in ports:
        rp = params.get("revision_protocol")
        listed: list[Any] = []
        if isinstance(rp, dict):
            raw_def = rp.get("defeaters") or rp.get("high_salience_defeaters") or []
            if isinstance(raw_def, list):
                listed = raw_def
            for key in ("trigger", "update"):
                if rp.get(key):
                    defeaters.append(
                        EvidenceNeedItem(
                            kind="defeater",
                            statement=f"Revision {key}: {rp.get(key)}",
                            salience="medium",
                            derived_from=["revision_protocol"],
                        )
                    )
        elif isinstance(rp, list):
            listed = rp
        for i, item in enumerate(listed[:8]):
            text = str(item).strip() if not isinstance(item, dict) else str(
                item.get("statement") or item.get("defeater") or item
            ).strip()
            if not text:
                continue
            salience = "high" if i < 3 else "medium"
            if isinstance(item, dict) and item.get("salience") in (
                "high",
                "medium",
                "low",
            ):
                salience = item["salience"]
            defeaters.append(
                EvidenceNeedItem(
                    kind="defeater",
                    statement=text,
                    salience=salience,  # type: ignore[arg-type]
                    derived_from=["revision_protocol"],
                )
            )
        if not defeaters:
            defeaters.append(
                EvidenceNeedItem(
                    kind="defeater",
                    statement=(
                        "Hunt high-salience defeaters that would overturn the "
                        "leading answer assertions under this prompt's horizon."
                    ),
                    salience="high",
                    derived_from=["revision_protocol"],
                )
            )

    class_hints: list[EvidenceNeedItem] = []
    if "source_class_ranking" in ports:
        scr = params.get("source_class_ranking")
        classes: list[Any] = []
        if isinstance(scr, dict):
            classes = scr.get("classes") or scr.get("ranking") or list(scr.values())
            if classes and not isinstance(classes, list):
                classes = [classes]
        elif isinstance(scr, list):
            classes = scr
        for item in classes[:8]:
            if isinstance(item, dict):
                name = str(
                    item.get("class")
                    or item.get("name")
                    or item.get("label")
                    or item
                ).strip()
            else:
                name = str(item).strip()
            if not name:
                continue
            class_hints.append(
                EvidenceNeedItem(
                    kind="class_hint",
                    statement=f"Prefer consulting evidence class: {name}",
                    salience="medium",
                    derived_from=["source_class_ranking"],
                )
            )
        if not class_hints:
            class_hints.append(
                EvidenceNeedItem(
                    kind="class_hint",
                    statement=(
                        "When gathering, note distinct evidence classes so the "
                        "eventual answer can weight them explicitly."
                    ),
                    salience="medium",
                    derived_from=["source_class_ranking"],
                )
            )

    return EvidenceNeedPlan(
        version=EVIDENCE_NEEDS_VERSION,
        scope=scope,
        settlement_checks=settlement,
        defeater_hunts=defeaters,
        class_hints=class_hints,
        non_needs=_non_needs_for(criteria),
        retrieval_status="planned_only",
    )


def _merge_need_lists(
    skeleton: list[EvidenceNeedItem],
    raw_list: Any,
    *,
    default_kind: str,
    default_derived: list[str],
) -> list[EvidenceNeedItem]:
    if not isinstance(raw_list, list) or not raw_list:
        return skeleton
    out: list[EvidenceNeedItem] = []
    for raw in raw_list[:12]:
        item = _item_from_raw(
            raw, default_kind=default_kind, default_derived=default_derived
        )
        if item:
            out.append(item)
    return out or skeleton


def _normalize_evidence_needs(
    raw: Any,
    criteria: CriteriaObject,
    prompt: str,
) -> tuple[EvidenceNeedPlan, list[str]]:
    warnings: list[str] = []
    skeleton = _skeleton_evidence_needs(criteria, prompt)
    data = raw if isinstance(raw, dict) else {}
    if not data:
        warnings.append("Evidence-need model returned empty JSON; used criteria skeleton.")
        return skeleton, warnings

    scope = str(data.get("scope") or "").strip() or skeleton.scope
    ports = set(criteria.required_ports)

    settlement = (
        _merge_need_lists(
            skeleton.settlement_checks,
            data.get("settlement_checks"),
            default_kind="settlement",
            default_derived=["observation_map"],
        )
        if "observation_map" in ports
        else []
    )
    defeaters = (
        _merge_need_lists(
            skeleton.defeater_hunts,
            data.get("defeater_hunts"),
            default_kind="defeater",
            default_derived=["revision_protocol"],
        )
        if "revision_protocol" in ports
        else []
    )
    class_hints = (
        _merge_need_lists(
            skeleton.class_hints,
            data.get("class_hints"),
            default_kind="class_hint",
            default_derived=["source_class_ranking"],
        )
        if "source_class_ranking" in ports
        else []
    )

    # Never invent needs for audited-out ports.
    if "observation_map" not in ports and settlement:
        warnings.append("Dropped settlement_checks; observation_map not required.")
        settlement = []
    if "revision_protocol" not in ports and defeaters:
        warnings.append("Dropped defeater_hunts; revision_protocol not required.")
        defeaters = []
    if "source_class_ranking" not in ports and class_hints:
        warnings.append("Dropped class_hints; source_class_ranking not required.")
        class_hints = []

    return (
        EvidenceNeedPlan(
            version=EVIDENCE_NEEDS_VERSION,
            scope=scope,
            settlement_checks=settlement,
            defeater_hunts=defeaters,
            class_hints=class_hints,
            non_needs=_non_needs_for(criteria),
            retrieval_status="planned_only",
        ),
        warnings,
    )


_NEEDS_SYSTEM = """You derive an evidence-need plan from an audited criteria object.

You receive a user prompt and a criteria object (required ports already
fail-closed audited). Your job is NOT to search the web and NOT to answer.
Emit what evidence would need to be gathered later to settle or responsibly
defeat the best answer under these criteria.

DIRECTION OF FIT
- Derive needs FROM the criteria (answerhood, resolution_mode, canonical scope,
  surviving observation_map / revision_protocol / source_class_ranking
  parameters).
- Do NOT invent needs for ports that are not in required_ports.
- Do NOT treat answer ports as search endpoints. Ports stay answer-facing.
- theorem, layer_separation, and meta_exhaustiveness shape the answer only;
  list them under non_needs, never as fetch targets.
- source_class_ranking yields class_hints (which classes matter), not a
  retrieval ranker config.
- If resolution_mode is mechanism_inference: settlement_checks and
  defeater_hunts must target observables and evidence that would rule
  hypothesis cells or research programs in or out. Do NOT plan needs as
  "arguments on both sides" or debate coverage.
- If resolution_mode is discourse_map: needs may target who said what and
  position structure when that satisfies answerhood.
- If mixed: keep mechanism-settling needs distinct from discourse-mapping needs.

RULES
- Be concrete and prompt-specific.
- Prefer high-salience defeaters when revision_protocol is required. Salience
  means importance under subject and working horizon. Keep exotic or long-
  horizon defeaters few and low-salience, but include at least one brief
  subject-salient rare/long-horizon defeater hunt when such tails are
  meaningful for the subject (omission of all such tails is wrong).
- If observation_map is absent, settlement_checks must be [].
- If revision_protocol is absent, defeater_hunts must be [].
- If source_class_ranking is absent, class_hints must be [].
- Do not invent fake sources, URLs, or citations.
- Do not use em dashes.

Return ONE JSON object only:
{
  "scope": "what the inquiry is about for relevance filtering",
  "settlement_checks": [
    {"kind": "settlement", "statement": "...", "salience": "high|medium|low",
     "derived_from": ["observation_map"]}
  ],
  "defeater_hunts": [
    {"kind": "defeater", "statement": "...", "salience": "high|medium|low",
     "derived_from": ["revision_protocol"]}
  ],
  "class_hints": [
    {"kind": "class_hint", "statement": "...", "salience": "medium",
     "derived_from": ["source_class_ranking"]}
  ]
}
"""


async def plan_evidence_needs(
    prompt: str,
    criteria: CriteriaObject,
    model: str,
    run_id: int,
) -> EvidenceNeedResult:
    trimmed = prompt.strip()
    if not trimmed:
        raise LLMError("Empty prompt; cannot plan evidence needs.")
    if not criteria.required_ports:
        raise LLMError("Criteria object has no required ports.")

    payload = {
        "prompt": trimmed,
        "criteria": criteria.model_dump(),
        "instruction": (
            "Derive evidence needs only from surviving required_ports and "
            "port_parameters. No retrieval in this stage."
        ),
    }
    user_prompt = json.dumps(payload, ensure_ascii=False, indent=2)

    result = await client.chat(
        messages=[
            {"role": "system", "content": _NEEDS_SYSTEM},
            {"role": "user", "content": user_prompt},
        ],
        model=model,
        temperature=0.1,
    )
    db.log_call(run_id, "criteria_evidence_needs", "criteria", result, user_prompt)

    warnings: list[str] = []
    try:
        parsed = parse_json_loose(result.content)
    except LLMError:
        parsed = {}
        warnings.append("Failed to parse evidence-need JSON; used criteria skeleton.")

    plan, normalize_warnings = _normalize_evidence_needs(parsed, criteria, trimmed)
    warnings.extend(normalize_warnings)

    calls = _call_summaries(run_id)
    out = EvidenceNeedResult(
        run_id=run_id,
        model=result.model,
        evidence_needs=plan,
        calls=calls,
        total_tokens=sum(c.total_tokens for c in calls),
        total_cost_usd=sum(c.cost_usd for c in calls),
        warnings=warnings,
    )
    criteria_log.persist_evidence_needs(
        run_id=run_id,
        prompt=trimmed,
        evidence_needs=out.model_dump(),
    )
    return out


_GATHER_SYSTEM = """You gather provenance-bearing evidence for an investigation stack.

You receive a user prompt, audited criteria, and an evidence_needs plan. Use the
web_search tool to find sources that address the planned needs. Then return a
JSON object of claim atoms with provenance.

DIRECTION OF FIT
- Search only for needs listed under settlement_checks, defeater_hunts, and
  class_hints (plus scope for relevance). Do not invent fetch targets for
  theorem / layer_separation / meta_exhaustiveness.
- Prefer high-salience needs first. Cap effort: a few strong finds beat many
  weak ones. Prefer at most ~12 finds total.
- Each find must be a claim someone/something said or reported, with source
  title and URL from search results when available.
- Do NOT invent URLs, titles, or publishers. If search did not yield a URL,
  leave source_url empty and say so in confidence_note.
- Do not answer the prompt as a finished report. Gathering only.

Return ONE JSON object only (after searching):
{
  "finds": [
    {
      "id": "f1",
      "need_kind": "settlement|defeater|class_hint|scope",
      "need_statement": "which need this addresses",
      "claim": "atomic who-said-what claim",
      "source_title": "...",
      "source_url": "https://...",
      "source_publisher": "...",
      "quoted_or_paraphrase": "brief support from the source",
      "published_at": "optional date string",
      "confidence_note": "limits / why this helps",
      "salience": "high|medium|low"
    }
  ],
  "unmet_needs": ["need statements still unfilled after search"]
}
"""


def _active_need_count(plan: EvidenceNeedPlan) -> int:
    return (
        len(plan.settlement_checks)
        + len(plan.defeater_hunts)
        + len(plan.class_hints)
    )


def _normalize_gather(
    raw: Any,
    *,
    citations: list[str],
    plan: EvidenceNeedPlan,
) -> tuple[GatherPacket, list[str]]:
    warnings: list[str] = []
    data = raw if isinstance(raw, dict) else {}
    finds_raw = data.get("finds") if isinstance(data.get("finds"), list) else []
    finds: list[GatheredFind] = []
    cite_set = {c.rstrip("/") for c in citations}

    for i, item in enumerate(finds_raw[:16]):
        if not isinstance(item, dict):
            continue
        claim = str(item.get("claim") or "").strip()
        if not claim:
            continue
        need_kind = item.get("need_kind") or "settlement"
        if need_kind not in ("scope", "settlement", "defeater", "class_hint"):
            need_kind = "settlement"
        salience = item.get("salience") or "medium"
        if salience not in ("high", "medium", "low"):
            salience = "medium"
        url = str(item.get("source_url") or "").strip()
        if url and cite_set and url.rstrip("/") not in cite_set:
            # Keep the URL but flag; model may normalize redirects.
            pass
        if url and not (url.startswith("http://") or url.startswith("https://")):
            warnings.append(f"Dropped non-http URL on find {i + 1}.")
            url = ""
        fid = str(item.get("id") or f"f{i + 1}").strip() or f"f{i + 1}"
        finds.append(
            GatheredFind(
                id=fid,
                need_kind=need_kind,  # type: ignore[arg-type]
                need_statement=str(item.get("need_statement") or "").strip(),
                claim=claim,
                source_title=str(item.get("source_title") or "").strip(),
                source_url=url,
                source_publisher=str(item.get("source_publisher") or "").strip(),
                quoted_or_paraphrase=str(
                    item.get("quoted_or_paraphrase") or ""
                ).strip(),
                published_at=str(item.get("published_at") or "").strip(),
                confidence_note=str(item.get("confidence_note") or "").strip(),
                salience=salience,  # type: ignore[arg-type]
            )
        )

    unmet_raw = data.get("unmet_needs")
    unmet: list[str] = []
    if isinstance(unmet_raw, list):
        unmet = [str(x).strip() for x in unmet_raw if str(x).strip()][:20]
    elif not finds and _active_need_count(plan) > 0:
        unmet = [
            n.statement
            for n in (
                plan.settlement_checks + plan.defeater_hunts + plan.class_hints
            )
        ][:12]
        warnings.append("Gather returned no finds; marking active needs unmet.")

    status: str = "gathered" if finds else (
        "gather_failed" if _active_need_count(plan) > 0 else "skipped"
    )
    note = (
        f"{len(finds)} provenance-bearing find(s) from web_search."
        if finds
        else "Gather produced no provenance-bearing finds."
    )
    return (
        GatherPacket(
            version=GATHER_VERSION,
            finds=finds,
            unmet_needs=unmet,
            citations=list(citations),
            retrieval_status=status,  # type: ignore[arg-type]
            note=note,
        ),
        warnings,
    )


def _with_needs_status(
    plan: EvidenceNeedPlan,
    status: str,
    note: str,
) -> EvidenceNeedPlan:
    data = plan.model_dump()
    data["retrieval_status"] = status
    data["note"] = note
    return EvidenceNeedPlan.model_validate(data)


async def gather_evidence(
    prompt: str,
    criteria: CriteriaObject,
    evidence_needs: EvidenceNeedPlan,
    model: str,
    run_id: int,
) -> GatherResult:
    trimmed = prompt.strip()
    if not trimmed:
        raise LLMError("Empty prompt; cannot gather evidence.")
    if not criteria.required_ports:
        raise LLMError("Criteria object has no required ports.")

    warnings: list[str] = []

    if _active_need_count(evidence_needs) == 0:
        packet = GatherPacket(
            version=GATHER_VERSION,
            finds=[],
            unmet_needs=[],
            citations=[],
            retrieval_status="skipped",
            note=(
                "No settlement, defeater, or class-hint needs authorized "
                "retrieval for this run."
            ),
        )
        updated = _with_needs_status(
            evidence_needs,
            "skipped",
            packet.note,
        )
        calls = _call_summaries(run_id)
        out = GatherResult(
            run_id=run_id,
            model=model,
            gather=packet,
            evidence_needs=updated,
            calls=calls,
            total_tokens=sum(c.total_tokens for c in calls),
            total_cost_usd=sum(c.cost_usd for c in calls),
            warnings=warnings,
        )
        criteria_log.persist_gather(
            run_id=run_id,
            prompt=trimmed,
            gather=out.model_dump(),
        )
        return out

    payload = {
        "prompt": trimmed,
        "criteria": {
            "inquiry_type": criteria.inquiry_type,
            "resolution_mode": criteria.resolution_mode,
            "required_ports": criteria.required_ports,
            "answerhood": criteria.answerhood.model_dump(),
            "prompt_fixes": criteria.prompt_fixes,
            "prompt_leaves_open": criteria.prompt_leaves_open,
        },
        "evidence_needs": evidence_needs.model_dump(),
        "instruction": (
            "Use web_search against these needs. Return JSON finds with "
            "real provenance. Do not invent URLs."
        ),
    }
    user_prompt = json.dumps(payload, ensure_ascii=False, indent=2)

    try:
        result = await client.responses_with_web_search(
            model=model,
            system=_GATHER_SYSTEM,
            user=user_prompt,
            temperature=0.1,
        )
    except LLMError as exc:
        warnings.append(f"web_search gather failed: {exc}")
        packet = GatherPacket(
            version=GATHER_VERSION,
            finds=[],
            unmet_needs=[
                n.statement
                for n in (
                    evidence_needs.settlement_checks
                    + evidence_needs.defeater_hunts
                    + evidence_needs.class_hints
                )
            ][:12],
            citations=[],
            retrieval_status="gather_failed",
            note=str(exc)[:400],
        )
        updated = _with_needs_status(
            evidence_needs,
            "gather_failed",
            "Gather failed; needs remain unfilled.",
        )
        # Still log a synthetic ledger row via empty chat? Skip; no tokens.
        calls = _call_summaries(run_id)
        out = GatherResult(
            run_id=run_id,
            model=model,
            gather=packet,
            evidence_needs=updated,
            calls=calls,
            total_tokens=sum(c.total_tokens for c in calls),
            total_cost_usd=sum(c.cost_usd for c in calls),
            warnings=warnings,
        )
        criteria_log.persist_gather(
            run_id=run_id,
            prompt=trimmed,
            gather=out.model_dump(),
        )
        return out

    db.log_call(run_id, "criteria_gather", "criteria", result, user_prompt)

    try:
        parsed = parse_json_loose(result.content)
    except LLMError:
        parsed = {}
        warnings.append("Failed to parse gather JSON; treating as empty finds.")

    packet, norm_warnings = _normalize_gather(
        parsed,
        citations=list(result.citations or []),
        plan=evidence_needs,
    )
    warnings.extend(norm_warnings)

    updated = _with_needs_status(
        evidence_needs,
        packet.retrieval_status
        if packet.retrieval_status in ("gathered", "gather_failed", "skipped")
        else "gathered",
        packet.note,
    )

    calls = _call_summaries(run_id)
    out = GatherResult(
        run_id=run_id,
        model=result.model,
        gather=packet,
        evidence_needs=updated,
        calls=calls,
        total_tokens=sum(c.total_tokens for c in calls),
        total_cost_usd=sum(c.cost_usd for c in calls),
        warnings=warnings,
    )
    criteria_log.persist_gather(
        run_id=run_id,
        prompt=trimmed,
        gather=out.model_dump(),
    )
    return out


_PORT_TITLES = {
    "canonical_form": "Canonical form",
    "theorem": "Theorem",
    "observation_map": "Observation map",
    "layer_separation": "Layer separation",
    "revision_protocol": "Revision protocol",
    "meta_exhaustiveness": "Meta-exhaustiveness",
    "source_class_ranking": "Source class ranking",
}

_ANSWER_SYSTEM = """You draft a criteria-satisfying answer for an investigation stack.

You receive a user prompt, a criteria object (including excavated answerhood
conditions and presuppositions), optionally an evidence_needs plan, and
optionally a gather packet of provenance-bearing finds. Your job is to give the
best substantive answer you can to the prompt, using gathered finds when
present plus what you judge to be true or best supported, and to present that
information in the forms the required ports expect while resolving the
excavated answerhood conditions.

This is investigation support, not a final truth verdict: keep defeaters and
residual uncertainty visible. But do not hide behind empty structure.

RULES
- Answer the prompt. Ports are the shape of a good answer, not a substitute for
  one. Satisfy the answerhood.direct_answer (or open_answerhood) conditions.
  Do not resolve a factual who/what/when/why question into a vacuous partition
  when you have a real judgment about the matter.
- Respect partition discipline: if answerhood.partition_licensed is false, do
  not invent fake exhaustive cells. If true, resolve which cell holds.
- Respect resolution_mode:
  * mechanism_inference: resolve via observables and hypothesis/program
    support or ruling-out. Do not treat debate completeness or unbacked
    numeric posteriors as resolution. Prefer supported / ruled out /
    underdetermined.
  * discourse_map: mapping positions and speakers may satisfy answerhood.
  * mixed: keep mechanism claims separate from discourse claims.
- Admissible partial answers or presupposition challenges are allowed only when
  the criteria mark them in-bounds; otherwise prefer a direct resolution.
- If gather is present with finds: prefer those provenance-bearing claims for
  settlement and defeaters. Cite source_title / source_url when you rely on a
  find. Attach find_ids (from gather.finds[].id) on assertions and defeaters
  you rely on. Do not invent find_ids or URLs.
- If gather is missing, failed, or empty: use your knowledge and judgment, and
  say under residual_uncertainty which evidence_needs remain unmet. Do NOT
  pretend retrieval filled them. Leave find_ids empty.
- If evidence_needs is present with retrieval_status planned_only: treat it as
  an unsettled plan only.
- Fill every required port with content that matches its role AND carries the
  substance of your answer. Port prose should encode your actual view, not a
  schema lecture.
- When revision_protocol is required, satisfy salience-weighted defeaters:
  high-salience first (importance under subject and working horizon); at least
  a brief subject-salient rare/long-horizon note; no exotic domination.
  Omission of all such tails is a failure. Tag each defeater with salience.
- When the prompt left horizon or conditioning open, state the working query
  schema you adopted in working_query_schema (horizons / scenario axes) and
  what remains incomplete. Do not pretend calendar years are an exhaustive
  licensed partition.
- Speak in answer assertions (statements the response asks readers to accept).
  Name real actors, events, and findings when they are part of your judgment.
- Prefer deterministic structure under the declared logic fragment over vague
  probability talk, without evacuating the answer. Do not dress ordinary
  forecasts as theorems.
- Do not use em dashes in any text you write.
- Do not invent fake citations, URLs, or document titles.
- If the honest answer is uncertain, contested, or incomplete, state the leading
  account(s) and why, then list defeaters. Do not replace the answer with pure
  meta-structure.

Return ONE JSON object only:
{
  "headline": "one-sentence direct answer to the prompt",
  "summary": "short plain-language overview (2-4 sentences) of what you judge true",
  "working_query_schema": "working horizons/axes adopted, or empty if not needed",
  "sections": [
    {
      "port": "<required port id>",
      "title": "human label",
      "body": "substantive attachment for this port, carrying your actual answer",
      "items": ["optional bullets"]
    }
  ],
  "assertions": [
    {
      "statement": "answer assertion you are asking the reader to accept",
      "basis": "why you judge it true or best supported under the declared logic",
      "find_ids": ["optional gather find ids supporting this assertion"],
      "defeaters": [
        {
          "text": "what would overturn it",
          "salience": "high|medium|low",
          "find_ids": ["optional gather find ids"]
        }
      ]
    }
  ],
  "residual_uncertainty": ["what remains open"]
}

Include exactly one section per required port, in the same order as
required_ports. Include at least one substantive assertion that answers the
prompt when the inquiry warrants it.
"""


def _filter_find_ids(raw: Any, allowed: set[str] | None) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        fid = str(item).strip()
        if not fid:
            continue
        if allowed is not None and fid not in allowed:
            continue
        if fid not in out:
            out.append(fid)
    return out


def _normalize_defeater(
    raw: Any,
    *,
    allowed_finds: set[str] | None,
) -> AnswerDefeater | None:
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return None
        return AnswerDefeater(text=text, salience="medium", find_ids=[])
    if not isinstance(raw, dict):
        return None
    text = str(raw.get("text") or raw.get("statement") or raw.get("defeater") or "").strip()
    if not text:
        return None
    salience = raw.get("salience") or "medium"
    if salience not in ("high", "medium", "low"):
        salience = "medium"
    return AnswerDefeater(
        text=text,
        salience=salience,  # type: ignore[arg-type]
        find_ids=_filter_find_ids(raw.get("find_ids"), allowed_finds),
    )


def _working_schema_fallback(criteria: CriteriaObject, explicit: str) -> str:
    if explicit:
        return explicit
    params = criteria.port_parameters or {}
    cf = params.get("canonical_form")
    if isinstance(cf, str) and cf.strip():
        return cf.strip()
    if isinstance(cf, dict) and cf:
        return json.dumps(cf, ensure_ascii=False)[:500]
    ah = criteria.answerhood
    if ah.open_answerhood.strip():
        return ah.open_answerhood.strip()
    if criteria.prompt_leaves_open.strip():
        return (
            "Working frame still open; prompt left: "
            + criteria.prompt_leaves_open.strip()
        )
    return ""


def _normalize_answer(
    raw: Any,
    criteria: CriteriaObject,
    gather: GatherPacket | None = None,
) -> tuple[CriteriaAnswer, list[str]]:
    warnings: list[str] = []
    data = raw if isinstance(raw, dict) else {}
    allowed_finds = (
        {f.id for f in gather.finds if f.id} if gather is not None else None
    )

    headline = str(data.get("headline") or "").strip() or "Draft answer unavailable."
    summary = str(data.get("summary") or "").strip()
    working = _working_schema_fallback(
        criteria,
        str(data.get("working_query_schema") or "").strip(),
    )

    by_port: dict[str, dict] = {}
    raw_sections = data.get("sections")
    if isinstance(raw_sections, list):
        for item in raw_sections:
            if not isinstance(item, dict):
                continue
            port = item.get("port")
            if isinstance(port, str) and port in criteria.required_ports and port not in by_port:
                by_port[port] = item

    sections: list[AnswerSection] = []
    for port in criteria.required_ports:
        item = by_port.get(port)
        title = _PORT_TITLES.get(port, port)
        if item is None:
            warnings.append(f"Answer omitted port «{port}»; inserted placeholder.")
            sections.append(
                AnswerSection(
                    port=port,
                    title=title,
                    body="No attachment was returned for this required port.",
                    items=[],
                )
            )
            continue
        items_raw = item.get("items")
        items = (
            [str(x).strip() for x in items_raw if str(x).strip()]
            if isinstance(items_raw, list)
            else []
        )
        sections.append(
            AnswerSection(
                port=port,
                title=str(item.get("title") or title).strip() or title,
                body=str(item.get("body") or "").strip(),
                items=items,
            )
        )

    assertions: list[AnswerAssertion] = []
    raw_assertions = data.get("assertions")
    if isinstance(raw_assertions, list):
        for item in raw_assertions:
            if not isinstance(item, dict):
                continue
            statement = str(item.get("statement") or "").strip()
            if not statement:
                continue
            defeaters_raw = item.get("defeaters")
            defeaters: list[AnswerDefeater] = []
            if isinstance(defeaters_raw, list):
                for d in defeaters_raw:
                    normalized = _normalize_defeater(d, allowed_finds=allowed_finds)
                    if normalized:
                        defeaters.append(normalized)
            assertions.append(
                AnswerAssertion(
                    statement=statement,
                    basis=str(item.get("basis") or "").strip(),
                    defeaters=defeaters,
                    find_ids=_filter_find_ids(item.get("find_ids"), allowed_finds),
                )
            )

    residual_raw = data.get("residual_uncertainty")
    residual = (
        [str(x).strip() for x in residual_raw if str(x).strip()]
        if isinstance(residual_raw, list)
        else []
    )

    return (
        CriteriaAnswer(
            headline=headline,
            summary=summary,
            sections=sections,
            assertions=assertions,
            residual_uncertainty=residual,
            working_query_schema=working,
        ),
        warnings,
    )


async def answer_to_criteria(
    prompt: str,
    criteria: CriteriaObject,
    model: str,
    run_id: int,
    evidence_needs: EvidenceNeedPlan | None = None,
    gather: GatherPacket | None = None,
) -> CriteriaAnswerResult:
    trimmed = prompt.strip()
    if not trimmed:
        raise LLMError("Empty prompt; cannot generate a criteria-satisfying answer.")
    if not criteria.required_ports:
        raise LLMError("Criteria object has no required ports.")

    payload: dict[str, Any] = {
        "prompt": trimmed,
        "criteria": criteria.model_dump(),
    }
    if evidence_needs is not None:
        payload["evidence_needs"] = evidence_needs.model_dump()
    if gather is not None:
        payload["gather"] = gather.model_dump()
    user_prompt = json.dumps(payload, ensure_ascii=False, indent=2)

    result = await client.chat(
        messages=[
            {"role": "system", "content": _ANSWER_SYSTEM},
            {"role": "user", "content": user_prompt},
        ],
        model=model,
        temperature=0.2,
    )
    db.log_call(run_id, "criteria_answer", "criteria", result, user_prompt)

    warnings: list[str] = []
    try:
        parsed = parse_json_loose(result.content)
    except LLMError:
        parsed = {}
        warnings.append("Failed to parse answer JSON; returning placeholders.")

    answer, normalize_warnings = _normalize_answer(parsed, criteria, gather)
    warnings.extend(normalize_warnings)

    calls = _call_summaries(run_id)
    out = CriteriaAnswerResult(
        run_id=run_id,
        model=result.model,
        answer=answer,
        evidence_needs=evidence_needs,
        gather=gather,
        calls=calls,
        total_tokens=sum(c.total_tokens for c in calls),
        total_cost_usd=sum(c.cost_usd for c in calls),
        warnings=warnings,
    )
    criteria_log.persist_answer(
        run_id=run_id,
        prompt=trimmed,
        answer=out.model_dump(),
    )
    return out
