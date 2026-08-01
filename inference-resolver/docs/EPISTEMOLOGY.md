# Criteria Designer Epistemology (settled policy)

This document is the **settled epistemic policy** for the Inference Resolver
Criteria Designer (design, applicability audit, and criteria-satisfying answer).
It governs runtime prompts and schema interpretation. It does **not** amend the
FLF competition mirrors under `docs/competition/`; those remain the repo-wide
canonical constraints for product/competition attitude.

Build order (prompt → criteria object → forward stages) is settled in
[`CRITERIA_FIRST.md`](CRITERIA_FIRST.md); keep attitude here and direction of
fit there aligned when both change.

Conflict rule: if this file and the runtime prompts in
`backend/app/pipeline/criteria.py` diverge, **update both together**. Prefer
this file as the human-readable source of settled policy and keep prompts as
the executable encoding.

Schema version encoded in artifacts: `criteria-schema/v2`.

---

## 1. Stance

1. The designer supports investigation. It does not arbitrate final truth.
2. A user prompt already carries answerhood conditions (what would count as a
   direct, partial, or presupposition-challenging response). Criteria generation
   **excavates** those conditions before inventing stack structure.
3. The fixed port schema is an **encoding layer**, not the starting ontology of
   the question. Ports are chosen to catch failures of answering *this* prompt.
4. “Evidence,” at the answer stage, means the grounds of the model’s judgment
   about what is true or best supported, expressed in the forms the required
   ports expect. External retrieval may be added later; it is not required for
   the answer stage to be substantive.

---

## 2. Process (admitted prompts)

Ordered, non-optional:

1. **Excavate** the prompt’s answerhood sketch and presuppositions.
2. **Separate layers** of any demand: erotetic (from the question), stack
   (investigation norms we add), pragmatic (chatbot/helpfulness defaults the
   bare interrogative does not fix). Prefer erotetic.
3. **Encode** into the fixed port schema with structural parameters only.
4. **Mark underdetermination**: what the prompt fixes vs what remains a choice.
5. **Audit** required ports fail-closed for necessity, fulfillability,
   non-duplication, role-correctness, answer-facingness, and erotetic grounding.
6. **Answer** substantively under the surviving criteria and answerhood sketch.

Rejected prompts stop after the bouncer: no criteria object, no answer call.

---

## 3. Bouncer (scope, not difficulty)

Admission is the default. Ask whether a question **arises** for which a workable
answerhood schema can be stated (partition-like or openly incomplete).

Do **not** reject for breadth, vagueness, missing specifics, long horizons,
uncertainty, multi-causal structure, or contested subject matter. Reframing
needs are admitted; `canonical_form` carries them.

Reject only when public answerhood fails:

| Code | Meaning |
|------|---------|
| `preference_aesthetic` | Pure taste; no factual/public core remains |
| `open_future_prediction` | No regularity/base rate/driver/constraint evidence could speak to |
| `pure_normative` | Pure ought with no factual or policy-text core |
| `non_partitionable` | No workable answerhood schema at all (not even an open one) |
| `pure_personalization` | Only private to the asker; no separable intersubjective layer |

Rejection messages name the missing structural precondition, not difficulty.

---

## 4. Answerhood excavation

For admitted prompts, criteria must include:

- **direct_answer**: what counts as a complete direct resolution
- **partial_answer**: when a partial response is admissible
- **presupposition_challenge**: when denying a presupposition is in-bounds vs evasion
- **partition_licensed**: whether the question’s form licenses an exhaustive cell partition
- **open_answerhood**: if not partition-licensed, what counts as a resolving contribution and what remains essentially incomplete
- **presuppositions**: operative presuppositions with status `accepted` | `contested` | `challengeable`
- **prompt_fixes** / **prompt_leaves_open**: underdetermination made explicit

### Partition discipline

- If partition-licensed: `canonical_form` should state the cells.
- If not: do **not** invent a fake exhaustive partition for structural theater.
  Use open answerhood instead.

---

## 5. Criteria layers

Each required port is labeled:

| Layer | Meaning |
|-------|---------|
| `erotetic` | Implied by the question’s form/presuppositions/answerhood |
| `stack` | Investigation norm we add (e.g. revision) still needed for the best answer |
| `pragmatic` | Chatbot/helpfulness surplus; use rarely and label it |

Silent conflation of alignment/helpfulness habits with question-implied criteria
is a policy violation.

---

## 6. Port applicability audit

A candidate required port survives only if **all** hold:

1. Necessary for the best answer to this prompt  
2. Fulfillable  
3. Non-duplicative  
4. Role-correct  
5. Answer-facing (not retrieval/ingest hygiene)  
6. Erotetically grounded: catches a failure of answering this prompt given the
   excavation, **or** is an explicit stack surplus still necessary for the best
   answer  

Fail-closed: omitted assessments, missing reasons, or zero approvals are errors.
Uncertainty about answer-facing or erotetic grounding means **drop** the port.

Ambition is allowed when it tightens answerhood. Ambition that only adds unasked
exams is not.

---

## 7. Fixed ports (roles)

The schema is fixed; only the required subset and parameters vary.

| Port | Role |
|------|------|
| `canonical_form` | Fix proposition, licensed partition, or open query schema |
| `theorem` | Genuine derivational constraint under declared logic |
| `observation_map` | Observable settlement conditions for assertions (not auto-required for empirical prompts; does not by itself prove forecasts) |
| `layer_separation` | Separate intersubjective from agent-relative content when both appear |
| `revision_protocol` | Defeaters/update rules for non-trivial answer assertions. Acceptance includes **salience weighting**: a good attachment leads with high-salience defeaters (near-term / high-base-rate under the prompt’s horizon); rare or long-horizon defeaters may be named but only briefly, in proportion to rarity—even when that short note slightly diverts flow. Equal listing is not equal weight. Exotic or remote defeaters must not dominate what counts as satisfying this port. |
| `meta_exhaustiveness` | Structural coverage when completeness is meaningful; no fake exhaustiveness |
| `source_class_ranking` | Answer must state how it weights distinct evidence classes it relies on |

Answer assertions are statements the eventual response asks readers to accept.
They are not source claims ingested from elsewhere.

---

## 8. Criteria-satisfying answers

Given prompt + criteria (including answerhood):

1. Answer the prompt from what the model judges true or best supported.
2. Present that substance in the required port forms.
3. Resolve excavated direct/open answerhood conditions.
4. Keep defeaters and residual uncertainty visible.
5. Do not replace substance with schema lectures or vacuous partitions.
6. Do not invent fake citations.
7. Partial answers or presupposition challenges only when criteria mark them
   in-bounds.

Ports are shape. Judgment supplies content. When `revision_protocol` is
required, its attachment must meet that port’s acceptance conditions
(including salience weighting of defeaters).

---

## 9. Working schema, not dogma

Generated criteria are a **working schema** for this prompt. They may be revised
when a better answer reveals a better question-answer complex. Revision protocol
applies to non-trivial answer assertions; the schema itself remains fallible
policy for the run, not an absolute prior.

---

## 10. Persistence and review

Runs are logged for critique:

- `backend/app/data/criteria_runs/{run_id}.json`
- `backend/app/data/criteria_run_log.jsonl`
- SQLite run artifact

Cite `run_id` when reporting epistemic failures (empty structure, fake
partitions, smuggled stack ports, non-substantive answers).

---

## 11. Change control

Settled means:

- Changes to designer/audit/answer attitude update **this file** and
  `backend/app/pipeline/criteria.py` in the same change set.
- Do not silently weaken fail-closed audit behavior.
- Do not expand the fixed port list without a deliberate schema version bump
  and migration note.
- Competition mirrors under `docs/competition/` are out of scope for ordinary
  criteria-attitude edits unless the change conflicts with them; if it does,
  warn and resolve explicitly per `docs/competition/CANONICAL.md`.
