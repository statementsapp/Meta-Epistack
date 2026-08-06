# Criteria Designer Epistemology (settled policy)

This document is the **settled epistemic policy** for the Inference Resolver
Criteria Designer (design, applicability audit, criteria-satisfying answer, and
the attitude those stages impose on needs/gather). It governs runtime prompts
and schema interpretation. It does **not** amend the FLF competition mirrors
under `docs/competition/`; those remain the repo-wide canonical constraints for
product/competition attitude.

Build order (prompt → criteria → needs → gather → answer) is settled in
[`CRITERIA_FIRST.md`](CRITERIA_FIRST.md). Keep attitude here and direction of
fit there aligned when both change.

Conflict rule: if this file and the runtime prompts in
`backend/app/pipeline/criteria.py` diverge, **update both together**. Prefer
this file as the human-readable source of settled policy and keep prompts as
the executable encoding. Pipeline-order edits also update `CRITERIA_FIRST.md`.

Schema version encoded in artifacts: `criteria-schema/v2`.

---

## 1. Stance

1. The designer supports investigation. It does not arbitrate final truth.
2. A user prompt already carries answerhood conditions (what would count as a
   direct, partial, or presupposition-challenging response). Criteria generation
   **excavates** those conditions before inventing stack structure.
3. The fixed port schema is an **encoding layer**, not the starting ontology of
   the question. Ports are chosen to catch failures of answering *this* prompt.
4. Keep three notions distinct:
   - **Answer judgment**: what the model takes to be true or best supported.
   - **Port attachments**: that judgment shaped to required port forms.
   - **Gathered finds**: provenance-bearing claim atoms (who said what, with
     source). When gather supplied finds, the answer must prefer them for
     settlement and defeaters, cite them when relied on, and name unmet needs
     when finds are missing. Finds are not a second ontology beside criteria.

---

## 2. Process (admitted prompts)

Ordered, non-optional:

1. **Excavate** the prompt’s answerhood sketch and presuppositions.
2. **Separate layers**: erotetic (from the question), stack (standing
   investigation norms), pragmatic (chatbot/helpfulness surplus). Prefer
   erotetic for port choice; see §5 for the standing stack exception.
3. **Encode** into the fixed port schema with structural parameters only.
4. **Mark underdetermination**: what the prompt fixes vs what remains a choice.
5. **Audit** required ports fail-closed (with the open-schema exception in §6).
6. **Plan evidence needs** from the audited criteria (derivative, not a
   parallel schema).
7. **Gather** provenance-bearing finds against those needs when authorized.
8. **Answer** under surviving criteria, using finds when present.

Rejected prompts stop after the bouncer: no criteria object, no needs, gather,
or answer.

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
| `open_future_prediction` | No regularity, base rate, driver, constraint, **or workable conditioning/query schema** any evidence could speak to. Long horizon or missing specifics alone is not enough to reject. |
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
- **resolution_mode**: how a satisfactory resolution is framed for this prompt
  (`mechanism_inference` | `discourse_map` | `mixed`)

### Resolution mode

Excavate whether the prompt asks for scientific/mechanism resolution or for
mapping discourse:

| Mode | Use when |
|------|----------|
| `mechanism_inference` | What happened, what caused it, which physical/empirical hypothesis holds, or what constraints/programs remain live in unsettled science |
| `discourse_map` | Who argued what, who won a debate, how positions relate in a corpus |
| `mixed` | Both layers are in-bounds; keep them syntactically separate |

Rules:

- Prefer `mechanism_inference` for causal, historical-reconstruction, and
  theory-constraint prompts even when public materials are debate-shaped.
- Prefer `discourse_map` when the interrogative targets debate outcome or
  speaker structure.
- Debate corpora may still be gathered as sources under `mechanism_inference`;
  discourse completeness does **not** count as satisfying scientific answerhood.
- Under `mechanism_inference`, direct answerhood is typically: observables →
  hypothesis cells or open research-program schema → supported / ruled out /
  underdetermined. Naked debate scores and unbacked numeric posteriors do not
  satisfy. For unsettled speculative science (e.g. quantum gravity), keep
  `partition_licensed` false when no exhaustive cell set is licensed; use open
  answerhood over non-exhaustive programs plus discrimination conditions.

### Partition vs open query schema

- If partition-licensed: `canonical_form` states the cells.
- If not: do **not** invent a fake exhaustive partition (e.g. claiming a closed
  set of calendar years is the unique resolution of an open forecast).
- Open is not empty. When `prompt_leaves_open` includes horizon, metric, or
  conditioning frame, or `open_answerhood` says resolution is incomplete
  without such a frame, require an explicit **working query schema**: working
  horizons, scenario/driver axes, and what remains incomplete. Prefer encoding
  that in `canonical_form` as QuerySchema, labeled as a working choice where
  the prompt left matters open. That is not a licensed partition of the future.
- **Ambition test:** owning items in `prompt_leaves_open` with a labeled working
  schema tightens answerhood and is allowed. Adding exams the excavation does
  not need is not.

### Predictive prompts

Admit as `predictive_constrained` when regularities, drivers, base rates, or a
workable conditioning schema could speak. Direct answerhood is typically
scenario-conditioned forecasts with drivers and update conditions under an
explicit working temporal frame, not a point prophecy and not a fake
year-partition.

### Dynamic port essentials by resolution mode

Ports stay fixed; `required_ports` and `port_parameters` vary with excavation.

When `resolution_mode` is `mechanism_inference`:

- `canonical_form`: prefer a licensed hypothesis partition when the question
  licenses cells; otherwise an open query schema over constraints and
  non-exhaustive programs. Parameters name cells/programs, not debaters.
- `observation_map`: usually required when observables can speak. Parameters
  list observable settlement predicates first (timelines, measurements,
  sampling/constraint conditions), not narrative talking points. May be thin
  for speculative domains with few touchpoints.
- `revision_protocol`: defeaters are what would rule a cell/program in or out;
  “lost the debate” is not a defeater. Salience rules in §7 still apply.
- `meta_exhaustiveness`: only over the declared hypothesis/mechanism schema,
  not discourse coverage.
- `source_class_ranking`: weight evidence classes (e.g. epi, sequence,
  documentary provenance, theoretical consistency), not speaker prestige.
- `theorem`: only for genuine derivation; never a costume for a hunch.
- `layer_separation`: when blame/policy mixes with mechanism.

When `resolution_mode` is `discourse_map`, structure- and speaker-facing
completeness may be in-bounds; do not force mechanism-first observation maps
merely to look scientific.

Evidence-need plans inherit the mode: under `mechanism_inference`, settlement
and defeater needs target observables and cell/program-ruling evidence, not
“arguments on both sides.”

---

## 5. Criteria layers

| Layer | Meaning |
|-------|---------|
| `erotetic` | Implied by the question’s form/presuppositions/answerhood |
| `stack` | Standing investigation norm we add when still needed for the best answer |
| `pragmatic` | Chatbot/helpfulness surplus; use rarely and label it |

Prefer erotetic when choosing among optional ports. Exception:
`revision_protocol` is a **standing stack norm** for any non-trivial answer
assertion (empirical, causal, comparative, or predictive). Label it `stack`
unless the question itself clearly demands defeaters. Do not treat “prefer
erotetic” as a reason to drop revision.

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
   answer (including standing `revision_protocol`)  

Fail-closed default: omitted assessments, missing reasons, or zero approvals
are errors. Uncertainty about answer-facing or erotetic grounding means **drop**
the port.

**Open-schema exception (decisive):** if `open_answerhood` or
`prompt_leaves_open` says resolution is incomplete without a horizon,
metric, or conditioning frame, then `canonical_form` as an open QuerySchema is
**necessary**. Do not drop it for uncertainty, and do not drop it merely because
the prompt did not fix calendar years. Reject only parameters that invent a fake
*exhaustive licensed partition* while `partition_licensed` is false.

---

## 7. Fixed ports (roles)

The schema is fixed; only the required subset and parameters vary.

**Salience** (for `revision_protocol`): importance under the prompt’s **subject
and working horizon**. Base rate is one input to salience, not the definition.

| Port | Role |
|------|------|
| `canonical_form` | Proposition, licensed partition, or open query schema (working horizons / conditioning axes when the prompt leaves them open) |
| `theorem` | Genuine derivational constraint under declared logic. **Not** for ordinary empirical or predictive forecasts; do not use as a grand name for a stock call or scenario guess. |
| `observation_map` | Observable settlement conditions for answer assertions. Require when settlement predicates materially resolve ambiguity the query schema does not already resolve. Do not auto-require for every empirical prompt; for predictive prompts, require when driver-to-outcome settlement is part of direct answerhood. Does not by itself prove forecasts. |
| `layer_separation` | Separate intersubjective from agent-relative content when both appear |
| `revision_protocol` | Defeaters/update rules for non-trivial answer assertions. Lead with high-salience defeaters. Subject-salient rare or long-horizon defeaters **must appear at least briefly**; omitting all of them fails the port. They must not dominate. Encode `salience_weighted: true` in parameters. |
| `meta_exhaustiveness` | Structural coverage of the **declared** working schema when completeness is meaningful; no fake exhaustiveness over undeclared futures |
| `source_class_ranking` | Answer must state how it weights distinct evidence classes it relies on. Gather may use surviving class hints as consult preferences; that does not turn this port into a search ranker. |

Answer assertions are statements the eventual response asks readers to accept.
They are not source claims ingested from elsewhere.

---

## 8. Criteria-satisfying answers

Given prompt + criteria (+ needs/gather when present):

1. Answer the prompt. When gather finds exist, prefer them for settlement and
   defeaters; otherwise use judgment and state unmet needs.
2. Present substance in the required port forms.
3. Resolve excavated direct/open answerhood conditions, including any working
   query schema adopted for open underdetermination.
4. Respect `resolution_mode`: under `mechanism_inference`, do not treat debate
   completeness or unbacked numeric posteriors as resolution; prefer supported /
   ruled out / underdetermined. Under `discourse_map`, mapping positions may
   satisfy.
5. Keep defeaters and residual uncertainty visible (salience rules in §7).
6. Do not replace substance with schema lectures or vacuous partitions.
7. Do not invent fake citations or URLs.
8. Partial answers or presupposition challenges only when criteria mark them
   in-bounds.

Ports are shape. Judgment and finds supply content.

---

## 9. Working schema, not dogma

Generated criteria are a **fallible working schema for this run**. They are not
an absolute prior. Mid-run automatic revision of the criteria object after
gather or answer is **not** implemented; improve by a new run or an explicit
future revision stage. `revision_protocol` applies to answer assertions, not to
silently rewriting the criteria hub after the fact.

---

## 10. Persistence and review

Runs are logged for critique:

- `backend/app/data/criteria_runs/{run_id}.json`
- `backend/app/data/criteria_run_log.jsonl`
- SQLite run artifact

Cite `run_id` when reporting epistemic failures (empty structure, fake
partitions, dropped open query schemas when horizon/frame was left open,
omitted subject-salient rare defeaters, smuggled pragmatic ports,
non-substantive answers, ignoring gather finds).

---

## 11. Change control

Settled means:

- Changes to designer/audit/answer attitude update **this file** and
  `backend/app/pipeline/criteria.py` in the same change set.
- Changes to build order or stage wiring also update `CRITERIA_FIRST.md`.
- Do not silently weaken fail-closed audit behavior except via the documented
  open-schema exception in §6.
- Do not expand the fixed port list without a deliberate schema version bump
  and migration note.
- Competition mirrors under `docs/competition/` are out of scope for ordinary
  criteria-attitude edits unless the change conflicts with them; if it does,
  warn and resolve explicitly per `docs/competition/CANONICAL.md`.
