import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import {
  PORT_CATALOGUE,
  type AnswerResult,
  type CriteriaObject,
  type DesignResult,
  type EvidenceNeedPlan,
  type GatheredFind,
  type GatherPacket,
  type PortId,
  type Presupposition,
} from "./types";

type FlowPhase = "idle" | "design" | "needs" | "gather" | "answer";
type ExpandKey = string | null;

type Adornment = {
  id: string;
  label: string;
  kind: "mode" | "port" | "find" | "phase" | "answer" | "needs" | "meta";
  blurb: string;
  find?: GatheredFind;
};

function phaseLabel(phase: FlowPhase, running: boolean): string {
  if (!running && phase === "idle") return "";
  if (phase === "design") return "designing criteria…";
  if (phase === "needs") return "planning evidence needs…";
  if (phase === "gather") return "gathering finds…";
  if (phase === "answer") return "drafting answer…";
  return "";
}

function markupPrompt(
  prompt: string,
  presuppositions: Presupposition[] | undefined,
): { html: string; hits: number } {
  if (!prompt) return { html: "", hits: 0 };
  const marks = (presuppositions ?? []).filter(
    (p) =>
      (p.status === "contested" || p.status === "challengeable") &&
      p.text.trim().length >= 3,
  );
  if (!marks.length) {
    return { html: escapeHtml(prompt), hits: 0 };
  }

  type Hit = { start: number; end: number; status: string };
  const hits: Hit[] = [];
  const lower = prompt.toLowerCase();
  for (const m of marks) {
    const needle = m.text.trim().toLowerCase();
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(needle, from);
      if (at < 0) break;
      hits.push({ start: at, end: at + needle.length, status: m.status });
      from = at + needle.length;
    }
  }
  if (!hits.length) return { html: escapeHtml(prompt), hits: 0 };

  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Hit[] = [];
  for (const h of hits) {
    const last = merged[merged.length - 1];
    if (last && h.start < last.end) continue;
    merged.push(h);
  }

  let out = "";
  let cursor = 0;
  for (const h of merged) {
    out += escapeHtml(prompt.slice(cursor, h.start));
    const cls =
      h.status === "contested"
        ? "nimble-mark nimble-mark-contested"
        : "nimble-mark nimble-mark-challengeable";
    out += `<mark class="${cls}" title="${escapeAttr(h.status)}">${escapeHtml(
      prompt.slice(h.start, h.end),
    )}</mark>`;
    cursor = h.end;
  }
  out += escapeHtml(prompt.slice(cursor));
  return { html: out, hits: merged.length };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function buildAdornments(
  criteria: CriteriaObject | null | undefined,
  needs: EvidenceNeedPlan | null,
  gather: GatherPacket | null,
  answer: AnswerResult | null,
  phase: FlowPhase,
  running: boolean,
): Adornment[] {
  const items: Adornment[] = [];
  const pl = phaseLabel(phase, running);
  if (pl) {
    items.push({
      id: "phase",
      label: pl,
      kind: "phase",
      blurb: "Forward pipeline from criteria hub.",
    });
  }
  if (!criteria) return items;

  const mode = criteria.resolution_mode || "mechanism_inference";
  items.push({
    id: "mode",
    label: mode.replace(/_/g, " "),
    kind: "mode",
    blurb:
      mode === "discourse_map"
        ? "Success is mapping positions and speakers."
        : mode === "mixed"
          ? "Keep mechanism claims separate from discourse claims."
          : "Settle via observables and hypothesis support or ruling-out.",
  });

  items.push({
    id: "inquiry",
    label: criteria.inquiry_type.replace(/_/g, " "),
    kind: "meta",
    blurb: criteria.answerhood?.direct_answer || "Excavated inquiry type.",
  });

  for (const id of criteria.required_ports.slice(0, 6)) {
    const port = PORT_CATALOGUE[id as PortId];
    items.push({
      id: `port-${id}`,
      label: port?.label ?? id,
      kind: "port",
      blurb: port?.shortCriterion ?? id,
    });
  }

  if (needs) {
    const n =
      (needs.settlement_checks?.length ?? 0) +
      (needs.defeater_hunts?.length ?? 0);
    items.push({
      id: "needs",
      label: `${n} need(s)`,
      kind: "needs",
      blurb: needs.note || `Retrieval: ${needs.retrieval_status}`,
    });
  }

  if (gather?.finds?.length) {
    for (const f of gather.finds.slice(0, 5)) {
      items.push({
        id: `find-${f.id}`,
        label: f.source_title || f.id,
        kind: "find",
        blurb: f.claim,
        find: f,
      });
    }
  }

  if (answer?.answer?.headline) {
    items.push({
      id: "headline",
      label: trimLabel(answer.answer.headline, 42),
      kind: "answer",
      blurb: answer.answer.summary || answer.answer.headline,
    });
  }

  return items;
}

function trimLabel(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
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

  const [expanded, setExpanded] = useState<ExpandKey>(null);
  const [drilledFind, setDrilledFind] = useState<GatheredFind | null>(null);
  const [vizOpen, setVizOpen] = useState(true);

  const generationRef = useRef(0);
  const expandTimer = useRef<number | null>(null);
  const vizLeaveTimer = useRef<number | null>(null);

  const criteria = design?.bouncer.admitted ? design.criteria : null;
  const adornments = useMemo(
    () => buildAdornments(criteria, needsPlan, gather, answer, phase, running),
    [criteria, needsPlan, gather, answer, phase, running],
  );

  const marked = useMemo(
    () => markupPrompt(committed ?? "", criteria?.presuppositions),
    [committed, criteria?.presuppositions],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrilledFind(null);
        setExpanded(null);
        setVizOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const clearExpandSoon = () => {
    if (expandTimer.current) window.clearTimeout(expandTimer.current);
    expandTimer.current = window.setTimeout(() => setExpanded(null), 160);
  };

  const holdExpand = (id: string) => {
    if (expandTimer.current) window.clearTimeout(expandTimer.current);
    setExpanded(id);
  };

  const resetFlow = () => {
    generationRef.current += 1;
    setRunning(false);
    setPhase("idle");
    setError(null);
    setDesign(null);
    setNeedsPlan(null);
    setGather(null);
    setAnswer(null);
    setExpanded(null);
    setDrilledFind(null);
    setVizOpen(true);
  };

  const onEdit = () => {
    resetFlow();
    setCommitted(null);
  };

  const onRun = async () => {
    const prompt = (committed ?? draft).trim();
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
    setVizOpen(true);

    try {
      const designed = await api.designCriteria(prompt, model || undefined);
      if (generationRef.current !== gen) return;
      setDesign(designed);

      if (!designed.bouncer.admitted || !designed.criteria || designed.run_id == null) {
        setRunning(false);
        setPhase("idle");
        return;
      }

      const runModel = designed.model || model || undefined;
      let plan: EvidenceNeedPlan | undefined;
      let packet: GatherPacket | undefined;

      setPhase("needs");
      try {
        const needs = await api.planEvidenceNeeds({
          prompt,
          criteria: designed.criteria,
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
            criteria: designed.criteria,
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
          criteria: designed.criteria,
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

  const expandedItem = adornments.find((a) => a.id === expanded) ?? null;
  const rejected =
    design && !design.bouncer.admitted ? design.bouncer : null;

  return (
    <div className="nimble-view">
      <div className="nimble-stage">
        <div className="nimble-frame-ring" aria-hidden />

        <div className="nimble-orbit nimble-orbit-top">
          {adornments
            .filter((a) => a.kind === "mode" || a.kind === "phase" || a.kind === "meta")
            .map((a) => (
              <AdornChip
                key={a.id}
                item={a}
                active={expanded === a.id}
                onEnter={() => holdExpand(a.id)}
                onLeave={clearExpandSoon}
                onClick={() => {
                  if (a.find) setDrilledFind(a.find);
                  holdExpand(a.id);
                }}
              />
            ))}
        </div>

        <div className="nimble-orbit nimble-orbit-left">
          {adornments
            .filter((a) => a.kind === "port" || a.kind === "needs")
            .map((a) => (
              <AdornChip
                key={a.id}
                item={a}
                active={expanded === a.id}
                onEnter={() => holdExpand(a.id)}
                onLeave={clearExpandSoon}
                onClick={() => holdExpand(a.id)}
              />
            ))}
        </div>

        <div className="nimble-orbit nimble-orbit-right">
          {adornments
            .filter((a) => a.kind === "find" || a.kind === "answer")
            .map((a) => (
              <AdornChip
                key={a.id}
                item={a}
                active={expanded === a.id}
                onEnter={() => holdExpand(a.id)}
                onLeave={clearExpandSoon}
                onClick={() => {
                  if (a.find) setDrilledFind(a.find);
                  holdExpand(a.id);
                }}
              />
            ))}
        </div>

        <div className="nimble-prompt-block">
          {committed == null ? (
            <textarea
              className="nimble-prompt-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type the claim or question. Returns will frame this text."
              rows={4}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void onRun();
                }
              }}
            />
          ) : (
            <div
              className="nimble-prompt-display"
              dangerouslySetInnerHTML={{ __html: marked.html || escapeHtml(committed) }}
            />
          )}

          {marked.hits > 0 && (
            <p className="nimble-mark-legend">
              Markup on your words: contested / challengeable presuppositions
              ({marked.hits})
            </p>
          )}

          {rejected && (
            <p className="nimble-reject">
              Not admitted ({rejected.label}): {rejected.message}
            </p>
          )}

          {error && <p className="error nimble-error">{error}</p>}
        </div>

        {expandedItem && (
          <div
            className="nimble-expand"
            onMouseEnter={() => holdExpand(expandedItem.id)}
            onMouseLeave={clearExpandSoon}
          >
            <div className="nimble-expand-label">{expandedItem.label}</div>
            <p className="nimble-expand-body">{expandedItem.blurb}</p>
            {expandedItem.find && (
              <button
                type="button"
                className="secondary nimble-expand-drill"
                onClick={() => setDrilledFind(expandedItem.find!)}
              >
                Drill source
              </button>
            )}
          </div>
        )}

        {vizOpen && criteria && (
          <div
            className="nimble-viz"
            onMouseEnter={() => {
              if (vizLeaveTimer.current) window.clearTimeout(vizLeaveTimer.current);
            }}
            onMouseLeave={() => {
              if (vizLeaveTimer.current) window.clearTimeout(vizLeaveTimer.current);
              vizLeaveTimer.current = window.setTimeout(() => setVizOpen(false), 400);
            }}
          >
            <button
              type="button"
              className="nimble-viz-dismiss"
              aria-label="Dismiss visualization"
              onClick={() => setVizOpen(false)}
            >
              ×
            </button>
            <div className="nimble-viz-title">ports</div>
            <div className="nimble-viz-dots" title="Required ports surviving audit">
              {criteria.required_ports.map((id) => (
                <span key={id} className="nimble-viz-dot" title={id} />
              ))}
            </div>
            {answer?.answer?.assertions?.length ? (
              <div className="nimble-viz-assert">
                {answer.answer.assertions.slice(0, 4).map((a, i) => (
                  <span key={i} className="nimble-viz-bar" title={a.statement}>
                    {a.defeaters?.length ?? 0}d
                  </span>
                ))}
              </div>
            ) : null}
            <p className="nimble-viz-hint">Esc or × to dismiss</p>
          </div>
        )}

        {!vizOpen && criteria && (
          <button
            type="button"
            className="nimble-viz-restore"
            onClick={() => setVizOpen(true)}
          >
            viz
          </button>
        )}
      </div>

      {drilledFind && (
        <div className="nimble-source-strip">
          <div className="nimble-source-top">
            <span className="nimble-source-label">source</span>
            <button
              type="button"
              className="secondary"
              onClick={() => setDrilledFind(null)}
            >
              Back
            </button>
          </div>
          <div className="nimble-source-title">
            {drilledFind.source_title || drilledFind.id}
          </div>
          <p className="nimble-source-claim">{drilledFind.claim}</p>
          <div className="nimble-source-meta">
            <span className="mono">{drilledFind.id}</span>
            {drilledFind.source_url ? (
              <a href={drilledFind.source_url} target="_blank" rel="noreferrer">
                {drilledFind.source_url}
              </a>
            ) : (
              <span className="criteria-log-hint">no url</span>
            )}
          </div>
        </div>
      )}

      <div className="nimble-dock">
        <span className="nimble-dock-hint">
          User text stays primary. Returns frame it. ⌘/Ctrl+Enter to run.
        </span>
        <div className="nimble-dock-actions">
          {committed != null && (
            <button type="button" className="secondary" onClick={onEdit} disabled={running}>
              Edit prompt
            </button>
          )}
          <button
            type="button"
            onClick={() => void onRun()}
            disabled={running || !(committed ?? draft).trim()}
          >
            {running ? "Running…" : committed ? "Re-run" : "Run pipeline"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdornChip({
  item,
  active,
  onEnter,
  onLeave,
  onClick,
}: {
  item: Adornment;
  active: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`nimble-chip kind-${item.kind}${active ? " active" : ""}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      onClick={onClick}
    >
      {item.label}
    </button>
  );
}
