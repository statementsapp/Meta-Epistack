from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = BASE_DIR / "ledger.db"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR.parent / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    xai_api_key: str = ""
    xai_base_url: str = "https://api.x.ai/v1"
    default_model: str = "grok-4"

    # Models offered in the UI dropdown.
    available_models: list[str] = ["grok-4", "grok-3", "grok-3-mini"]

    # Safety cap on how many claims a resolve run will consider, to keep the
    # pairwise mode (O(n^2) calls) affordable for a demo.
    max_claims: int = 12


settings = Settings()

# USD per 1M tokens. Estimates for cost telemetry; override as pricing changes.
# Each entry: (prompt_usd_per_mtok, completion_usd_per_mtok).
PRICE_TABLE: dict[str, tuple[float, float]] = {
    "grok-4": (3.00, 15.00),
    "grok-3": (3.00, 15.00),
    "grok-3-mini": (0.30, 0.50),
}
DEFAULT_PRICE: tuple[float, float] = (3.00, 15.00)


def cost_for(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    p_in, p_out = PRICE_TABLE.get(model, DEFAULT_PRICE)
    return (prompt_tokens / 1_000_000) * p_in + (completion_tokens / 1_000_000) * p_out
