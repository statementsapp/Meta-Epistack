import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { api } from "../api";
import { useStore } from "../store";
import {
  type AnswerResult,
  type DesignResult,
  type EvidenceNeedPlan,
  type GatheredFind,
  type GatherPacket,
  type Presupposition,
} from "./types";
import { questionToHeading } from "./questionToHeading";
import {
  annotateSummary,
  buildLensTargets,
  buildLexicon,
  resolveSpans,
  type LensTarget,
} from "./summaryLens";

type FlowPhase = "idle" | "design" | "audit" | "needs" | "gather" | "answer";

/** First sentence/question only — Nimble takes input one unit at a time. */
function firstUnit(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return "";
  const m = t.match(/^(.+?[.!?])(?:\s|$)/);
  if (m) return m[1].trim();
  return t;
}

function toHeading(text: string): string {
  return questionToHeading(text);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHotSummary(
  summary: string,
  hot: { span: { id: string; start: number; end: number; text: string }; target: LensTarget }[],
  handlers: {
    activeId: string | null;
    onEnter: (spanId: string, target: LensTarget) => void;
    onLeave: (spanId: string) => void;
  },
): ReactNode {
  if (!hot.length) return summary;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const { span, target } of hot) {
    if (span.start < cursor) continue;
    if (span.start > cursor) {
      nodes.push(summary.slice(cursor, span.start));
    }
    const active = handlers.activeId === span.id;
    nodes.push(
      <mark
        key={span.id}
        className={`nimble-hot${active ? " is-active" : ""}`}
        onMouseEnter={() => handlers.onEnter(span.id, target)}
        onMouseLeave={() => handlers.onLeave(span.id)}
      >
        {summary.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  }
  if (cursor < summary.length) nodes.push(summary.slice(cursor));
  return nodes;
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function phaseLabel(phase: FlowPhase, running: boolean): string {
  if (!running && phase === "idle") return "";
  if (phase === "design") return "Designing…";
  if (phase === "audit") return "Auditing ports…";
  if (phase === "needs") return "Planning checks…";
  if (phase === "gather") return "Gathering…";
  if (phase === "answer") return "Drafting…";
  return "";
}

/** Truncate only when it saves real space; never clip a few characters. */
const MIN_TRUNC_SAVE = 28;

function clipText(text: string, max: number, expanded: boolean): string {
  const t = text.trim();
  if (expanded || t.length <= max || t.length - max < MIN_TRUNC_SAVE) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function markupInHeading(
  heading: string,
  source: string,
  presuppositions: Presupposition[] | undefined,
): { html: string; hits: number } {
  if (!heading) return { html: "", hits: 0 };
  // Markup contested phrases when they appear in the original unit (display uses heading).
  const marks = (presuppositions ?? []).filter(
    (p) =>
      (p.status === "contested" || p.status === "challengeable") &&
      p.text.trim().length >= 3,
  );
  if (!marks.length) return { html: escapeHtml(heading), hits: 0 };

  // Prefer marking in heading text; fall back to showing italic aside count.
  type Hit = { start: number; end: number; status: string };
  const hits: Hit[] = [];
  const lower = heading.toLowerCase();
  for (const m of marks) {
    const needle = m.text.trim().toLowerCase();
    const at = lower.indexOf(needle);
    if (at >= 0) {
      hits.push({ start: at, end: at + needle.length, status: m.status });
      continue;
    }
    // loose: mark overlapping tokens from source present in heading
    void source;
  }
  hits.sort((a, b) => a.start - b.start);
  if (!hits.length) return { html: escapeHtml(heading), hits: 0 };

  let out = "";
  let cursor = 0;
  for (const h of hits) {
    if (h.start < cursor) continue;
    out += escapeHtml(heading.slice(cursor, h.start));
    const cls =
      h.status === "contested"
        ? "nimble-mark nimble-mark-contested"
        : "nimble-mark nimble-mark-challengeable";
    out += `<mark class="${cls}" title="${escapeAttr(h.status)}">${escapeHtml(
      heading.slice(h.start, h.end),
    )}</mark>`;
    cursor = h.end;
  }
  out += escapeHtml(heading.slice(cursor));
  return { html: out, hits: hits.length };
}

export function NimbleView() {
  const health = useStore((s) => s.health);
  const storeModel = useStore((s) => s.model);
  const model = storeModel || health?.default_model || "";

  const [draft, setDraft] = useState("");
  const [committed, setCommitted] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<FlowPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const [design, setDesign] = useState<DesignResult | null>(null);
  const [needsPlan, setNeedsPlan] = useState<EvidenceNeedPlan | null>(null);
  const [gather, setGather] = useState<GatherPacket | null>(null);
  const [answer, setAnswer] = useState<AnswerResult | null>(null);
  const [drilledFind, setDrilledFind] = useState<GatheredFind | null>(null);
  const [tip, setTip] = useState<{
    key: string;
    text: string;
    url?: string;
    x: number;
    y: number;
  } | null>(null);
  const [lens, setLens] = useState<{
    spanId: string;
    target: LensTarget;
  } | null>(null);
  const tipTimer = useRef<number | null>(null);
  const lensTimer = useRef<number | null>(null);

  const generationRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const criteria = design?.bouncer.admitted ? design.criteria : null;
  const heading = committed ? toHeading(committed) : "";
  const unitHint =
    draft.trim() && firstUnit(draft) !== draft.replace(/\s+/g, " ").trim()
      ? "1st only"
      : "";

  const inputScale = useMemo(() => {
    const n = draft.length;
    if (n < 80) return 1;
    if (n < 160) return 0.92;
    if (n < 280) return 0.82;
    if (n < 480) return 0.72;
    return 0.64;
  }, [draft]);

  const resizeInput = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.55))}px`;
  };

  useEffect(() => {
    if (committed == null) {
      resizeInput();
      inputRef.current?.focus();
    }
  }, [draft, committed, inputScale]);

  useEffect(() => {
    if (committed != null) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [committed]);

  const marked = useMemo(
    () => markupInHeading(heading, committed ?? "", criteria?.presuppositions),
    [heading, committed, criteria?.presuppositions],
  );

  const pertinentFinds = useMemo(() => {
    const finds = gather?.finds ?? [];
    return finds
      .filter((f) => f.salience === "high" || f.salience === "medium")
      .slice(0, 8);
  }, [gather]);

  const secondaryFinds = useMemo(() => {
    const ids = new Set(pertinentFinds.map((f) => f.id));
    return (gather?.finds ?? []).filter((f) => !ids.has(f.id)).slice(0, 8);
  }, [gather, pertinentFinds]);

  const allFinds = useMemo(
    () => [...pertinentFinds, ...secondaryFinds],
    [pertinentFinds, secondaryFinds],
  );

  const figures = useMemo(
    () =>
      extractFigures({
        // Center figures come from the answer only — evidence claims pollute
        // the middle with supporting stats that are not the query's quantity.
        primary: [answer?.answer?.headline, answer?.answer?.summary],
        secondary: [
          ...(answer?.answer?.assertions?.map(
            (a) =>
              `${a.statement} ${a.basis} ${(a.defeaters ?? []).map((d) => d.text).join(" ")}`,
          ) ?? []),
          ...(answer?.answer?.sections?.map(
            (s) => `${s.title} ${s.body} ${(s.items ?? []).join(" ")}`,
          ) ?? []),
        ],
      }),
    [answer],
  );

  const settlementNeeds = needsPlan?.settlement_checks?.slice(0, 6) ?? [];
  const defeaterNeeds = needsPlan?.defeater_hunts?.slice(0, 4) ?? [];
  const unmet = gather?.unmet_needs?.slice(0, 5) ?? [];
  const sections = answer?.answer?.sections?.slice(0, 5) ?? [];
  const defeaters = useMemo(() => {
    const rows: { text: string; salience: string }[] = [];
    for (const a of answer?.answer?.assertions ?? []) {
      for (const d of a.defeaters ?? []) {
        rows.push({ text: d.text, salience: d.salience });
      }
    }
    return rows.slice(0, 6);
  }, [answer]);

  const summaryText = answer?.answer?.summary?.trim() || "";
  const assertions = answer?.answer?.assertions ?? [];

  const summaryHot = useMemo(() => {
    if (!summaryText) return [] as { span: { id: string; start: number; end: number; text: string }; target: LensTarget }[];
    const targets = buildLensTargets({
      finds: allFinds,
      assertions,
      sections,
      checks: settlementNeeds,
      defeaterHunts: defeaterNeeds,
      risks: answer?.answer?.residual_uncertainty ?? [],
    });
    if (!targets.length) return [];
    const lexicon = buildLexicon(targets);
    const spans = annotateSummary(summaryText, lexicon, 10);
    return resolveSpans(spans, targets, assertions);
  }, [
    summaryText,
    allFinds,
    assertions,
    sections,
    settlementNeeds,
    defeaterNeeds,
    answer?.answer?.residual_uncertainty,
  ]);

  const showLens = (spanId: string, target: LensTarget) => {
    if (lensTimer.current) window.clearTimeout(lensTimer.current);
    setLens({ spanId, target });
  };

  const hideLens = (spanId?: string) => {
    lensTimer.current = window.setTimeout(() => {
      setLens((cur) => {
        if (!cur) return null;
        if (spanId && cur.spanId !== spanId) return cur;
        return null;
      });
    }, 100);
  };

  useEffect(() => {
    setLens(null);
  }, [summaryText]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrilledFind(null);
        setTip(null);
        setLens(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const resetFlow = () => {
    generationRef.current += 1;
    setRunning(false);
    setPhase("idle");
    setError(null);
    setDesign(null);
    setNeedsPlan(null);
    setGather(null);
    setAnswer(null);
    setDrilledFind(null);
    setTip(null);
    setLens(null);
  };

  const onEdit = () => {
    resetFlow();
    setCommitted(null);
    queueMicrotask(() => inputRef.current?.focus());
  };

  const onRun = async () => {
    const prompt = firstUnit(committed ?? draft);
    if (!prompt || running) return;

    const gen = ++generationRef.current;
    setCommitted(prompt);
    setDraft(prompt);
    setRunning(true);
    setPhase("design");
    setError(null);
    setDesign(null);
    setNeedsPlan(null);
    setGather(null);
    setAnswer(null);
    setDrilledFind(null);

    try {
      // Fast path: return ports before applicability audit so the UI can prime.
      const designed = await api.designCriteria(prompt, model || undefined, {
        audit: false,
      });
      if (generationRef.current !== gen) return;
      setDesign(designed);

      if (!designed.bouncer.admitted || !designed.criteria || designed.run_id == null) {
        setRunning(false);
        setPhase("idle");
        return;
      }

      let criteria = designed.criteria;
      const runModel = designed.model || model || undefined;

      setPhase("audit");
      try {
        const audited = await api.auditCriteria({
          prompt,
          criteria,
          model: runModel,
          run_id: designed.run_id,
        });
        if (generationRef.current !== gen) return;
        setDesign(audited);
        if (!audited.criteria) {
          setRunning(false);
          setPhase("idle");
          return;
        }
        criteria = audited.criteria;
      } catch (e) {
        if (generationRef.current !== gen) return;
        setError((e as Error).message);
        setRunning(false);
        setPhase("idle");
        return;
      }

      let plan: EvidenceNeedPlan | undefined;
      let packet: GatherPacket | undefined;

      setPhase("needs");
      try {
        const needs = await api.planEvidenceNeeds({
          prompt,
          criteria,
          model: runModel,
          run_id: designed.run_id,
        });
        if (generationRef.current !== gen) return;
        plan = needs.evidence_needs;
        setNeedsPlan(plan);
      } catch (e) {
        if (generationRef.current !== gen) return;
        setError((e as Error).message);
      }

      if (generationRef.current !== gen) return;

      if (plan) {
        setPhase("gather");
        try {
          const gathered = await api.gatherEvidence({
            prompt,
            criteria,
            evidence_needs: plan,
            model: runModel,
            run_id: designed.run_id,
          });
          if (generationRef.current !== gen) return;
          packet = gathered.gather;
          plan = gathered.evidence_needs;
          setGather(packet);
          setNeedsPlan(plan);
        } catch (e) {
          if (generationRef.current !== gen) return;
          setError((e as Error).message);
        }
      }

      if (generationRef.current !== gen) return;
      setPhase("answer");
      try {
        const answered = await api.answerCriteria({
          prompt,
          criteria,
          model: runModel,
          run_id: designed.run_id,
          evidence_needs: plan,
          gather: packet,
        });
        if (generationRef.current !== gen) return;
        setAnswer(answered);
        if (answered.gather) setGather(answered.gather);
        if (answered.evidence_needs) setNeedsPlan(answered.evidence_needs);
      } catch (e) {
        if (generationRef.current !== gen) return;
        setError((e as Error).message);
      }
    } catch (e) {
      if (generationRef.current !== gen) return;
      setError((e as Error).message);
    } finally {
      if (generationRef.current === gen) {
        setRunning(false);
        setPhase("idle");
      }
    }
  };

  const rejected =
    design && !design.bouncer.admitted ? design.bouncer : null;
  const modeShort = (criteria?.resolution_mode || "mechanism_inference").replace(
    /_/g,
    " ",
  );
  const phaseText = phaseLabel(phase, running);
  const verdictFull =
    answer?.answer?.headline ||
    answer?.answer?.assertions?.[0]?.statement ||
    "";
  const stageClass = [
    "nimble-stage",
    committed == null ? "is-blank" : "is-result",
    running ? "is-running" : "",
    phase !== "idle" ? `phase-${phase}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const showTip = (
    key: string,
    text: string,
    el: HTMLElement,
    max: number,
    url?: string,
  ) => {
    if (tipTimer.current) window.clearTimeout(tipTimer.current);
    const full = text.trim();
    const clipped = clipText(full, max, false);
    // Always tip when a URL is provided; otherwise only when truncated.
    if (!url && clipped === full) {
      setTip(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const width = 320;
    setTip({
      key,
      text: full,
      url: url?.trim() || undefined,
      x: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      y: Math.min(r.bottom + 8, window.innerHeight - 140),
    });
  };

  const hideTip = (key: string) => {
    tipTimer.current = window.setTimeout(() => {
      setTip((t) => (t?.key === key ? null : t));
    }, 80);
  };

  const soft = (key: string, full: string, max = 90, url?: string) => ({
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      showTip(key, full, e.currentTarget, max, url);
    },
    onMouseLeave: () => hideTip(key),
  });
  const trunc = (text: string, max: number) => clipText(text, max, false);
  const openText = criteria?.prompt_leaves_open?.trim() || "";

  // While waiting for an answer, pipeline folds fill empty center space.
  // Once the answer lands, periphery collapses again for drill-down.
  const stageSparse = !answer;
  const pipelineFoldsOpen = stageSparse && !!needsPlan;

  return (
    <div className="nimble-view">
      <div className={stageClass}>
        {running && (
          <div className="nimble-loading-bar" aria-hidden>
            <span
              className={`nimble-loading-seg${phase === "design" || phase === "audit" || phase === "needs" || phase === "gather" || phase === "answer" ? " on" : ""}`}
            />
            <span
              className={`nimble-loading-seg${phase === "audit" || phase === "needs" || phase === "gather" || phase === "answer" ? " on" : ""}`}
            />
            <span
              className={`nimble-loading-seg${phase === "needs" || phase === "gather" || phase === "answer" ? " on" : ""}`}
            />
            <span
              className={`nimble-loading-seg${phase === "gather" || phase === "answer" ? " on" : ""}`}
            />
            <span className={`nimble-loading-seg${phase === "answer" ? " on" : ""}`} />
          </div>
        )}

        {committed != null && (
          <aside
            className={`nimble-rail nimble-rail-left${
              criteria || needsPlan || answer ? " in" : ""
            }`}
          >
            <div className="nimble-rail-scroll">
              {criteria?.required_ports?.length ? (
                <details className="nimble-fold">
                  <summary className="nimble-fold-sum">
                    <span className="nimble-fold-glyph" aria-hidden>
                      ⌗
                    </span>
                    <span className="nimble-fold-k">ports</span>
                    <span className="nimble-fold-n">
                      {criteria.required_ports.length}
                    </span>
                  </summary>
                  <div className="nimble-port-wrap">
                    {criteria.required_ports.map((p) => (
                      <span key={p} className="nimble-port-pill" title={p}>
                        {p.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </details>
              ) : null}

              {openText && (
                <details
                  className="nimble-open-fold"
                  key={`open-${design?.run_id ?? "x"}`}
                  open
                >
                  <summary className="nimble-open-sum">
                    <span className="nimble-open-glyph" aria-hidden>
                      ○
                    </span>
                    <span className="nimble-open-k">open</span>
                  </summary>
                  <div className="nimble-open-body">{openText}</div>
                </details>
              )}

              {settlementNeeds.length > 0 && (
                <details
                  className="nimble-fold"
                  key={`checks-${pipelineFoldsOpen ? "fill" : "side"}`}
                  {...(pipelineFoldsOpen ? { open: true } : {})}
                >
                  <summary className="nimble-fold-sum">
                    <span className="nimble-fold-glyph" aria-hidden>
                      ▢
                    </span>
                    <span className="nimble-fold-k">checks</span>
                    <span className="nimble-fold-n">{settlementNeeds.length}</span>
                  </summary>
                  <ul className="nimble-fold-list">
                    {settlementNeeds.map((n, i) => {
                      const key = `settle-${i}`;
                      return (
                        <li key={key} {...soft(key, n.statement, 56)}>
                          {trunc(n.statement, 56)}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}

              {defeaterNeeds.length > 0 && (
                <details
                  className="nimble-fold"
                  key={`hunts-${pipelineFoldsOpen ? "fill" : "side"}`}
                  {...(pipelineFoldsOpen ? { open: true } : {})}
                >
                  <summary className="nimble-fold-sum">
                    <span className="nimble-fold-glyph warn" aria-hidden>
                      ▿
                    </span>
                    <span className="nimble-fold-k">defeaters</span>
                    <span className="nimble-fold-n">{defeaterNeeds.length}</span>
                  </summary>
                  <ul className="nimble-fold-list">
                    {defeaterNeeds.map((n, i) => {
                      const key = `hunt-${i}`;
                      return (
                        <li key={key} {...soft(key, n.statement, 56)}>
                          {trunc(n.statement, 56)}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}

              {(answer?.answer?.residual_uncertainty?.length ?? 0) > 0 && (
                <details className="nimble-fold">
                  <summary className="nimble-fold-sum">
                    <span className="nimble-fold-glyph warn" aria-hidden>
                      △
                    </span>
                    <span className="nimble-fold-k">risks</span>
                    <span className="nimble-fold-n">
                      {answer!.answer.residual_uncertainty.length}
                    </span>
                  </summary>
                  <ul className="nimble-fold-list">
                    {answer!.answer.residual_uncertainty.map((u, i) => {
                      const key = `risk-${i}`;
                      return (
                        <li key={key} {...soft(key, u, 64)}>
                          {trunc(u, 64)}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}

              {defeaters.length > 0 && (
                <details className="nimble-fold">
                  <summary className="nimble-fold-sum">
                    <span className="nimble-fold-glyph danger" aria-hidden>
                      ✕
                    </span>
                    <span className="nimble-fold-k">defeaters</span>
                    <span className="nimble-fold-n">{defeaters.length}</span>
                  </summary>
                  <ul className="nimble-fold-list">
                    {defeaters.map((d, i) => {
                      const key = `def-${i}`;
                      return (
                        <li key={key} {...soft(key, d.text, 56)}>
                          <span className="nimble-salience">{d.salience}</span>{" "}
                          {trunc(d.text, 52)}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}

              {unmet.length > 0 && (
                <details className="nimble-fold">
                  <summary className="nimble-fold-sum">
                    <span className="nimble-fold-glyph" aria-hidden>
                      ∅
                    </span>
                    <span className="nimble-fold-k">unmet</span>
                    <span className="nimble-fold-n">{unmet.length}</span>
                  </summary>
                  <ul className="nimble-fold-list">
                    {unmet.map((u, i) => {
                      const key = `unmet-${i}`;
                      return (
                        <li key={key} {...soft(key, u, 56)}>
                          {trunc(u, 56)}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}

              {needsPlan && !answer && running && (
                <div
                  className="nimble-italic nimble-rail-wait"
                  {...soft("needs-note", needsPlan.note, 100)}
                >
                  {trunc(needsPlan.note, 80)}
                </div>
              )}
            </div>
          </aside>
        )}

        <div className={`nimble-prompt-block${committed == null ? " is-editing" : ""}`}>
          {committed == null ? (
            <>
              <textarea
                ref={inputRef}
                className="nimble-prompt-input"
                value={draft}
                rows={1}
                spellCheck
                onChange={(e) => setDraft(e.target.value)}
                placeholder=""
                aria-label="Question or claim"
                autoComplete="off"
                autoFocus
                style={{
                  fontSize: `calc(clamp(18px, 2.6vw, 28px) * ${inputScale})`,
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void onRun();
                  }
                }}
              />
              {unitHint && <p className="nimble-unit-hint">{unitHint}</p>}
            </>
          ) : (
            <>
              <div className={`nimble-above${criteria || phaseText ? " in" : ""}`}>
                {(criteria || phaseText) && (
                  <div className="nimble-above-meta">
                    {criteria && (
                      <span className="nimble-above-tag">{modeShort}</span>
                    )}
                    {criteria?.inquiry_type && (
                      <span className="nimble-above-tag">
                        {criteria.inquiry_type.replace(/_/g, " ")}
                      </span>
                    )}
                    {phaseText && (
                      <span className="nimble-above-tag nimble-phase-tag">
                        {phaseText}
                      </span>
                    )}
                  </div>
                )}
                {criteria?.answerhood?.direct_answer && (
                  <p className="nimble-above-char nimble-italic">
                    {criteria.answerhood.direct_answer}
                  </p>
                )}
              </div>

              <h1
                className="nimble-heading"
                dangerouslySetInnerHTML={{
                  __html: marked.html || escapeHtml(heading),
                }}
              />

              {figures.length > 0 && (
                <div
                  className="nimble-figures"
                  key={`fig-${design?.run_id ?? 0}`}
                >
                  {figures.map((f, i) => (
                    <div
                      key={`${f.label}-${f.value}-${i}`}
                      className={`nimble-figure ${f.role === "primary" ? "is-primary" : "is-sat"}`}
                      {...soft(
                        `fig-${f.label}-${f.value}-${i}`,
                        f.tip || `${f.value} · ${f.label}`,
                        12,
                      )}
                    >
                      <div className="nimble-figure-value">{f.value}</div>
                      <div className="nimble-figure-label">{f.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {verdictFull && (
                <p className="nimble-verdict">{verdictFull}</p>
              )}

              {summaryText && summaryText !== verdictFull.trim() && (
                <>
                  <p className="nimble-summary nimble-italic">
                    {summaryHot.length === 0
                      ? summaryText
                      : renderHotSummary(summaryText, summaryHot, {
                          activeId: lens?.spanId ?? null,
                          onEnter: (spanId, target) => showLens(spanId, target),
                          onLeave: (spanId) => hideLens(spanId),
                        })}
                  </p>
                  {lens && (
                    <div
                      className="nimble-lens"
                      onMouseEnter={() => {
                        if (lensTimer.current) {
                          window.clearTimeout(lensTimer.current);
                        }
                      }}
                      onMouseLeave={() => hideLens()}
                    >
                      <div className="nimble-lens-k">{lens.target.label}</div>
                      <div className="nimble-lens-body">{lens.target.body}</div>
                      {lens.target.url && (
                        <a
                          className="nimble-lens-link"
                          href={lens.target.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {lens.target.url}
                        </a>
                      )}
                    </div>
                  )}
                </>
              )}

              {!verdictFull &&
                !summaryText &&
                answer?.answer?.assertions?.[0]?.statement && (
                  <p className="nimble-verdict">
                    {answer.answer.assertions[0].statement}
                  </p>
                )}

              {(answer?.answer?.working_query_schema?.trim() ||
                (answer?.answer?.assertions?.length ?? 0) > 0 ||
                sections.length > 0) && (
                <details className="nimble-fold nimble-fold-center">
                  <summary className="nimble-fold-sum">
                    <span className="nimble-fold-k">detail</span>
                    <span className="nimble-fold-n">
                      {(answer?.answer?.assertions?.length ?? 0) +
                        sections.length +
                        (answer?.answer?.working_query_schema?.trim() ? 1 : 0)}
                    </span>
                  </summary>
                  <div className="nimble-fold-body">
                    {answer?.answer?.working_query_schema?.trim() && (
                      <p
                        className="nimble-schema"
                        {...soft(
                          "schema",
                          answer.answer.working_query_schema.trim(),
                          120,
                        )}
                      >
                        {answer.answer.working_query_schema.trim()}
                      </p>
                    )}
                    {(answer?.answer?.assertions?.length ?? 0) > 0 && (
                      <ul className="nimble-fold-list">
                        {answer!.answer.assertions.map((a, i) => {
                          const key = `assert-${i}`;
                          const full = a.basis
                            ? `${a.statement} — ${a.basis}`
                            : a.statement;
                          return (
                            <li key={key} {...soft(key, full, 160)}>
                              {a.statement}
                              {a.basis && (
                                <div className="nimble-italic nimble-assert-basis">
                                  {a.basis}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {sections.map((s, i) => {
                      const key = `sec-${i}`;
                      const full = [s.title || s.port, s.body, ...(s.items ?? [])]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <div
                          key={key}
                          className="nimble-section-block"
                          {...soft(key, full, 200)}
                        >
                          <div className="nimble-section-title">
                            {s.title || s.port}
                          </div>
                          {(s.body || "").trim() && (
                            <div className="nimble-section-body">{s.body}</div>
                          )}
                          {(s.items?.length ?? 0) > 0 && (
                            <ul className="nimble-fold-list">
                              {s.items.map((it, j) => (
                                <li key={j}>{it}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </>
          )}

          {rejected && (
            <p className="nimble-reject">
              Not admitted ({rejected.label}): {rejected.message}
            </p>
          )}

          {error && <p className="nimble-error">{error}</p>}
        </div>

        {committed != null && (
          <aside
            className={`nimble-rail nimble-rail-right${
              gather || running ? " in" : ""
            }`}
          >
            <div className="nimble-rail-scroll">
              <details className="nimble-fold">
                <summary className="nimble-fold-sum">
                  <span className="nimble-fold-glyph" aria-hidden>
                    «
                  </span>
                  <span className="nimble-fold-k">claims</span>
                  <span className="nimble-fold-n">{allFinds.length || "·"}</span>
                </summary>
                <div className="nimble-claim-list">
                  {allFinds.map((f) => {
                    const key = `find-${f.id}`;
                    const tipBody = [
                      f.claim,
                      f.source_title ? `Source: ${f.source_title}` : "",
                      f.source_publisher || "",
                      f.published_at || "",
                    ]
                      .filter(Boolean)
                      .join("\n");
                    return (
                      <button
                        key={f.id}
                        type="button"
                        className="nimble-claim-row"
                        onClick={() => {
                          if (f.source_url) {
                            window.open(f.source_url, "_blank", "noreferrer");
                          } else {
                            setDrilledFind(f);
                          }
                        }}
                        onMouseEnter={(e) =>
                          showTip(key, tipBody, e.currentTarget, 64, f.source_url)
                        }
                        onMouseLeave={() => hideTip(key)}
                      >
                        {trunc(f.claim || f.source_title || f.id, 88)}
                      </button>
                    );
                  })}
                  {!allFinds.length && running && (
                    <div className="nimble-italic nimble-rail-wait">
                      {phase === "gather" ? "gathering…" : "waiting…"}
                    </div>
                  )}
                  {!allFinds.length && !running && gather && (
                    <div className="nimble-italic nimble-rail-wait">
                      {gather.note || gather.retrieval_status}
                    </div>
                  )}
                </div>
              </details>
            </div>
          </aside>
        )}
      </div>

      {tip && (
        <div
          className="nimble-tip"
          style={{ left: tip.x, top: tip.y }}
          onMouseEnter={() => {
            if (tipTimer.current) window.clearTimeout(tipTimer.current);
          }}
          onMouseLeave={() => hideTip(tip.key)}
        >
          <div className="nimble-tip-text">{tip.text}</div>
          {tip.url && (
            <a
              className="nimble-tip-link"
              href={tip.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              {tip.url}
            </a>
          )}
        </div>
      )}
      {drilledFind && (
        <div className="nimble-source-strip">
          <div className="nimble-source-top">
            <span className="nimble-source-label">source</span>
            <button
              type="button"
              className="nimble-btn-ghost"
              onClick={() => setDrilledFind(null)}
              title="Back"
              aria-label="Back"
            >
              ←
            </button>
          </div>
          <div className="nimble-source-title">
            {drilledFind.source_title || drilledFind.id}
          </div>
          <p className="nimble-source-claim nimble-italic">{drilledFind.claim}</p>
          <div className="nimble-source-meta">
            <span className="mono">{drilledFind.id}</span>
            {drilledFind.source_url ? (
              <a href={drilledFind.source_url} target="_blank" rel="noreferrer">
                {drilledFind.source_url}
              </a>
            ) : (
              <span>no url</span>
            )}
            {drilledFind.published_at && (
              <span className="nimble-italic">{drilledFind.published_at}</span>
            )}
            {drilledFind.source_publisher && (
              <span>{drilledFind.source_publisher}</span>
            )}
            {drilledFind.quoted_or_paraphrase && (
              <span className="nimble-italic">{drilledFind.quoted_or_paraphrase}</span>
            )}
          </div>
        </div>
      )}

      <div className="nimble-dock">
        <span className="nimble-dock-hint">Enter run · Shift+Enter line</span>
        <div className="nimble-dock-actions">
          {committed != null && (
            <button
              type="button"
              className="nimble-btn-ghost"
              onClick={onEdit}
              disabled={running}
              title="New"
              aria-label="New"
            >
              +
            </button>
          )}
          <button
            type="button"
            className="nimble-btn"
            onClick={() => void onRun()}
            disabled={running || !firstUnit(committed ?? draft)}
            title="Run"
            aria-label="Run"
          >
            {running ? "…" : "→"}
          </button>
        </div>
      </div>
    </div>
  );
}

function trimLabel(s: string, n: number): string {
  return clipText(s, n, false);
}

type Figure = {
  value: string;
  label: string;
  kind: string;
  role: "primary" | "satellite";
  tip: string;
  weight: number;
};

type FigureCand = Omit<Figure, "role">;

/** Identity for collapse: same magnitude = one center tile. */
function valueKey(value: string, kind: string): string {
  const v = value
    .toLowerCase()
    .replace(/%/g, "")
    .replace(/percent/g, "")
    .replace(/\s+/g, "")
    .replace(/–/g, "-");
  return `${kind}:${v}`;
}

function labelScore(label: string): number {
  const t = label.trim();
  if (!t) return 0;
  if (/^(chance|range|percent|record|wins|place|division|alt\b)/i.test(t)) {
    return 1;
  }
  let score = Math.min(t.length, 36);
  if (/\b(20\d{2})\b/.test(t)) score += 4;
  if (/\b(vote|odds|share|poll|record|leader|chance|risk|ruin)\b/i.test(t)) {
    score += 3;
  }
  return score;
}

/** Pull a short distinctive label from text around a numeric match. */
function labelNear(
  before: string,
  after: string,
  fallback: string,
): string {
  const b = before.replace(/\s+/g, " ").trim();
  const a = after.replace(/\s+/g, " ").trim();
  const ofThat =
    b.match(
      /(?:chance|probability|odds|likelihood|rate|share|margin|vote)\s+(?:of|that|for|as)?\s*(.{3,42})$/i,
    ) ||
    a.match(
      /^(?:chance|probability|odds|likelihood)\s+(?:of|that|for)\s+(.{3,42})/i,
    );
  if (ofThat?.[1]) {
    return trimLabel(ofThat[1].replace(/[,.;:].*$/, "").trim(), 28);
  }
  const byYear = `${b} ${a}`.match(
    /\bby\s+(20\d{2})\b|\b(20\d{2})\s*[-–]\s*(20\d{2})\b/i,
  );
  const topic = b
    .split(/[,.;:—]/)
    .pop()
    ?.trim()
    .split(/\s+/)
    .filter(
      (w) =>
        !/^(a|an|the|of|to|in|on|at|vs|is|are|and|or|with|under|about|was|were|has|had|been)$/i.test(
          w,
        ),
    )
    .slice(-3)
    .join(" ");
  if (topic && topic.length >= 3) {
    const yearBit = byYear
      ? byYear[1] || `${byYear[2]}–${byYear[3]}`
      : "";
    return trimLabel(
      yearBit && !topic.includes(yearBit) ? `${topic} ${yearBit}` : topic,
      28,
    );
  }
  if (byYear) return byYear[1] || `${byYear[2]}–${byYear[3]}`;
  return fallback;
}

function collectFromText(text: string, weightBoost: number): FigureCand[] {
  const out: FigureCand[] = [];
  const seen = new Set<string>();
  const add = (
    value: string,
    label: string,
    kind: string,
    tip: string,
    weight: number,
  ) => {
    const key = `${valueKey(value, kind)}::${label.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ value, label, kind, tip, weight: weight + weightBoost });
  };

  for (const m of text.matchAll(
    /(.{0,48}?)(\d{1,3}(?:\.\d+)?)\s*[-–]\s*(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)\b(.{0,36})/gi,
  )) {
    const label = labelNear(m[1], m[4], "range");
    const value = `${m[2]}–${m[3]}%`;
    add(value, label, "chance", `${value} · ${label}`, 3);
  }

  for (const m of text.matchAll(
    /(.{0,48}?)(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)\b(.{0,36})/gi,
  )) {
    const value = `${m[2]}%`;
    if (
      out.some(
        (f) =>
          f.kind === "chance" &&
          f.value.includes("–") &&
          f.value.includes(m[2]),
      )
    ) {
      continue;
    }
    const label = labelNear(m[1], m[3], "chance");
    add(value, label, "chance", `${value} · ${label}`, 2);
  }

  const sportsContext =
    /\b(win-loss|won-lost|box[- ]?score|\brecord of\b|\brecord:\s*\d|\b\d{1,3}\s*[-–]\s*\d{1,3}\s+(?:record|wins?)|\b(MLB|NBA|NFL|NHL)\b|\b(playoffs?|standings?|innings?)\b)/i.test(
      text,
    );

  if (sportsContext) {
    for (const m of text.matchAll(
      /(.{0,36}?)(?:record(?:\s+of)?\s+|went\s+)?(\d{1,3})\s*[-–]\s*(\d{1,3})\b(?!\s*(?:%|percent))(.{0,24})/gi,
    )) {
      const a = Number(m[2]);
      const b = Number(m[3]);
      if (a > 162 || b > 162) continue;
      if (a + b < 5) continue;
      if (out.some((f) => f.value === `${m[2]}–${m[3]}%`)) continue;
      const value = `${m[2]}–${m[3]}`;
      const label = labelNear(m[1], m[4], "record");
      add(
        value,
        label === "chance" ? "record" : label,
        "record",
        `${value} record`,
        4,
      );
    }
    for (const m of text.matchAll(/(\d{1,3}(?:\.\d+)?)\s+wins?\b/gi)) {
      add(m[1], "wins", "wins", `${m[1]} wins`, 2);
    }
    for (const m of text.matchAll(
      /\b((?:1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth)\s+place)\b/gi,
    )) {
      const label = m[1]
        .toLowerCase()
        .replace("first", "1st")
        .replace("second", "2nd")
        .replace("third", "3rd")
        .replace("fourth", "4th")
        .replace("fifth", "5th");
      add(label.replace(/\s+place$/i, ""), "place", "place", label, 2);
    }
    for (const m of text.matchAll(/\b(AL|NL)\s+East\b/g)) {
      add(m[0], "division", "division", m[0], 2);
    }
  }

  return out;
}

/**
 * Center figures: answer-only, one tile per distinct magnitude.
 * Satellites only when values (or kinds) actually differ — never the same
 * number restated with alternate phrase scraps.
 */
function extractFigures(parts: {
  primary?: (string | undefined | null)[];
  secondary?: (string | undefined | null)[];
}): Figure[] {
  const primaryText = (parts.primary ?? []).filter(Boolean).join("\n");
  const secondaryText = (parts.secondary ?? []).filter(Boolean).join("\n");
  const raw = [
    ...collectFromText(primaryText, 12),
    ...collectFromText(secondaryText, 0),
  ];
  if (!raw.length) return [];

  // Collapse identical magnitudes; accumulate alternate labels into tip.
  type Bucket = { fig: FigureCand; labels: string[] };
  const byValue = new Map<string, Bucket>();
  for (const f of raw) {
    const key = valueKey(f.value, f.kind);
    const cur = byValue.get(key);
    if (!cur) {
      byValue.set(key, { fig: f, labels: [f.label] });
      continue;
    }
    if (
      !cur.labels.some((l) => l.toLowerCase() === f.label.toLowerCase())
    ) {
      cur.labels.push(f.label);
    }
    const better =
      f.weight > cur.fig.weight ||
      (f.weight === cur.fig.weight &&
        labelScore(f.label) > labelScore(cur.fig.label));
    if (better) cur.fig = f;
  }

  const collapsed: FigureCand[] = [...byValue.values()].map(({ fig, labels }) => {
    const alts = labels
      .filter((l) => l.toLowerCase() !== fig.label.toLowerCase())
      .filter((l) => labelScore(l) > 1);
    const tipParts = [`${fig.value} · ${fig.label}`, ...alts.slice(0, 3)];
    return {
      ...fig,
      tip: tipParts.join("\n"),
      weight: fig.weight + Math.min(alts.length, 2),
    };
  });

  // Drop point estimates already covered by a range of the same kind
  const filtered = collapsed.filter((f) => {
    if (f.kind !== "chance" || f.value.includes("–")) return true;
    const n = Number(f.value.replace("%", ""));
    if (!Number.isFinite(n)) return true;
    return !collapsed.some((o) => {
      if (o === f || o.kind !== "chance" || !o.value.includes("–")) {
        return false;
      }
      const m = o.value.match(/(\d+(?:\.\d+)?)[-–](\d+(?:\.\d+)?)%?/);
      if (!m) return false;
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      return n >= lo && n <= hi;
    });
  });

  filtered.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return labelScore(b.label) - labelScore(a.label);
  });

  const hasHeadFigure = filtered.some((f) => f.weight >= 12);
  const picked: Figure[] = [];
  for (const f of filtered) {
    if (picked.length >= 3) break;
    if (!hasHeadFigure && f.weight < 2 && picked.length >= 1) break;
    if (
      picked.some((p) => p.kind === f.kind) &&
      f.weight < 12 &&
      picked[0].weight >= 12
    ) {
      continue;
    }
    picked.push({
      ...f,
      role: picked.length === 0 ? "primary" : "satellite",
    });
  }

  // Secondary-only diversions: keep strongest single figure when headline
  // has no quantity, so supporting stats do not dominate the center.
  if (!hasHeadFigure && picked.length > 1) {
    return [{ ...picked[0], role: "primary" }];
  }

  if (picked.length) picked[0] = { ...picked[0], role: "primary" };
  return picked;
}

