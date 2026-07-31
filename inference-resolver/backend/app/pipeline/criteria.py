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
    AnswerhoodSketch,
    AnswerSection,
    CallSummary,
    CriteriaAnswer,
    CriteriaAnswerResult,
    CriteriaDesignResult,
    CriteriaObject,
    Presupposition,
    SurfaceFeatures,
)
from .. import criteria_log, db
from ..config import cost_for

CRITERIA_VERSION = "criteria-schema/v2"

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
2. SEPARATE LAYERS: distinguish criteria the question itself implies (erotetic)
   from stack norms you add (stack) from chatbot/helpfulness defaults the bare
   interrogative does not fix (pragmatic). Prefer erotetic; add stack only where
   the best answer still needs it; add pragmatic rarely and label it.
3. ENCODE: map the excavation onto the fixed port schema. Do not start from
   port shopping. Every required port must catch a failure of answering THIS
   prompt. If it only catches "failure to look like our stack," do not require it.
4. MARK UNDERDETERMINATION: say what the prompt fixes vs what remains a choice.

RULES
- Criteria are requirements on the eventual answer only. Do not emit criteria
  about upstream search, retrieval, ingestion, or how sources are pulled in.
- Criteria stay abstract: never hard-code domain-specific hypotheses or content.
- Prefer deterministic theorems + explicit observation maps over free-form
  probability language when the question licenses that form.
- Keep intersubjective (publicly checkable) and agent-relative layers
  syntactically separate when both appear.
- Every non-trivial assertion made by the eventual answer needs a revision
  protocol (declared defeaters). These answer assertions are not the source
  claims that may later be ingested as evidence.
- Meta-exhaustiveness requires coverage of the answer space when the question
  makes completeness meaningful. Concrete enumeration is allowed when it
  strengthens that coverage; do not impose self-limiting "do not enumerate"
  constraints.
- Prefer ambitious criteria that tighten answerhood (clearer resolution
  conditions). Do not smuggle unasked exams.
- The port schema never changes; only required_ports and port_parameters vary.
- Generated criteria are a working schema for this prompt, revisable when a
  better answer reveals a better question-answer complex. They are not a rigid
  prior the answer must cosplay.
- PARTITION DISCIPLINE: if the prompt is partition-like (yes/no, who among
  alternatives, closed identification with clear cells), canonical_form should
  state the cells. If the prompt is open, do NOT invent a fake exhaustive
  partition to look structural. Use open_answerhood: what counts as a resolving
  contribution and what remains essentially incomplete.
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
  structural driver, or bounding constraint any evidence could bear on. Long
  horizon or open-endedness alone is not enough: if standing regularities,
  trends, mechanisms, or scenario partitions exist that evidence could speak
  to, ADMIT as predictive_constrained and let canonical_form declare the
  partition or conditioning frame.
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
   surplus that is still necessary for the best answer. Drop ports that only
   enforce looking like the stack. If partition_licensed is false, reject
   canonical_form / meta_exhaustiveness parameters that invent a fake
   exhaustive partition; open answerhood is allowed instead.

Port contracts:
- canonical_form: fixes what is being asked as a proposition, partition, or
  query schema when the question's form licenses that; for open questions,
  may fix an open query schema without fake cells.
- theorem: supplies a deterministic derivation under declared logic. Applicable
  only when the inquiry supports a genuine derivational constraint; do not use
  it as a grand name for an ordinary empirical answer assertion or forecast.
- observation_map: operationalizes an abstract answer assertion by mapping it
  to observable predicates. It does NOT prove a future prediction and must not
  be required merely because a prompt is empirical or predictive. For a
  forecast it is applicable only if defining observable settlement conditions
  materially resolves ambiguity that canonical_form does not already resolve.
- layer_separation: separates publicly checkable answer assertions from
  agent-relative values, preferences, or perspectives. Applicable only when
  both layers are present or likely to be conflated.
- revision_protocol: declares defeaters and update rules for assertions made by
  the eventual answer, not source claims ingested as evidence. Applicable to
  any non-trivial empirical, causal, comparative, or predictive answer
  assertion.
- meta_exhaustiveness: requires the answer to cover the structure of the
  answer space when completeness is meaningful. Enumeration is welcome when it
  helps prove coverage. Do not invent exhaustiveness the question does not
  license.
- source_class_ranking: requires the answer itself to state how distinct
  evidence classes it relies on are weighted. Not applicable merely because
  retrieval will consult sources. Approve only when the best answer must make
  that ranking explicit as part of its content.

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
) -> tuple[list[str], dict[str, str], dict[str, str], list[str]]:
    audit_prompt = json.dumps(
        {
            "prompt": prompt,
            "inquiry_type": inquiry,
            "logic_fragment": fragment,
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
    )
    port_parameters = {k: v for k, v in port_parameters.items() if k in ports}
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
        presuppositions=presuppositions,
        prompt_fixes=prompt_fixes,
        prompt_leaves_open=prompt_leaves_open,
        version=CRITERIA_VERSION,
        completeness_template=template,
        surface_features=features,
    )

    note = (data.get("note") or "").strip() or (
        f"Admitted as {inquiry}. Criteria are a tailored subset of structural ports."
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

You receive a user prompt and a criteria object (including excavated answerhood
conditions and presuppositions). Your job is to give the best substantive answer
you can to the prompt, using what you judge to be true or best supported, and to
present that information in the forms the required ports expect while resolving
the excavated answerhood conditions.

This is investigation support, not a final truth verdict: keep defeaters and
residual uncertainty visible. But do not hide behind empty structure.

RULES
- Answer the prompt. Ports are the shape of a good answer, not a substitute for
  one. Satisfy the answerhood.direct_answer (or open_answerhood) conditions.
  Do not resolve a factual who/what/when/why question into a vacuous partition
  when you have a real judgment about the matter.
- Respect partition discipline: if answerhood.partition_licensed is false, do
  not invent fake exhaustive cells. If true, resolve which cell holds.
- Admissible partial answers or presupposition challenges are allowed only when
  the criteria mark them in-bounds; otherwise prefer a direct resolution.
- Use your knowledge and judgment about what is true or best supported. Broad
  "evidence" here means the grounds of that judgment: known facts, established
  reports, mechanisms, base rates, competing accounts, and their limits. You are
  not required to run an external search tool in this stage.
- Fill every required port with content that matches its role AND carries the
  substance of your answer. Port prose should encode your actual view, not a
  schema lecture.
- Speak in answer assertions (statements the response asks readers to accept),
  not source claims as a bibliographic exercise. Name real actors, events, and
  findings when they are part of your judgment.
- Prefer deterministic structure under the declared logic fragment over vague
  probability talk, without evacuating the answer.
- Do not use em dashes in any text you write.
- Do not invent fake citations, URLs, or document titles. If you lack grounding,
  say so under residual_uncertainty and still give the best candid answer you
  can, with clear defeaters.
- If the honest answer is uncertain, contested, or incomplete, state the leading
  account(s) and why, then list defeaters. Do not replace the answer with pure
  meta-structure.

Return ONE JSON object only:
{
  "headline": "one-sentence direct answer to the prompt",
  "summary": "short plain-language overview (2-4 sentences) of what you judge true",
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
      "defeaters": ["what would overturn it"]
    }
  ],
  "residual_uncertainty": ["what remains open"]
}

Include exactly one section per required port, in the same order as
required_ports. Include at least one substantive assertion that answers the
prompt when the inquiry warrants it.
"""


def _normalize_answer(raw: Any, criteria: CriteriaObject) -> tuple[CriteriaAnswer, list[str]]:
    warnings: list[str] = []
    data = raw if isinstance(raw, dict) else {}

    headline = str(data.get("headline") or "").strip() or "Draft answer unavailable."
    summary = str(data.get("summary") or "").strip()

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
            defeaters = (
                [str(x).strip() for x in defeaters_raw if str(x).strip()]
                if isinstance(defeaters_raw, list)
                else []
            )
            assertions.append(
                AnswerAssertion(
                    statement=statement,
                    basis=str(item.get("basis") or "").strip(),
                    defeaters=defeaters,
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
        ),
        warnings,
    )


async def answer_to_criteria(
    prompt: str,
    criteria: CriteriaObject,
    model: str,
    run_id: int,
) -> CriteriaAnswerResult:
    trimmed = prompt.strip()
    if not trimmed:
        raise LLMError("Empty prompt; cannot generate a criteria-satisfying answer.")
    if not criteria.required_ports:
        raise LLMError("Criteria object has no required ports.")

    payload = {
        "prompt": trimmed,
        "criteria": criteria.model_dump(),
    }
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

    answer, normalize_warnings = _normalize_answer(parsed, criteria)
    warnings.extend(normalize_warnings)

    calls = _call_summaries(run_id)
    out = CriteriaAnswerResult(
        run_id=run_id,
        model=result.model,
        answer=answer,
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
