from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Optional

from .config import DB_PATH, cost_for
from .llm import LLMResult

_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    mode TEXT NOT NULL,
    model TEXT NOT NULL,
    input_kind TEXT NOT NULL,
    doc_hash TEXT,
    artifact TEXT
);

CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    stage TEXT NOT NULL,
    mode TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,
    cost_usd REAL NOT NULL,
    latency_ms INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    response TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs (id)
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(_SCHEMA)


def create_run(mode: str, model: str, input_kind: str, doc_hash: Optional[str]) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO runs (created_at, mode, model, input_kind, doc_hash) "
            "VALUES (?, ?, ?, ?, ?)",
            (_now(), mode, model, input_kind, doc_hash),
        )
        return int(cur.lastrowid)


def log_call(
    run_id: int,
    stage: str,
    mode: str,
    result: LLMResult,
    prompt: str,
) -> int:
    """Record one LLM call and return its ledger id."""
    total = result.prompt_tokens + result.completion_tokens
    cost = cost_for(result.model, result.prompt_tokens, result.completion_tokens)
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO calls (run_id, created_at, stage, mode, model, "
            "prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, "
            "prompt, response) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                run_id,
                _now(),
                stage,
                mode,
                result.model,
                result.prompt_tokens,
                result.completion_tokens,
                total,
                cost,
                result.latency_ms,
                prompt,
                result.content,
            ),
        )
        return int(cur.lastrowid)


def save_artifact(run_id: int, artifact_json: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE runs SET artifact = ? WHERE id = ?", (artifact_json, run_id)
        )


def calls_for_run(run_id: int) -> list[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM calls WHERE run_id = ? ORDER BY id", (run_id,)
        ).fetchall()


def get_call(call_id: int) -> Optional[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM calls WHERE id = ?", (call_id,)).fetchone()


def list_runs() -> list[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT r.*, "
            "COALESCE(SUM(c.total_tokens), 0) AS total_tokens, "
            "COALESCE(SUM(c.cost_usd), 0) AS total_cost_usd, "
            "COUNT(c.id) AS call_count "
            "FROM runs r LEFT JOIN calls c ON c.run_id = r.id "
            "GROUP BY r.id ORDER BY r.id DESC",
        ).fetchall()


def get_run(run_id: int) -> Optional[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
