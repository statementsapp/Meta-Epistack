from __future__ import annotations

import hashlib
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import criteria_log, db
from .config import DATA_DIR, settings
from .llm import LLMError, MissingKeyError, client

# Importing the stage modules registers them in STAGE_REGISTRY (extract first,
# then resolve). Order of import defines pipeline order.
from .pipeline import base
from .pipeline import extract as _extract  # noqa: F401
from .pipeline import resolve as _resolve  # noqa: F401
from .models import (
    CallSummary,
    Claim,
    CriteriaAnswerRequest,
    CriteriaAnswerResult,
    CriteriaAuditRequest,
    CriteriaDesignRequest,
    CriteriaDesignResult,
    EvidenceNeedRequest,
    EvidenceNeedResult,
    GatherRequest,
    GatherResult,
    RunRequest,
    RunResult,
    StageSummary,
)
from .pipeline import criteria as criteria_design

ARTIFACT_SCHEMA_VERSION = 1


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Inference Resolver", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _doc_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _build_result(run_id: int, state: base.RunState, mode: str, model: str) -> RunResult:
    rows = db.calls_for_run(run_id)
    calls = [
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

    by_stage: dict[str, StageSummary] = {}
    for r in rows:
        s = by_stage.get(r["stage"])
        if s is None:
            s = StageSummary(
                stage=r["stage"],
                calls=0,
                prompt_tokens=0,
                completion_tokens=0,
                total_tokens=0,
                cost_usd=0.0,
            )
            by_stage[r["stage"]] = s
        s.calls += 1
        s.prompt_tokens += r["prompt_tokens"]
        s.completion_tokens += r["completion_tokens"]
        s.total_tokens += r["total_tokens"]
        s.cost_usd += r["cost_usd"]

    total_tokens = sum(c.total_tokens for c in calls)
    total_cost = sum(c.cost_usd for c in calls)
    cost_per_link = total_cost / len(state.links) if state.links else None

    return RunResult(
        run_id=run_id,
        mode=mode,
        model=model,
        input_kind=state.input_kind,
        claims=state.claims,
        links=state.links,
        calls=calls,
        stage_summary=list(by_stage.values()),
        total_tokens=total_tokens,
        total_cost_usd=total_cost,
        cost_per_link=cost_per_link,
        warnings=state.warnings,
    )


@app.get("/api/health")
async def health() -> dict:
    return {
        "key_present": client.has_key,
        "models": settings.available_models,
        "default_model": settings.default_model,
        "max_claims": settings.max_claims,
    }


@app.get("/api/demos")
async def demos() -> list[dict]:
    path = DATA_DIR / "demos.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/fixtures/{demo_id}")
async def fixture(demo_id: str) -> dict:
    """Saved run result for a demo, loadable by the UI without any LLM call.

    Regenerated via scripts/generate_fixtures.py — see the fixtures policy in
    .cursor/rules/run-fixtures.mdc."""
    path = DATA_DIR / "fixtures" / f"{demo_id}.json"
    if not path.exists():
        raise HTTPException(404, f"No fixture for '{demo_id}'.")
    return json.loads(path.read_text(encoding="utf-8"))


@app.post("/api/run", response_model=RunResult)
async def run(req: RunRequest) -> RunResult:
    model = req.model or settings.default_model

    if req.input_kind == "text" and not req.text.strip():
        raise HTTPException(400, "No text provided.")
    if req.input_kind == "claims" and not req.claims:
        raise HTTPException(400, "No claims provided.")

    doc_hash = _doc_hash(req.text) if req.input_kind == "text" else _doc_hash(
        json.dumps([c.text for c in req.claims], ensure_ascii=False)
    )

    state = base.RunState(
        text=req.text,
        input_kind=req.input_kind,
        doc_hash=doc_hash,
        claims=[Claim(id=c.id or f"c{i}", text=c.text, span=c.span) for i, c in enumerate(req.claims)],
    )
    run_id = db.create_run(req.mode, model, req.input_kind, doc_hash)
    ctx = base.RunContext(run_id=run_id, mode=req.mode, model=model)

    try:
        await base.run_pipeline(state, ctx)
    except MissingKeyError as exc:
        raise HTTPException(400, str(exc)) from exc
    except LLMError as exc:
        raise HTTPException(502, str(exc)) from exc

    result = _build_result(run_id, state, req.mode, model)
    db.save_artifact(run_id, _artifact_json(result, doc_hash))
    return result


@app.post("/api/criteria/design", response_model=CriteriaDesignResult)
async def design_criteria(req: CriteriaDesignRequest) -> CriteriaDesignResult:
    """Bouncer + prompt-dependent criteria via LLM (logged like other stages)."""
    model = req.model or settings.default_model
    try:
        return await criteria_design.design_criteria(
            req.prompt, model, audit=req.audit
        )
    except MissingKeyError as exc:
        raise HTTPException(400, str(exc)) from exc
    except LLMError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/criteria/audit", response_model=CriteriaDesignResult)
async def audit_criteria(req: CriteriaAuditRequest) -> CriteriaDesignResult:
    """Fail-closed applicability audit for provisional (pre-audit) criteria."""
    model = req.model or settings.default_model
    if db.get_run(req.run_id) is None:
        raise HTTPException(404, "Run not found.")
    try:
        return await criteria_design.audit_criteria(
            req.prompt,
            req.criteria,
            model,
            req.run_id,
        )
    except MissingKeyError as exc:
        raise HTTPException(400, str(exc)) from exc
    except LLMError as exc:
        raise HTTPException(502, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"Audit failed: {exc}") from exc


@app.post("/api/criteria/evidence-needs", response_model=EvidenceNeedResult)
async def plan_evidence_needs(req: EvidenceNeedRequest) -> EvidenceNeedResult:
    """Derive an evidence-need plan from audited criteria (no retrieval yet)."""
    model = req.model or settings.default_model
    if db.get_run(req.run_id) is None:
        raise HTTPException(404, "Run not found.")
    try:
        return await criteria_design.plan_evidence_needs(
            req.prompt,
            req.criteria,
            model,
            req.run_id,
        )
    except MissingKeyError as exc:
        raise HTTPException(400, str(exc)) from exc
    except LLMError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/criteria/gather", response_model=GatherResult)
async def gather_evidence(req: GatherRequest) -> GatherResult:
    """Fill evidence needs via web_search; return provenance-bearing finds."""
    model = req.model or settings.default_model
    if db.get_run(req.run_id) is None:
        raise HTTPException(404, "Run not found.")
    try:
        return await criteria_design.gather_evidence(
            req.prompt,
            req.criteria,
            req.evidence_needs,
            model,
            req.run_id,
        )
    except MissingKeyError as exc:
        raise HTTPException(400, str(exc)) from exc
    except LLMError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/criteria/answer", response_model=CriteriaAnswerResult)
async def answer_criteria(req: CriteriaAnswerRequest) -> CriteriaAnswerResult:
    """Draft an answer that tries to satisfy an admitted criteria object."""
    model = req.model or settings.default_model
    if db.get_run(req.run_id) is None:
        raise HTTPException(404, "Run not found.")
    try:
        return await criteria_design.answer_to_criteria(
            req.prompt,
            req.criteria,
            model,
            req.run_id,
            evidence_needs=req.evidence_needs,
            gather=req.gather,
        )
    except MissingKeyError as exc:
        raise HTTPException(400, str(exc)) from exc
    except LLMError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.get("/api/criteria/runs")
async def criteria_runs(limit: int = 40) -> list[dict]:
    """Recent criteria runs from the on-disk log (for issue reports)."""
    return criteria_log.list_recent(limit=max(1, min(limit, 100)))


@app.get("/api/criteria/runs/{run_id}")
async def criteria_run(run_id: int) -> dict:
    payload = criteria_log.load_run(run_id)
    if payload is None:
        raise HTTPException(404, f"No criteria log for run {run_id}.")
    return payload


def _artifact_json(result: RunResult, doc_hash: str) -> str:
    payload = {
        "schema_version": ARTIFACT_SCHEMA_VERSION,
        "run_id": result.run_id,
        "doc_hash": doc_hash,
        "mode": result.mode,
        "model": result.model,
        "input_kind": result.input_kind,
        "claims": [c.model_dump() for c in result.claims],
        "links": [l.model_dump() for l in result.links],
        "totals": {
            "tokens": result.total_tokens,
            "cost_usd": result.total_cost_usd,
            "cost_per_link": result.cost_per_link,
        },
        "stage_summary": [s.model_dump() for s in result.stage_summary],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


@app.get("/api/runs")
async def runs() -> list[dict]:
    return [
        {
            "id": r["id"],
            "created_at": r["created_at"],
            "mode": r["mode"],
            "model": r["model"],
            "input_kind": r["input_kind"],
            "total_tokens": r["total_tokens"],
            "total_cost_usd": r["total_cost_usd"],
            "call_count": r["call_count"],
        }
        for r in db.list_runs()
    ]


@app.get("/api/calls/{call_id}")
async def call_detail(call_id: int) -> dict:
    row = db.get_call(call_id)
    if row is None:
        raise HTTPException(404, "Call not found.")
    return {
        "id": row["id"],
        "run_id": row["run_id"],
        "stage": row["stage"],
        "mode": row["mode"],
        "model": row["model"],
        "prompt_tokens": row["prompt_tokens"],
        "completion_tokens": row["completion_tokens"],
        "total_tokens": row["total_tokens"],
        "cost_usd": row["cost_usd"],
        "latency_ms": row["latency_ms"],
        "prompt": row["prompt"],
        "response": row["response"],
    }


@app.get("/api/export/{run_id}")
async def export_run(run_id: int) -> dict:
    row = db.get_run(run_id)
    if row is None or row["artifact"] is None:
        raise HTTPException(404, "Run artifact not found.")
    return json.loads(row["artifact"])
