from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass

import httpx

from .config import settings


class LLMError(RuntimeError):
    pass


class MissingKeyError(LLMError):
    pass


@dataclass
class LLMResult:
    content: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: int


class GrokClient:
    """Adapter for xAI Grok's OpenAI-compatible chat completions API.

    Kept behind a small interface so other providers can be added later without
    touching the pipeline.
    """

    def __init__(self) -> None:
        self.base_url = settings.xai_base_url.rstrip("/")
        self.api_key = settings.xai_api_key

    @property
    def has_key(self) -> bool:
        return bool(self.api_key)

    async def chat(
        self,
        messages: list[dict],
        model: str,
        temperature: float = 0.1,
        response_json: bool = True,
    ) -> LLMResult:
        if not self.has_key:
            raise MissingKeyError(
                "XAI_API_KEY is not set. Add it to inference-resolver/backend/.env."
            )

        payload: dict = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }
        if response_json:
            payload["response_format"] = {"type": "json_object"}

        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
        except httpx.HTTPError as exc:
            raise LLMError(f"Request to xAI failed: {exc}") from exc
        latency_ms = int((time.perf_counter() - started) * 1000)

        if resp.status_code >= 400:
            raise LLMError(f"xAI returned {resp.status_code}: {resp.text[:500]}")

        data = resp.json()
        try:
            content = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError) as exc:
            raise LLMError(f"Unexpected xAI response shape: {data}") from exc

        usage = data.get("usage", {}) or {}
        return LLMResult(
            content=content,
            model=data.get("model", model),
            prompt_tokens=int(usage.get("prompt_tokens", 0)),
            completion_tokens=int(usage.get("completion_tokens", 0)),
            latency_ms=latency_ms,
        )


def parse_json_loose(content: str):
    """Best-effort JSON parse: strips code fences, then falls back to the first
    balanced object/array in the string."""
    text = content.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        end = text.rfind(closer)
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                continue
    raise LLMError(f"Could not parse JSON from model output: {content[:300]}")


client = GrokClient()
