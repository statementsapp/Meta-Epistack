"""Ad-hoc bouncer probe: prints admit/reject for a few boundary prompts."""

from __future__ import annotations

import json
import urllib.request

PROMPTS = [
    "What is the economic future of Los Angeles",
    "Will the sun rise tomorrow?",
    "Which shade of blue is the prettiest?",
    "What caused the 2008 liquidity freeze in interbank markets?",
]


def design(prompt: str) -> dict:
    req = urllib.request.Request(
        "http://127.0.0.1:8000/api/criteria/design",
        data=json.dumps({"prompt": prompt}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.load(resp)


for p in PROMPTS:
    d = design(p)
    b = d["bouncer"]
    if b.get("admitted"):
        c = d.get("criteria") or {}
        print(f"ADMIT  | {p}")
        print(f"        type={b.get('inquiry_type')} fragment={c.get('logic_fragment')}")
        print(f"        ports={c.get('required_ports')}")
    else:
        print(f"REJECT | {p}")
        print(f"        {b.get('rejected_type')}: {b.get('message')}")
    print(f"        tokens={d.get('total_tokens')} cost={d.get('total_cost_usd')}")
