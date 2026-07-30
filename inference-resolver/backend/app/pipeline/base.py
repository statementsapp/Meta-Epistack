from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from .. import db
from ..llm import LLMResult
from ..models import Claim, Link


@dataclass
class RunContext:
    """Per-run context shared across stages. Binds ledger writes to the run."""

    run_id: int
    mode: str
    model: str

    def log(self, stage: str, result: LLMResult, prompt: str) -> int:
        return db.log_call(self.run_id, stage, self.mode, result, prompt)


@dataclass
class RunState:
    text: str
    input_kind: str
    doc_hash: str
    claims: list[Claim] = field(default_factory=list)
    links: list[Link] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@runtime_checkable
class Stage(Protocol):
    name: str

    async def __call__(self, state: RunState, ctx: RunContext) -> None: ...


# Ordered pipeline registry. New stages (e.g. a `validate` skeptic/judge pass)
# register here without changing the runner, the ledger schema, or the
# dashboard (which groups by the free-form stage name).
STAGE_REGISTRY: list[Stage] = []


def register_stage(stage: Stage) -> Stage:
    STAGE_REGISTRY.append(stage)
    return stage


async def run_pipeline(state: RunState, ctx: RunContext) -> None:
    for stage in STAGE_REGISTRY:
        await stage(state, ctx)
