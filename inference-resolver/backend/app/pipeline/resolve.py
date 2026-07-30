from __future__ import annotations

import itertools
from typing import Protocol

from ..llm import client, parse_json_loose
from ..models import Claim, Link
from .base import RunContext, RunState, register_stage

_VALID_TYPES = {"supports", "rebuts", "qualifies"}

_SYSTEM = (
    "You analyze the inference structure between claims: which claim is offered "
    "as SUPPORT for, a REBUTTAL of, or a QUALIFICATION of another. Only assert a "
    "link when the relationship is genuinely present; topical similarity alone is "
    "not a link.\n\n"
    "For every link, isolate its ASSUMPTION: the single implicit inferential "
    "warrant that must hold for the relation to work — the 'why' behind it. State "
    "it as a short principle, and name the reasoning move where relevant. "
    "Examples: a rebuttal may work because 'proximity does not prove causation' or "
    "because the target is 'a hasty generalization from one feature'; a support "
    "may assume 'the cited study population generalizes to everyone'. Return "
    "strict JSON."
)

_LINK_SHAPE = (
    '{"source": <int>, "target": <int>, "type": "supports|rebuts|qualifies", '
    '"assumption": "<the implicit warrant that makes the relation hold>", '
    '"rationale": "<one sentence describing the relation>", '
    '"confidence": <0-1>}'
)


def _clamp_conf(value) -> float:
    try:
        conf = float(value)
    except (TypeError, ValueError):
        return 0.5
    return max(0.0, min(1.0, conf))


def _numbered(claims: list[Claim]) -> str:
    return "\n".join(f"[{i}] {c.text}" for i, c in enumerate(claims))


class ResolveStrategy(Protocol):
    name: str

    async def resolve(
        self, state: RunState, ctx: RunContext, claims: list[Claim]
    ) -> list[Link]: ...


class BatchedStrategy:
    name = "batched"

    async def resolve(
        self, state: RunState, ctx: RunContext, claims: list[Claim]
    ) -> list[Link]:
        prompt = (
            "Here is a numbered list of claims. Identify every directed inference "
            "link among them. 'source' is the claim doing the supporting/"
            "rebutting/qualifying; 'target' is the claim it acts on. Use the "
            "numeric indices. For each link, isolate its assumption (the implicit "
            "warrant that makes the relation hold). Respond as JSON: "
            f'{{"links": [{_LINK_SHAPE}]}}\n\n'
            f"CLAIMS:\n{_numbered(claims)}"
        )
        result = await client.chat(
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": prompt},
            ],
            model=ctx.model,
        )
        call_id = ctx.log("resolve", result, prompt)

        data = parse_json_loose(result.content)
        raw = data.get("links", []) if isinstance(data, dict) else []
        links: list[Link] = []
        for k, item in enumerate(raw):
            link = _build_link(item, claims, model=result.model, call_ids=[call_id], key=f"b{k}")
            if link:
                links.append(link)
        return links


class PairwiseStrategy:
    name = "pairwise"

    async def resolve(
        self, state: RunState, ctx: RunContext, claims: list[Claim]
    ) -> list[Link]:
        links: list[Link] = []
        for i, j in itertools.combinations(range(len(claims)), 2):
            prompt = (
                "Consider exactly these two claims:\n"
                f"[{i}] {claims[i].text}\n[{j}] {claims[j].text}\n\n"
                "Is one offered as support for, a rebuttal of, or a qualification "
                "of the other? If there is no such inference link, return null. "
                "'source' is the claim doing the acting; 'target' is the one acted "
                "on; both must be one of the two indices. Isolate the assumption "
                "(the implicit warrant that makes the relation hold). Respond as "
                f'JSON: {{"link": null | {_LINK_SHAPE}}}'
            )
            result = await client.chat(
                messages=[
                    {"role": "system", "content": _SYSTEM},
                    {"role": "user", "content": prompt},
                ],
                model=ctx.model,
            )
            call_id = ctx.log("resolve", result, prompt)
            data = parse_json_loose(result.content)
            item = data.get("link") if isinstance(data, dict) else None
            if item:
                link = _build_link(
                    item, claims, model=result.model, call_ids=[call_id], key=f"p{i}_{j}"
                )
                if link:
                    links.append(link)
        return links


def _build_link(
    item: dict, claims: list[Claim], model: str, call_ids: list[int], key: str
) -> Link | None:
    if not isinstance(item, dict):
        return None
    link_type = str(item.get("type", "")).lower().strip()
    if link_type not in _VALID_TYPES:
        return None
    try:
        s = int(item["source"])
        t = int(item["target"])
    except (KeyError, TypeError, ValueError):
        return None
    if s == t or not (0 <= s < len(claims)) or not (0 <= t < len(claims)):
        return None
    return Link(
        id=f"l_{key}",
        source=claims[s].id,
        target=claims[t].id,
        type=link_type,  # type: ignore[arg-type]
        rationale=str(item.get("rationale", "")).strip(),
        assumption=str(item.get("assumption", "")).strip(),
        confidence=_clamp_conf(item.get("confidence", 0.5)),
        call_ids=call_ids,
        model=model,
    )


STRATEGIES: dict[str, ResolveStrategy] = {
    s.name: s for s in (BatchedStrategy(), PairwiseStrategy())
}


class ResolveStage:
    name = "resolve"

    async def __call__(self, state: RunState, ctx: RunContext) -> None:
        if len(state.claims) < 2:
            state.warnings.append("Need at least 2 claims to resolve links.")
            return
        strategy = STRATEGIES.get(ctx.mode)
        if strategy is None:
            state.warnings.append(f"Unknown mode '{ctx.mode}'.")
            return
        state.links = await strategy.resolve(state, ctx, state.claims)


register_stage(ResolveStage())
