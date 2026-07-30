from __future__ import annotations

from ..config import settings
from ..llm import client, parse_json_loose
from ..models import Claim, SourceSpan
from .base import RunContext, RunState, register_stage

_SYSTEM = (
    "You extract atomic, self-contained factual or evaluative claims from a "
    "passage. The input may be polished prose, rough notes, or a bullet list. "
    "Split compound sentences into separate claims. Rewrite each claim to stand "
    "on its own (resolve pronouns), but stay faithful to the source and do not "
    "invent claims. Return strict JSON."
)

_USER_TEMPLATE = (
    "Extract up to {max_claims} of the most load-bearing claims from the text "
    "below. For each claim, include a short verbatim quote from the source that "
    'it is based on. Respond as JSON: {{"claims": [{{"text": "<standalone '
    'claim>", "quote": "<verbatim snippet from source>"}}]}}\n\n'
    "TEXT:\n{text}"
)


def _locate(quote: str, source: str) -> SourceSpan | None:
    if not quote:
        return None
    idx = source.find(quote)
    if idx == -1:
        stripped = quote.strip()
        idx = source.find(stripped)
        if idx == -1:
            return None
        return SourceSpan(start=idx, end=idx + len(stripped))
    return SourceSpan(start=idx, end=idx + len(quote))


class ExtractStage:
    name = "extract"

    async def __call__(self, state: RunState, ctx: RunContext) -> None:
        # Passthrough: pre-structured claims skip the LLM entirely (zero tokens).
        if state.input_kind == "claims":
            for i, claim in enumerate(state.claims):
                if not claim.id:
                    claim.id = f"c{i}"
            if len(state.claims) > settings.max_claims:
                state.warnings.append(
                    f"Truncated to first {settings.max_claims} claims "
                    f"(received {len(state.claims)})."
                )
                state.claims = state.claims[: settings.max_claims]
            return

        prompt = _USER_TEMPLATE.format(max_claims=settings.max_claims, text=state.text)
        result = await client.chat(
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": prompt},
            ],
            model=ctx.model,
        )
        ctx.log(self.name, result, prompt)

        data = parse_json_loose(result.content)
        raw_claims = data.get("claims", []) if isinstance(data, dict) else []
        claims: list[Claim] = []
        for i, item in enumerate(raw_claims[: settings.max_claims]):
            text = (item.get("text") or "").strip()
            if not text:
                continue
            span = _locate((item.get("quote") or "").strip(), state.text)
            claims.append(Claim(id=f"c{i}", text=text, span=span))
        state.claims = claims
        if not claims:
            state.warnings.append("Extraction returned no claims.")


register_stage(ExtractStage())
