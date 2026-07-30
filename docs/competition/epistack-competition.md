# Lab Leaks, Black Holes, and Eggs: Epistemic Case Study Competition

> Local mirror of [flf.org/epistack-competition](https://flf.org/epistack-competition/)
> (Future of Life Foundation, Jun 4, 2026). Prefer the live page for updates.

We are running a competition to find the best workflows and methodologies for
using AI to produce reliable, trustworthy knowledge bases, grounded in
real-world cases. We’re open-minded on the types of submissions we receive and
on how they address the problem. We’ve set aside approximately $200k for prizes.
Winning submissions may receive a prize from $5k–$50k and if submissions
warrant, multiple $50k prizes are possible. Winners may be offered opportunities
for further funded work.

The heights of human epistemic investigation are impressive and valuable, but
rare and difficult to reach. Forecasting the shape and capability of future AI
is difficult, but we are excited to imagine a world where epistemic
investigations of this (and greater!) quality are commonplace. We’re aiming to
catalyse that path through activities like this competition. The limiting factor
is rarely exquisite insight (though this helps!), and more often diligence, a
curious and open mindset, and the time and effort needed to do the thorough work
investigating background on a topic: activities AI is well placed to assist
with.

Existing AI-assisted knowledge base work demonstrates real pieces of this —
agent memory (e.g., Claude Code’s memory and skills), LLM-curated personal wikis
(Karpathy’s perhaps the highest-profile), and deep-research tools. But these
mostly produce single-user artifacts tuned to one investigator’s context, not
the kind that travel, combine, or survive (especially adversarial) scrutiny.

We’re particularly excited by the compounding potential — if structured analyses
become reusable, refineable artifacts, every serious investigation enables
future work, on the same or related topics, and by the same or different people,
to reach further from a more solid epistemic foundation.

By *structure*, we mean capturing the relations between different sources,
claims, authors, and so on. Who said what and when? What evidence or reasons
support that? What counterarguments exist or reasons for doubt? Keeping this
structure alive means less loss by compression, and preserving space for nuance
— even if we don’t consume it right away.

This competition provides three challenging case studies — with deliberately
varied challenge profiles — and invites you to produce tooling and techniques to
help people navigate them:

1. The debated and impactful question of COVID-19 origins.
2. The risk that the Large Hadron Collider (LHC) creates synthetic black holes
   (perhaps destroying the Earth).
3. The health impact of eggs (as a human food source).

The tooling should be general: we’ll judge against these and also other
difficult case studies.

---

## What we’re looking for

We want to see workflows and methodologies using AI that advance the state of
the art in carrying out epistemic investigations and producing compounding
knowledge bases. We aren’t asking you to build an entire, robust, fully-featured
system. Instead, we’re excited by any submission that advances the
state-of-the-art on a component.

We’ve found it useful to think of these investigations as being split into
several different layers: **ingestion**, **structure**, and **assessment**. When
stacked together and operating in concert, they’d create useful trusted
artifacts — something like a superior deep research, generating and interacting
with a structured knowledge base, aimed at the truly epistemically discerning
consumer.

Most submissions need not focus on a single layer alone — something useful
likely works across layers — but some discipline in separating these
responsibilities may help produce interoperable, shareable, compounding
benefits.

### Ingestion

How do you take a messy, multi-source evidence base and turn it into something
structured enough to reason over?

- Extract and attribute claims to specific sources, with provenance metadata
  (who said what, when, in what context).
- Identify when the same claim appears across multiple sources in different
  forms.
- Search for resources with bearing on topics and subtopics at hand.
- Capture useful metadata tags — e.g. relating sources and claims to topics and
  other sources (toward structure) or about methodologies, deference, and
  assumptions (toward assessment).

### Structure

How do you document the relationships between claims so that the full shape of
the argument becomes navigable?

- Resolve the inference structure: which claims and evidence are offered as
  support for which other claims.
- Represent the discourse structure: where people are addressing different
  sub-questions and perhaps how they are tracking those relating to an overall
  inquiry — there may be explicit, and sometimes implicit, differences of
  emphasis.
- Capture relationships regarding “similar but not identical” claims (different
  framings, caveats, or uncertainty estimates).
- Track how the structure evolves over time.

### Assessment

How do you evaluate what to actually believe, or what to look at next, given
everything above?

- Identify rhetorical moves that carry more persuasive weight than evidential
  weight.
- Flag correlated evidence being treated as independent.
- Identify cruxes — factual or inferential disagreements that, if resolved,
  would most change the overall picture.
- Surface what’s missing — important sources or perspectives that aren’t
  represented in the working knowledge base.
- Provide frameworks for calibrating confidence that account for out-of-model
  error, adversarial information environments, and the limits of any single
  analyst’s expertise.
- Distinguish what the debate settled from what it merely performed settling.

---

## What a good entry looks like

We’ll offer a minimum of $5k to entries which we judge to meaningfully improve
on the state of the art in faithful, scalable AI-assisted investigations, and up
to $50k for entries which are truly inspiring to us. This might be by (for
example) reliably producing accessible, thorough, highly-interoperable
knowledge-enabling content across diverse domains which is readily shared and
expanded on by others.

We aren’t prescribing a single, specific type of submission. Written discussions
should aim not to exceed 10 pages, not including appendix-like material and
worked examples. Worked examples and fully-fledged example knowledge bases can
be arbitrarily sized (within reason) but should be navigable. Code should either
be brief, legible (pseudo)code or well-documented and ready to install and run
with close to a single click. Full format rules:
[format-and-length.md](format-and-length.md).

Shapes we’d be excited to see:

- **A workflow spec** — a step-by-step human–AI process for structured epistemic
  analysis of a complex dispute, demonstrated on multiple parts of at least two
  cases. It can incorporate human steering and be subjective in places, but
  should let others (even with differing beliefs) pick up where another left
  off, and scale toward mostly-or-entirely hands-free. Make tradeoffs and
  uncertain design choices transparent.
- **A prototype tool** (most likely an LLM pipeline) implementing one or more
  stack layers, demonstrated repeatably on each case study. Minimally,
  substantially accelerate investigation; ideally produce reusable, shareable
  artefacts that stand up to adversarial pressure.
- **A protocol** enabling interoperability and compounding without flattening
  nuance, demonstrated on the cases. How do we navigate interoperability vs
  nuance? What format links diverse subtopics and multi-perspective
  investigations while preserving detail? How is it maintained as sources, users,
  and AI capability expand?

A submission might combine these (e.g. a spec with protocol discussion and a
reference prototype). Stepping-stone alternatives (less likely to win top prizes
without follow-up):

- A comparative analysis applying two or more AI assessment methodologies to the
  same (sub-)questions, with explicit discussion of agreement, divergence,
  strengths, shortcomings, and supporting metadata that would help them work
  better — ideally reimplementable by judges on a new case.
- A critique with counterexamples of an otherwise promising approach.

Optionally, submit a plan or briefer implementation by **Jun 21, 2026** for
early feedback (main submission form + early-feedback checkbox).

**What we care about most:** Would this actually help someone reason better
about this case? Does it generalize? Does it scale with improvements to AI or
more compute? Does it compound, with multiple people or teams building on each
others’ work?

Judges use the criteria in [judging-criteria.md](judging-criteria.md) (source
PDF: [judging-criteria.pdf](judging-criteria.pdf)).

Entries are due by **Jul 19, 2026**. FLF’s general contest rules apply.

Strong entries may also lead to offers of further funded work (estimated ~75%
chance for a $50k-winning entry).

---

## Prize structure

Roughly $200k allocated; prefer fewer, larger prizes for work that genuinely
impresses. Pool can expand for a wave of strong work.

- **$50k** — entries that are truly inspiring; may not be awarded, or may be
  awarded more than once if multiple entries clear the bar.
- **$5k–$50k** — meaningful advances on SOTA across the stack or a well-defined
  piece (ingestion, structure, or assessment).
- **Continuation funding** — for the strongest entries, ongoing relationship
  with FLF may be the real prize.

See also prize-tier guidance under [judging criteria](judging-criteria.md).

---

## Why we’re doing this

We’re building toward a full **epistemic stack** — layered infrastructure for
making the provenance, structure, and assessment of knowledge transparent and
traversable at scale. Recent AI advances make this newly tractable; the hard
problems are methodology, workflow design, and usability, not just capability.

FLF hopes to inform strategy and prioritisation based on insights from these
tools — great work here could move millions of dollars per year.

Related vision page: https://flf.org/epistack

---

## The case studies

### COVID

In early 2024, a $100,000 judged debate took place between Saar Wilf (Rootclaim)
and Peter Miller on COVID-19 origins. Over 15 hours of structured argument, two
people marshalled epidemiological data, viral genetics, Bayesian inference, and
institutional analysis to opposite conclusions. Two expert judges ruled
decisively for zoonosis. Six independent Bayesian analyses of the same evidence
spanned 23 orders of magnitude.

Scott Alexander’s writeup, judge decisions, debate videos, and comment threads
form one of the richest public records of a complex real-world epistemic
dispute — yet remain incredibly difficult to navigate, interrogate, and use to
inform beliefs. Background expertise is required; a live video format may favor
memorized knowledge; the conversation continues to evolve after the debate
snapshot.

**Job:** craft AI-assisted methodologies that help people navigate this topic
successfully — ideally as living knowledge bases, not mere snapshots.

Starting material (see live page for links):

- Scott Alexander’s COVID origins debate writeup (core case material)
- Judge Will’s decision | Judge Eric’s decision
- Michael Weissman’s Bayesian analysis
- Rootclaim’s response
- Debate videos: Sessions 1–3

### Black holes

CERN FAQ: Will CERN generate a black hole? How were apocalyptic concerns put to
rest (were they truly? what does that hinge on?)?

Unlike COVID, this is (we hope) essentially a closed, uncontested case that
nonetheless rests on a huge body of accumulated, interacting knowledge. The key
challenge may be probing argument dependencies and weakest/most speculative
points — accessibly.

### Eggs

Are eggs good / bad / fine in moderation? How can we tell? Does it vary across
people? What else matters?

Vague and open-ended, but representative of many everyday (and higher-stakes)
questions. Resolving what the important questions are and what ways of knowing
are appropriate is often more than half the challenge.
