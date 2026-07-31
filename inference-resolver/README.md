# Inference Resolver

A working demo of the **Structure**-layer "inference resolver" component from the
FLF Epistemic Stack ([docs/competition](../docs/competition/)): it takes possibly
unpolished, possibly non-granular, possibly already-structured input, extracts
atomic claims, and uses an LLM (xAI Grok) to resolve **typed support/rebuttal
links** between them. It shows the resulting claim graph and reports, transparently,
what every stage of the pipeline cost in tokens.

This is a deliberately scoped initial demonstration of value, not a full system.

## What it does

- **Input, any shape:** paste prose / rough notes / a bullet list, or hand it a
  pre-structured claim list as JSON. Structured claims pass straight through the
  extract stage at zero token cost.
- **Two metered stages:** `extract` (text -> claims) and `resolve` (claims ->
  typed `supports` / `rebuts` / `qualifies` links with rationale and confidence).
- **Two run modes:** `batched` (one call for the whole claim set) and `pairwise`
  (one call per claim pair). "Compare modes" runs the same input both ways.
- **Full transparency:** click any link in the graph to see its rationale, source
  claims, confidence, and the exact prompt/response that produced it. The token
  dashboard breaks usage down by stage and compares mode economics.
- **Compounding artifact:** export the claim graph as versioned JSON (claims with
  source spans, links with provenance and per-link token cost).

## Prerequisites

- Python 3.11+
- Node 18+
- An xAI API key (the app boots without one and shows a banner; you need it to
  actually run the resolve stage).

## Setup

### 1. Backend

```bash
cd inference-resolver/backend
python -m venv .venv
.venv\Scripts\activate          # Windows;  source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
copy .env.example .env          # cp on macOS/Linux
# edit .env and set XAI_API_KEY=...
uvicorn app.main:app --port 8000
```

### 2. Frontend

```bash
cd inference-resolver/frontend
npm install
npm run dev
```

Open http://localhost:5173. The dev server proxies `/api` to the backend on
port 8000.

## Saved demo results (no API calls)

Clicking a case-study chip (LHC / COVID / Eggs) loads a **saved run result**
from `backend/app/data/fixtures/`: the full graph, telemetry, and raw LLM
exchanges from a real prior run, without spending any tokens. Press
**Resolve** to run live instead.

Fixtures are regenerated with `python scripts/generate_fixtures.py` (backend
running, key set). Policy: they must be refreshed whenever the run-result data
format changes. See `.cursor/rules/run-fixtures.mdc`.

## Demo walkthrough

1. Click the **COVID origins** demo (contested prose). Leave mode on `batched`.
   Press **Resolve**. You get a claim graph where rebuttals (red) point at the
   claims they answer and supports (green) point at what they back.
2. Click a **red edge**: the inspector shows which claim rebuts which, the model's
   one-line rationale and, via "Show raw LLM exchange," the exact prompt and
   JSON response, with token count.
3. Press **Compare modes**. It reruns the same claims in `pairwise` mode. The
   dashboard's comparison chart shows pairwise spending many more tokens (one call
   per pair) for a similar graph. This is the core cost/quality tradeoff.
4. Try the **Egg health** demo: it is a pre-structured claim list, so the extract
   stage contributes zero tokens (visible in "Tokens by stage") and the resolver
   finds the support chain into the "eggs increase cardiovascular risk" claim and
   the study claim that rebuts it.
5. **Export artifact (JSON)** to save the graph with provenance for reuse.

## Configuration

Environment variables (in `backend/.env`):

| Variable | Default | Purpose |
|---|---|---|
| `XAI_API_KEY` | (empty) | xAI API key |
| `XAI_BASE_URL` | `https://api.x.ai/v1` | OpenAI-compatible endpoint |
| `DEFAULT_MODEL` | `grok-4` | Default model |

Model list (UI dropdown), the claim cap (`max_claims`, default 12, which bounds
pairwise cost), and the cost-estimate price table live in
[backend/app/config.py](backend/app/config.py). The price table is estimates for
telemetry; adjust it to match current xAI pricing.

## UI conventions

- Keep content scrollable when it overflows, but do not display vertical
  scrollbar chrome. Apply this consistently to new panels and nested regions.
- Do not use em dashes in user-facing copy or project documentation. Prefer a
  period, comma, colon, or parentheses.

## Criteria run log

Each Criteria Designer run is persisted for issue reports:

- Per-run JSON: `backend/app/data/criteria_runs/{run_id}.json` (prompt, design,
  answer)
- Append-only index: `backend/app/data/criteria_run_log.jsonl`
- Also stored on the SQLite run artifact

Cite a `run_id` (shown in the left rail) when flagging a bad criteria or answer
output. List recent runs via `GET /api/criteria/runs`; fetch one with
`GET /api/criteria/runs/{run_id}`.

Architecture snapshot of the Criteria Designer at the Charlie Kirk stress case:
[docs/criteria-designer-snapshot-2026-07-30.md](docs/criteria-designer-snapshot-2026-07-30.md).

Settled epistemic policy for the Criteria Designer (runtime attitude; not an
FLF competition-doc override):
[docs/EPISTEMOLOGY.md](docs/EPISTEMOLOGY.md).

## How it is built to expand

The scope is intentionally narrow, but the seams for the dropped features are in
place (see the plan). Concretely:

- **Stage registry** ([backend/app/pipeline/base.py](backend/app/pipeline/base.py)):
  stages are ordered registry entries. Adding a `validate` (skeptic/judge) stage is
  one `register_stage(...)`; the ledger's free-form `stage` column and the
  stage-grouped dashboard pick it up with no other changes.
- **Resolve strategy interface**
  ([backend/app/pipeline/resolve.py](backend/app/pipeline/resolve.py)): `batched`
  and `pairwise` implement one `ResolveStrategy`. `blocked`, `ensemble`, and
  `adversarial` become new strategies registered in `STRATEGIES`; the mode picker
  and comparison chart read the list.
- **Link provenance** stores a *list* of producing call ids, so multi-call links
  (linker/skeptic/judge chains, ensemble agreement) already fit the schema.
- **Artifact `schema_version`** is written on export, so import/compounding is a
  reader for the same schema later.
- **Swappable graph renderers**
  ([frontend/src/graph/renderers.ts](frontend/src/graph/renderers.ts)) and a
  single theme/token module ([frontend/src/theme.ts](frontend/src/theme.ts)): the
  graph uses `react-force-graph-2d` (three.js/WebGL underneath) with `renderNode` /
  `renderLinkOverlay` passed in, so a richer 3D or skeuomorphic "claim card" set
  can replace them without touching the pipeline or store.

## Layout

```
inference-resolver/
  backend/
    app/
      main.py            FastAPI app + endpoints
      config.py          settings, model list, price table
      db.py              SQLite call ledger + artifact store
      llm.py             Grok adapter (OpenAI-compatible)
      models.py          pydantic schemas
      pipeline/
        base.py          stage registry + run orchestration
        extract.py       extract stage (+ claims passthrough)
        resolve.py       resolve stage: batched & pairwise strategies
      data/demos.json    bundled demo excerpts
  frontend/
    src/
      App.tsx            three-pane layout
      store.ts           Zustand store (views are pure over it)
      api.ts, types.ts, theme.ts
      graph/             GraphView + swappable renderers
      components/        InputPanel, Dashboard, Inspector
```
