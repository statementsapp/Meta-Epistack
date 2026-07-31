# Criteria Designer snapshot (2026-07-30)

Memorializes how the Epistemic Criteria Designer worked at this point in the
Inference Resolver demo, including the Charlie Kirk run (`run_id` 29) used as a
stress case.

## What the product is right now

Two UI modes in one Vite/React shell ([`frontend/src/App.tsx`](../frontend/src/App.tsx)):

1. **Criteria Designer** (default)
2. **Claim Graph** (the original extract/resolve demo)

Criteria Designer is not claim-graph resolution. It is a pre-answer workflow:
classify the prompt, emit a port-based criteria object, then (if admitted) draft
an answer that tries to satisfy those ports.

## Pipeline (admitted path)

```text
prompt
  -> POST /api/criteria/design
       stage criteria            (bouncer + required ports)
       stage criteria_applicability (fail-closed port audit)
  -> UI shows criteria
  -> immediately POST /api/criteria/answer  (same run_id)
       stage criteria_answer
  -> after 7s, center overlay shows the draft
```

Rejected prompts stop after design: no criteria object, no answer call.

Key files:

- Backend designer/answer: [`backend/app/pipeline/criteria.py`](../backend/app/pipeline/criteria.py)
- Run log: [`backend/app/criteria_log.py`](../backend/app/criteria_log.py)
- API: [`backend/app/main.py`](../backend/app/main.py)
- UI: [`frontend/src/criteria/CriteriaDesignerView.tsx`](../frontend/src/criteria/CriteriaDesignerView.tsx),
  [`frontend/src/criteria/AnswerOverlay.tsx`](../frontend/src/criteria/AnswerOverlay.tsx)

## Criteria schema (fixed ports)

Ports are always defined; each prompt only marks a subset as required:

| Port | Intended role (answer-facing) |
|------|-------------------------------|
| `canonical_form` | Fix scope / partition / query shape |
| `theorem` | Derivational answer assertions under declared logic |
| `observation_map` | Observable settlement conditions for assertions |
| `layer_separation` | Separate intersubjective vs agent-relative layers |
| `revision_protocol` | Defeaters / update rules for answer assertions |
| `meta_exhaustiveness` | Structural coverage of the answer space |
| `source_class_ranking` | Answer must state how it weights evidence classes |

Design rules in force at this snapshot:

- Criteria constrain the **best possible answer**, not upstream retrieval.
- Applicability audit is fail-closed: omitted or weak ports are dropped.
- “Answer assertion” means a statement the eventual response asks readers to
  accept, not a claim ingested from a source.
- Meta-exhaustiveness allows enumeration when it strengthens coverage.
- Source-class ranking is only for answer-facing weighting, not search ranking.

## Answer generation: does Grok get the criteria?

**Yes.** The answer call is a second Grok request. The user message is JSON with
both the original prompt and the full criteria object
(`required_ports`, `port_parameters`, `port_applicability`, `logic_fragment`,
`completeness_template`, etc.). See `answer_to_criteria` in
[`criteria.py`](../backend/app/pipeline/criteria.py).

What it does **not** get at this snapshot:

- web search / retrieval
- case-study corpora
- any evidence attachments beyond the prompt text and the criteria schema

So the model is asked to satisfy structural ports with almost no world data. That
is enough to produce a fluent, schema-shaped draft. It is not enough to produce
a grounded factual report.

## Charlie Kirk case (`run_id` 29)

Logged artifact:
[`backend/app/data/criteria_runs/29.json`](../backend/app/data/criteria_runs/29.json)

| Field | Value |
|-------|--------|
| Prompt | `Who shot Charlie Kirk?` |
| Model | `grok-4.3` |
| Bouncer | admitted as `factual_closed` |
| Required ports after audit | `canonical_form`, `revision_protocol` |
| Audit removed | `observation_map`, `meta_exhaustiveness` |
| Answer headline | “No entity is identified as having shot Charlie Kirk under the closed factual query.” |

What went wrong (interesting failure mode, not a missing-criteria bug):

1. Criteria correctly treated this as a closed identification query and required
   a partition plus defeaters.
2. The answer model received those criteria and obediently filled them.
3. With no evidence attachment, it resolved the partition to a **no-shooter**
   case by internal logic alone (“predicate does not attach”), then wrapped that
   in revision protocol language.
4. The result looks “lobotomized”: highly structured, port-compliant, and
   epistemically cautious in form, while being factually unmoored or bizarre as
   a response to a real-world who-question.

This is exactly what the stack currently incentivizes: **criteria satisfaction
without evidence**. The overlay presents a criteria-satisfying draft, not a
researched investigation.

## UI state at this snapshot

- Left: prompt, model, bouncer, token/cost stats, run id, **Show answer**
- Center: required criteria phrases, explanatory paragraphs, logic-in-force
  (collapsed title), port chips, port inspector
- Right: technical details (collapsed by default); type signature / parameters /
  completeness collapsed; criteria object expanded
- Overlay: headline → summary → assertions/defeaters → port coverage → residual
  uncertainty; dismissible; reopen via Show answer
- Conventions: hide vertical scrollbar chrome; no em dashes in UI copy

## Persistence for issue reports

- Per-run JSON: `backend/app/data/criteria_runs/{run_id}.json`
- Append-only index: `backend/app/data/criteria_run_log.jsonl`
- SQLite run artifact (same payload)
- List/fetch: `GET /api/criteria/runs`, `GET /api/criteria/runs/{run_id}`

When flagging a bad run, cite the **run id**.

## Honest read of the architecture

Working:

- Bouncer + applicability audit as a separable design envelope
- Port schema as a stable interface for later evidence attachments
- Ledgered multi-stage costs
- Run logs good enough to debug weird answers

Not working yet (exposed by run 29):

- Answer stage has no evidence ports filled by search or corpora
- Criteria can be “satisfied” by pure structural improvisation
- Overlay can make that improvisation look like a finished report

Likely next seam: keep criteria-first generation, but retarget the answer stage
so ports shape a substantive judgment (what the model takes to be true) rather
than inviting empty structural improvisation. External retrieval can come later;
the immediate gap is “answer the prompt in port form,” not “lecture the schema.”

## Snapshot stamp

- Date: 2026-07-30
- Exemplar run: 29 (`Who shot Charlie Kirk?`)
- Follow-up: answer-stage prompt retargeted so Grok must answer substantively
  from its judgments, with ports as form rather than content substitutes
- Code locus: Inference Resolver criteria designer + answer overlay as of this
  commit of the working tree