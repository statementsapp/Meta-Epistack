"""Persistent criteria-run log for debugging and issue reports.

Writes:
- one JSON file per run under data/criteria_runs/{run_id}.json
- an append-only JSONL index at data/criteria_run_log.jsonl
- the same payload into the SQLite runs.artifact column
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from . import db
from .config import DATA_DIR

RUN_DIR = DATA_DIR / "criteria_runs"
LOG_JSONL = DATA_DIR / "criteria_run_log.jsonl"
LOG_SCHEMA_VERSION = 1


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_dirs() -> None:
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _run_path(run_id: int) -> Path:
    return RUN_DIR / f"{run_id}.json"


def load_run(run_id: int) -> Optional[dict[str, Any]]:
    path = _run_path(run_id)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    row = db.get_run(run_id)
    if row is None or not row["artifact"]:
        return None
    try:
        return json.loads(row["artifact"])
    except json.JSONDecodeError:
        return None


def persist_design(
    *,
    run_id: int,
    prompt: str,
    design: dict[str, Any],
) -> dict[str, Any]:
    """Create or replace the run log after criteria design."""
    _ensure_dirs()
    existing = load_run(run_id) or {}
    payload = {
        "schema_version": LOG_SCHEMA_VERSION,
        "run_id": run_id,
        "kind": "criteria",
        "updated_at": _now(),
        "created_at": existing.get("created_at") or _now(),
        "prompt": prompt,
        "design": design,
        "evidence_needs": existing.get("evidence_needs"),
        "gather": existing.get("gather"),
        "answer": existing.get("answer"),
    }
    _write(payload)
    design_bouncer = design.get("bouncer") or {}
    _append_index(
        {
            "at": payload["updated_at"],
            "event": "design",
            "run_id": run_id,
            "prompt_preview": prompt[:160],
            "admitted": bool(design_bouncer.get("admitted")),
            "inquiry_type": design_bouncer.get("inquiry_type")
            or design_bouncer.get("rejected_type"),
            "total_tokens": design.get("total_tokens"),
            "total_cost_usd": design.get("total_cost_usd"),
            "path": str(_run_path(run_id).as_posix()),
        }
    )
    return payload


def persist_evidence_needs(
    *,
    run_id: int,
    prompt: str,
    evidence_needs: dict[str, Any],
) -> dict[str, Any]:
    """Attach evidence-need plan to an existing criteria run log."""
    _ensure_dirs()
    existing = load_run(run_id) or {
        "schema_version": LOG_SCHEMA_VERSION,
        "run_id": run_id,
        "kind": "criteria",
        "created_at": _now(),
        "prompt": prompt,
        "design": None,
    }
    existing["updated_at"] = _now()
    existing["prompt"] = prompt or existing.get("prompt") or ""
    existing["evidence_needs"] = evidence_needs
    _write(existing)
    plan = (evidence_needs.get("evidence_needs") or {}) if isinstance(
        evidence_needs.get("evidence_needs"), dict
    ) else evidence_needs
    n_checks = len(plan.get("settlement_checks") or []) if isinstance(plan, dict) else 0
    n_defeaters = len(plan.get("defeater_hunts") or []) if isinstance(plan, dict) else 0
    _append_index(
        {
            "at": existing["updated_at"],
            "event": "evidence_needs",
            "run_id": run_id,
            "prompt_preview": (existing.get("prompt") or "")[:160],
            "settlement_checks": n_checks,
            "defeater_hunts": n_defeaters,
            "total_tokens": evidence_needs.get("total_tokens"),
            "total_cost_usd": evidence_needs.get("total_cost_usd"),
            "path": str(_run_path(run_id).as_posix()),
        }
    )
    return existing


def persist_gather(
    *,
    run_id: int,
    prompt: str,
    gather: dict[str, Any],
) -> dict[str, Any]:
    """Attach gather packet to an existing criteria run log."""
    _ensure_dirs()
    existing = load_run(run_id) or {
        "schema_version": LOG_SCHEMA_VERSION,
        "run_id": run_id,
        "kind": "criteria",
        "created_at": _now(),
        "prompt": prompt,
        "design": None,
    }
    existing["updated_at"] = _now()
    existing["prompt"] = prompt or existing.get("prompt") or ""
    existing["gather"] = gather
    updated_plan = gather.get("evidence_needs")
    if isinstance(updated_plan, dict):
        prev_needs = existing.get("evidence_needs")
        if isinstance(prev_needs, dict):
            merged = dict(prev_needs)
            merged["evidence_needs"] = updated_plan
            existing["evidence_needs"] = merged
    _write(existing)
    packet = gather.get("gather") if isinstance(gather.get("gather"), dict) else {}
    _append_index(
        {
            "at": existing["updated_at"],
            "event": "gather",
            "run_id": run_id,
            "prompt_preview": (existing.get("prompt") or "")[:160],
            "finds": len(packet.get("finds") or []),
            "retrieval_status": packet.get("retrieval_status"),
            "total_tokens": gather.get("total_tokens"),
            "total_cost_usd": gather.get("total_cost_usd"),
            "path": str(_run_path(run_id).as_posix()),
        }
    )
    return existing


def persist_answer(
    *,
    run_id: int,
    prompt: str,
    answer: dict[str, Any],
) -> dict[str, Any]:
    """Attach answer payload to an existing criteria run log."""
    _ensure_dirs()
    existing = load_run(run_id) or {
        "schema_version": LOG_SCHEMA_VERSION,
        "run_id": run_id,
        "kind": "criteria",
        "created_at": _now(),
        "prompt": prompt,
        "design": None,
    }
    existing["updated_at"] = _now()
    existing["prompt"] = prompt or existing.get("prompt") or ""
    existing["answer"] = answer
    _write(existing)
    _append_index(
        {
            "at": existing["updated_at"],
            "event": "answer",
            "run_id": run_id,
            "prompt_preview": (existing.get("prompt") or "")[:160],
            "headline": (answer.get("answer") or {}).get("headline"),
            "total_tokens": answer.get("total_tokens"),
            "total_cost_usd": answer.get("total_cost_usd"),
            "path": str(_run_path(run_id).as_posix()),
        }
    )
    return existing


def _write(payload: dict[str, Any]) -> None:
    path = _run_path(int(payload["run_id"]))
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    path.write_text(text, encoding="utf-8")
    db.save_artifact(int(payload["run_id"]), text)


def _append_index(entry: dict[str, Any]) -> None:
    with LOG_JSONL.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def list_recent(limit: int = 40) -> list[dict[str, Any]]:
    _ensure_dirs()
    files = sorted(RUN_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    out: list[dict[str, Any]] = []
    for path in files[:limit]:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        design = data.get("design") or {}
        bouncer = design.get("bouncer") or {}
        answer = data.get("answer") or {}
        needs = data.get("evidence_needs") or {}
        out.append(
            {
                "run_id": data.get("run_id"),
                "updated_at": data.get("updated_at"),
                "prompt_preview": (data.get("prompt") or "")[:160],
                "admitted": bool(bouncer.get("admitted")),
                "inquiry_type": bouncer.get("inquiry_type") or bouncer.get("rejected_type"),
                "has_evidence_needs": bool(
                    needs.get("evidence_needs") if isinstance(needs, dict) else needs
                ),
                "has_answer": bool(answer.get("answer")),
                "headline": (answer.get("answer") or {}).get("headline"),
                "total_tokens": answer.get("total_tokens")
                or needs.get("total_tokens")
                or design.get("total_tokens"),
                "path": str(path.as_posix()),
            }
        )
    return out
