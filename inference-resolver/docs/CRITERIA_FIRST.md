# Criteria-first architecture (settled)

This document is the **settled build-order policy** for Inference Resolver work
that touches the Criteria Designer or anything downstream of it (evidence needs,
gather/ingest, answer, claim-graph linking, assessment).

Epistemic attitude for design/audit/answer remains in
[`EPISTEMOLOGY.md`](EPISTEMOLOGY.md). This file governs **direction of fit**:
what is generated first, and what later stages are allowed to depend on.

Conflict rule: if implementation or a plan inverts this order, **stop and
align** to this file (and update prompts/code in the same change set if the
settled policy itself is deliberately revised). Epistemic attitude changes
also update [`EPISTEMOLOGY.md`](EPISTEMOLOGY.md).

Schema version for the criteria artifact: `criteria-schema/v2` (see
`backend/app/pipeline/criteria.py`).

---

## 1. Stance

1. **Criteria are generated directly from the user prompt** — bouncer, answerhood
   excavation, `resolution_mode`, required ports, port parameters, layers, and
   applicability audit.
2. That audited **criteria object is the hub data structure** for the run.
3. Everything after design **builds forward from that object**. Later stages may
   refine, attach, or satisfy it; they must not replace it with a parallel
   ontology invented from search results, corpora, or answer drafts.
4. Criteria remain **dynamic per prompt**. Downstream work consumes *this run’s*
   surviving `required_ports` and `port_parameters`, not a fixed spine assumed
   for every inquiry.

---

## 2. Forward order

Admitted path (conceptual; stages may be added but not reordered past the hub):

```text
prompt
  → criteria design + applicability audit   (criteria object)
  → evidence-need plan                      (derived from criteria)
  → gather / ingest                         (web_search → provenance-bearing finds)
  → criteria-satisfying answer              (ports as shape; finds as content)
  → optional: structure / assessment        (compounds on the same inquiry)
```

Implemented stages:

- Evidence needs: `POST /api/criteria/evidence-needs` (`criteria_evidence_needs`)
  emits `evidence-needs/v1` from the audited criteria only.
- Gather: `POST /api/criteria/gather` (`criteria_gather`) uses xAI Responses
  `web_search` and emits `gather/v1` finds (claim + source URL/title). Skips
  when no settlement/defeater/class-hint needs were authorized.

Rejected prompts stop after the bouncer: no criteria object, no forward stages.

---

## 3. Allowed vs forbidden

**Allowed**

- Deriving search queries, settlement checks, or defeater hunts **from** the
  audited criteria (especially answerhood, canonical scope, observation map,
  revision parameters).
- Attaching external finds as typed material that **satisfies** required ports.
- Revising the working criteria when a better answer reveals a better
  question–answer complex (fallible working schema — see EPISTEMOLOGY §9),
  then continuing forward from the revised object.

**Forbidden**

- Starting from retrieval, deep research, or a claim graph and **retrofitting**
  criteria afterward as decoration.
- Treating answer ports as a generic retrieval API or search-ranker config
  (ports are answer-facing; see EPISTEMOLOGY §6–7).
- Assuming a fixed required-port checklist for gather/answer regardless of the
  audit outcome.
- Building a second “real” schema alongside criteria that the answer is judged
  against instead.

---

## 4. Change control

Settled means:

- New pipeline stages that feed the criteria-satisfying response must declare
  the audited criteria object (or an explicit derivative of it) as input.
- Do not invert prompt → criteria → forward dataflow without updating **this
  file** and the executable pipeline together.
- Competition mirrors under `docs/competition/` stay out of scope for ordinary
  edits here unless the change conflicts with them; if it does, warn per
  `.cursor/rules/canonical-epistack-docs.mdc`.
