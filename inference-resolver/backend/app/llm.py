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
    citations: list[str] | None = None
    raw: dict | None = None


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
            async with httpx.AsyncClient(timeout=120.0) as http:
                resp = await http.post(
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
            raw=data,
        )

    async def responses_with_web_search(
        self,
        *,
        model: str,
        system: str,
        user: str,
        temperature: float = 0.1,
    ) -> LLMResult:
        """Call xAI Responses API with server-side web_search tool.

        Live Search via chat completions search_parameters is deprecated (410).
        """
        if not self.has_key:
            raise MissingKeyError(
                "XAI_API_KEY is not set. Add it to inference-resolver/backend/.env."
            )

        payload: dict = {
            "model": model,
            "input": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "tools": [{"type": "web_search"}],
            "temperature": temperature,
        }

        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=180.0) as http:
                resp = await http.post(
                    f"{self.base_url}/responses",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
        except httpx.HTTPError as exc:
            raise LLMError(f"Request to xAI responses failed: {exc}") from exc
        latency_ms = int((time.perf_counter() - started) * 1000)

        if resp.status_code >= 400:
            raise LLMError(f"xAI responses returned {resp.status_code}: {resp.text[:800]}")

        data = resp.json()
        content = _extract_responses_text(data)
        citations = _extract_responses_citations(data)
        usage = data.get("usage", {}) or {}
        prompt_tokens = int(
            usage.get("input_tokens")
            or usage.get("prompt_tokens")
            or 0
        )
        completion_tokens = int(
            usage.get("output_tokens")
            or usage.get("completion_tokens")
            or 0
        )
        return LLMResult(
            content=content,
            model=data.get("model", model),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=latency_ms,
            citations=citations,
            raw=data,
        )


def _extract_responses_text(data: dict) -> str:
    """Best-effort text extraction from an xAI/OpenAI Responses payload."""
    if isinstance(data.get("output_text"), str) and data["output_text"].strip():
        return data["output_text"]

    chunks: list[str] = []
    output = data.get("output")
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict):
                continue
            if item.get("type") in ("message", "output_message") or item.get("role") == "assistant":
                content = item.get("content")
                if isinstance(content, str) and content.strip():
                    chunks.append(content)
                elif isinstance(content, list):
                    for part in content:
                        if not isinstance(part, dict):
                            continue
                        text = part.get("text") or part.get("output_text") or ""
                        if isinstance(text, str) and text.strip():
                            chunks.append(text)
                        elif isinstance(text, dict) and text.get("value"):
                            chunks.append(str(text["value"]))
    if chunks:
        return "\n".join(chunks)

    # Some payloads nest the final answer under `response` / `choices`.
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        msg = (choices[0] or {}).get("message") or {}
        if isinstance(msg.get("content"), str):
            return msg["content"]

    return ""


def _extract_responses_citations(data: dict) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()

    def add(url: object) -> None:
        if not isinstance(url, str):
            return
        u = url.strip()
        if not u or u in seen:
            return
        if not (u.startswith("http://") or u.startswith("https://")):
            return
        seen.add(u)
        urls.append(u)

    raw_cites = data.get("citations")
    if isinstance(raw_cites, list):
        for c in raw_cites:
            if isinstance(c, str):
                add(c)
            elif isinstance(c, dict):
                add(c.get("url") or c.get("uri") or c.get("href"))

    output = data.get("output")
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict):
                continue
            for key in ("citations", "sources"):
                block = item.get(key)
                if isinstance(block, list):
                    for c in block:
                        if isinstance(c, str):
                            add(c)
                        elif isinstance(c, dict):
                            add(c.get("url") or c.get("uri"))
            content = item.get("content")
            if isinstance(content, list):
                for part in content:
                    if not isinstance(part, dict):
                        continue
                    anns = part.get("annotations")
                    if isinstance(anns, list):
                        for ann in anns:
                            if isinstance(ann, dict):
                                add(ann.get("url") or ann.get("href"))

    return urls


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
