"""Regenerate saved demo run fixtures with realistic data.

Runs each demo in app/data/demos.json through the live pipeline (batched mode)
and saves the full run result plus every raw LLM exchange to
app/data/fixtures/<demo_id>.json. The UI loads these when a case-study chip is
clicked, so the app can be exercised without LLM calls.

Policy (.cursor/rules/run-fixtures.mdc): rerun this script whenever the
run-result data format changes, so fixtures always match the live schema.

Usage: start the backend with a valid XAI_API_KEY, then
    python scripts/generate_fixtures.py [--base http://127.0.0.1:8000]
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

DATA_DIR = Path(__file__).resolve().parents[1] / "app" / "data"
FIXTURES_DIR = DATA_DIR / "fixtures"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    args = parser.parse_args()

    demos = json.loads((DATA_DIR / "demos.json").read_text(encoding="utf-8"))
    FIXTURES_DIR.mkdir(exist_ok=True)

    with httpx.Client(base_url=args.base, timeout=300.0) as client:
        health = client.get("/api/health").json()
        if not health["key_present"]:
            sys.exit("Backend has no XAI_API_KEY; fixtures must be realistic runs.")

        for demo in demos:
            payload: dict = {"mode": "batched"}
            if demo["input_kind"] == "claims":
                payload["input_kind"] = "claims"
                payload["claims"] = [{"text": c["text"]} for c in demo["claims"]]
            else:
                payload["input_kind"] = "text"
                payload["text"] = demo["text"]

            resp = client.post("/api/run", json=payload)
            resp.raise_for_status()
            result = resp.json()

            call_details = {}
            for call in result["calls"]:
                detail = client.get(f"/api/calls/{call['id']}")
                detail.raise_for_status()
                call_details[str(call["id"])] = detail.json()

            fixture = {
                "demo_id": demo["id"],
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "result": result,
                "call_details": call_details,
            }
            out = FIXTURES_DIR / f"{demo['id']}.json"
            out.write_text(
                json.dumps(fixture, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            print(
                f"{demo['id']}: claims={len(result['claims'])} "
                f"links={len(result['links'])} tokens={result['total_tokens']} "
                f"-> {out.name}"
            )


if __name__ == "__main__":
    main()
