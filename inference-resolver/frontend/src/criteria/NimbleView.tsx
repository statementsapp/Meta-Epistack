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
  type PatchFocus,
  type PatchFocusKind,
  type PatchOp,
  type Presupposition,
} from "./types";
import { questionToHeading } from "./questionToHeading";
import {
  annotateSummary,
  buildLensTargets,
  buildLexicon,
  pickTarget,
  resolveSpans,
  type LensTarget,
} from "./summaryLens";
import { useSpeechDraft } from "./useSpeechDraft";

type FlowPhase = "idle" | "design" | "audit" | "needs" | "gather" | "answer";

type AtomFocus = PatchFocus & { label: string };

function MicIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
      <path d="M8 22h8" />
    </svg>
  );
}

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
    onEnter: (spanId: string, target: LensTarget, index: number) => void;
    onLeave: (spanId: string) => void;
    onClick: (spanId: string, target: LensTarget, index: number) => void;
  },
): ReactNode {
  if (!hot.length) return summary;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  hot.forEach(({ span, target }, index) => {
    if (span.start < cursor) return;
    if (span.start > cursor) {
      nodes.push(summary.slice(cursor, span.start));
    }
    const active = handlers.activeId === span.id;
    nodes.push(
      <mark
        key={span.id}
        className={`nimble-hot${active ? " is-active" : ""}`}
        tabIndex={0}
        onMouseEnter={() => handlers.onEnter(span.id, target, index)}
        onMouseLeave={() => handlers.onLeave(span.id)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handlers.onClick(span.id, target, index);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            handlers.onClick(span.id, target, index);
          }
        }}
      >
        {summary.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  });
  if (cursor < summary.length) nodes.push(summary.slice(cursor));
  return nodes;
}

/** Quiet schema stamp tokens — axes / horizon crumbs. */
function schemaStampTokens(schema: string): string[] {
  const cleaned = schema
    .replace(/^(working\s+)?(query\s+)?schema\s*:?\s*/i, "")
    .trim();
  if (!cleaned) return [];
  const parts = cleaned.split(/[;|·]/).flatMap((p) =>
    p
      .replace(/^(horizon|axes|time|scope)\s*:?\s*/i, "")
      .split(/,(?![^(]*\))/)
      .map((s) => s.trim()),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const t = p.replace(/\s+/g, " ").trim();
    if (t.length < 3 || t.length > 48) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= 6) break;
  }
  return out;
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

/** Prefer cutting on a word boundary so figure labels never end mid-word. */
function clipWords(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const sp = slice.lastIndexOf(" ");
  const cut = sp >= Math.floor(max * 0.55) ? slice.slice(0, sp) : slice;
  return `${cut.trimEnd()}…`;
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
    maxH?: number;
    placeAbove?: boolean;
  } | null>(null);
  const [lens, setLens] = useState<{
    spanId: string;
    target: LensTarget;
    pinned: boolean;
    index: number;
  } | null>(null);
  const [leftExpanded, setLeftExpanded] = useState(false);
  const [rightExpanded, setRightExpanded] = useState(false);
  const [leftHover, setLeftHover] = useState(false);
  const [rightHover, setRightHover] = useState(false);
  const [leftSession, setLeftSession] = useState(0);
  const [rightSession, setRightSession] = useState(0);
  const [costHover, setCostHover] = useState(false);
  const [runMeter, setRunMeter] = useState({
    tokens: 0,
    cost: 0,
    calls: 0,
    steps: [] as { phase: string; tokens: number; cost: number }[],
  });
  const [atomFocus, setAtomFocus] = useState<AtomFocus | null>(null);
  const [focusNote, setFocusNote] = useState("");
  const [patching, setPatching] = useState(false);
  const [patchFlash, setPatchFlash] = useState<string[]>([]);
  const [patchRibbon, setPatchRibbon] = useState<{
    line: string;
    stub: boolean;
    action: "critique" | "probe";
    ops: PatchOp[];
    revision: number;
  } | null>(null);
  const [revisionLog, setRevisionLog] = useState<
    {
      revision: number;
      action: "critique" | "probe";
      line: string;
      ops: PatchOp[];
      stub: boolean;
    }[]
  >([]);
  const tipTimer = useRef<number | null>(null);
  const lensTimer = useRef<number | null>(null);
  const leftRailTimer = useRef<number | null>(null);
  const rightRailTimer = useRef<number | null>(null);
  const costTimer = useRef<number | null>(null);
  const patchFlashTimer = useRef<number | null>(null);
  const focusNoteRef = useRef<HTMLInputElement>(null);
  const costWrapRef = useRef<HTMLDivElement>(null);
  const [costBox, setCostBox] = useState<{ top: number; right: number } | null>(
    null,
  );
  const [promptVoiceDraft, setPromptVoiceDraft] = useState(false);

  const generationRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const promptSpeech = useSpeechDraft({
    onDraft: (text) => {
      setPromptVoiceDraft(true);
      setDraft(text);
    },
    onFinal: () => {
      queueMicrotask(() => inputRef.current?.focus());
    },
  });

  const focusSpeech = useSpeechDraft({
    onDraft: (text) => {
      setFocusNote(text);
    },
    onFinal: () => {
      queueMicrotask(() => focusNoteRef.current?.focus());
    },
  });

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

  const summaryHotBundle = useMemo(() => {
    if (!summaryText) {
      return {
        hot: [] as {
          span: { id: string; start: number; end: number; text: string };
          target: LensTarget;
        }[],
        targets: [] as LensTarget[],
      };
    }
    const targets = buildLensTargets({
      finds: allFinds,
      assertions,
      sections,
      checks: settlementNeeds,
      defeaterHunts: defeaterNeeds,
      risks: answer?.answer?.residual_uncertainty ?? [],
    });
    if (!targets.length) return { hot: [], targets: [] };
    const modelSpans = (answer?.answer?.summary_spans ?? [])
      .map((s) => {
        const start = Number(s.start);
        const end = Number(s.end);
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start < 0 ||
          end > summaryText.length ||
          start >= end
        ) {
          return null;
        }
        return {
          id: s.id || `span-${start}-${end}`,
          start,
          end,
          text: s.text || summaryText.slice(start, end),
          targetIds: s.target_ids ?? [],
        };
      })
      .filter((s): s is NonNullable<typeof s> => !!s);
    const lexicon = buildLexicon(targets);
    const spans =
      modelSpans.length > 0
        ? modelSpans
        : annotateSummary(summaryText, lexicon, 10);
    return {
      hot: resolveSpans(spans, targets, assertions),
      targets,
    };
  }, [
    summaryText,
    allFinds,
    assertions,
    sections,
    settlementNeeds,
    defeaterNeeds,
    answer?.answer?.residual_uncertainty,
    answer?.answer?.summary_spans,
  ]);
  const summaryHot = summaryHotBundle.hot;
  const lensTargets = summaryHotBundle.targets;

  const schemaTokens = useMemo(
    () =>
      schemaStampTokens(answer?.answer?.working_query_schema?.trim() || ""),
    [answer?.answer?.working_query_schema],
  );

  const showLens = (
    spanId: string,
    target: LensTarget,
    index: number,
    pinned = false,
  ) => {
    if (lensTimer.current) window.clearTimeout(lensTimer.current);
    setLens((cur) => {
      if (cur?.pinned && !pinned) return cur;
      return { spanId, target, pinned, index };
    });
  };

  const pinLens = (spanId: string, target: LensTarget, index: number) => {
    if (lensTimer.current) window.clearTimeout(lensTimer.current);
    setLens({ spanId, target, pinned: true, index });
  };

  const hideLens = (spanId?: string) => {
    lensTimer.current = window.setTimeout(() => {
      setLens((cur) => {
        if (!cur || cur.pinned) return cur;
        if (spanId && cur.spanId !== spanId) return cur;
        return null;
      });
    }, 100);
  };

  const clearFocus = () => {
    if (lensTimer.current) window.clearTimeout(lensTimer.current);
    setLens(null);
  };

  const clearAtomFocus = () => {
    focusSpeech.discard();
    setAtomFocus(null);
    setFocusNote("");
    setPatching(false);
  };

  const togglePromptMic = () => {
    if (promptSpeech.listening) {
      promptSpeech.stop();
      return;
    }
    focusSpeech.discard();
    promptSpeech.start();
  };

  const toggleFocusMic = () => {
    if (focusSpeech.listening) {
      focusSpeech.stop();
      return;
    }
    promptSpeech.discard();
    focusSpeech.start();
  };

  const discardPromptDraft = () => {
    promptSpeech.discard();
    setDraft("");
    setPromptVoiceDraft(false);
    queueMicrotask(() => inputRef.current?.focus());
  };

  const enterAtomFocus = (next: AtomFocus) => {
    setAtomFocus(next);
    setTip(null);
    if (next.kind === "claim") setRightExpanded(true);
    if (
      next.kind === "check" ||
      next.kind === "defeater" ||
      next.kind === "risk"
    ) {
      setLeftExpanded(true);
    }
    queueMicrotask(() => focusNoteRef.current?.focus());
  };

  const atomLit = (id: string) => atomFocus?.id === id;
  const atomFlashed = (id: string) => patchFlash.includes(id);
  const atomClass = (...parts: (string | false | undefined)[]) =>
    parts.filter(Boolean).join(" ");

  const applyAtomPatch = async (action: "critique" | "probe") => {
    if (!atomFocus || !answer || !committed || patching) return;
    setPatching(true);
    setError(null);
    try {
      const result = await api.patchCriteria({
        prompt: committed,
        run_id: answer.run_id,
        model: model || undefined,
        action,
        note: focusNote,
        focus: {
          kind: atomFocus.kind,
          id: atomFocus.id,
          text: atomFocus.text,
        },
        answer: answer.answer,
        gather: gather ?? undefined,
        evidence_needs: needsPlan ?? undefined,
        criteria: criteria ?? undefined,
      });
      setAnswer((prev) =>
        prev
          ? {
              ...prev,
              answer: result.answer,
              gather: result.gather ?? prev.gather,
            }
          : prev,
      );
      if (result.gather) setGather(result.gather);
      const flash = new Set(
        result.ops.map((o) => o.target_id).filter(Boolean),
      );
      flash.add(atomFocus.id);
      if (patchFlashTimer.current) window.clearTimeout(patchFlashTimer.current);
      setPatchFlash([...flash]);
      patchFlashTimer.current = window.setTimeout(() => setPatchFlash([]), 2200);
      const ribbon = {
        line: result.summary_line || `${action} applied`,
        stub: result.stub,
        action: result.action,
        ops: result.ops.filter((o) => o.op !== "annotate"),
        revision: result.revision_index || revisionLog.length + 1,
      };
      setPatchRibbon(ribbon);
      setRevisionLog((prev) => [
        ...prev,
        {
          revision: ribbon.revision,
          action: ribbon.action,
          line: ribbon.line,
          ops: ribbon.ops,
          stub: ribbon.stub,
        },
      ]);
      setFocusNote("");
      clearAtomFocus();
      setRightExpanded(true);
      addMeter("patch", result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPatching(false);
    }
  };

  const addMeter = (
    phaseName: string,
    partial?: { total_tokens?: number; total_cost_usd?: number; calls?: { length: number }[] | unknown[] },
  ) => {
    const tokens = partial?.total_tokens ?? 0;
    const cost = partial?.total_cost_usd ?? 0;
    const calls = Array.isArray(partial?.calls) ? partial!.calls!.length : 0;
    if (!tokens && !cost && !calls) return;
    setRunMeter((m) => ({
      tokens: m.tokens + tokens,
      cost: m.cost + cost,
      calls: m.calls + calls,
      steps: [...m.steps, { phase: phaseName, tokens, cost }],
    }));
  };

  const openLeftRail = () => {
    if (leftRailTimer.current) window.clearTimeout(leftRailTimer.current);
    setLeftHover(true);
  };
  const scheduleCloseLeftRail = () => {
    if (leftRailTimer.current) window.clearTimeout(leftRailTimer.current);
    leftRailTimer.current = window.setTimeout(() => {
      setLeftHover(false);
      setLeftExpanded(false);
      // Remount folds closed on next open — don't resume half-expanded state.
      setLeftSession((s) => s + 1);
    }, 160);
  };
  const openRightRail = () => {
    if (rightRailTimer.current) window.clearTimeout(rightRailTimer.current);
    setRightHover(true);
  };
  const scheduleCloseRightRail = () => {
    if (rightRailTimer.current) window.clearTimeout(rightRailTimer.current);
    rightRailTimer.current = window.setTimeout(() => {
      setRightHover(false);
      setRightExpanded(false);
      setRightSession((s) => s + 1);
    }, 160);
  };
  const openCost = () => {
    if (costTimer.current) window.clearTimeout(costTimer.current);
    // Keep the left rail closed so $ does not fight the expanded menu.
    if (leftRailTimer.current) window.clearTimeout(leftRailTimer.current);
    setLeftHover(false);
    setLeftExpanded(false);
    const el = costWrapRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setCostBox({
        top: r.top,
        right: Math.max(8, window.innerWidth - r.left + 8),
      });
    }
    setCostHover(true);
  };
  const closeCost = () => {
    if (costTimer.current) window.clearTimeout(costTimer.current);
    setCostHover(false);
    setCostBox(null);
  };
  const toggleCost = () => {
    if (costHover) closeCost();
    else openCost();
  };

  const activateToken = (token: string, pin = false) => {
    const span = {
      id: `tok-${token.toLowerCase()}`,
      start: 0,
      end: token.length,
      text: token,
      targetIds: lensTargets.map((t) => t.id),
    };
    const target = pickTarget(span, lensTargets, assertions);
    if (!target) return;
    if (pin) pinLens(span.id, target, -1);
    else showLens(span.id, target, -1, false);
  };

  const focusKind = lens?.target.kind ?? null;
  const focusedClaimId =
    lens?.target.kind === "claim"
      ? lens.target.id.replace(/^claim:/, "")
      : null;

  useEffect(() => {
    setLens(null);
  }, [summaryText]);

  useEffect(() => {
    // After answer lands, collapse rails to glyphs.
    if (answer) {
      setLeftExpanded(false);
      setRightExpanded(false);
    }
  }, [answer?.run_id]);

  useEffect(() => {
    if (!lens?.pinned) return;
    if (lens.target.kind === "claim") setRightExpanded(true);
    if (
      lens.target.kind === "check" ||
      lens.target.kind === "defeater" ||
      lens.target.kind === "risk"
    ) {
      setLeftExpanded(true);
    }
  }, [lens?.spanId, lens?.target.kind, lens?.pinned]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (atomFocus) {
        clearAtomFocus();
        return;
      }
      if (promptSpeech.listening || (committed == null && promptVoiceDraft)) {
        discardPromptDraft();
        return;
      }
      if (costHover) {
        closeCost();
        return;
      }
      setDrilledFind(null);
      setTip(null);
      clearFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    atomFocus,
    costHover,
    promptSpeech.listening,
    committed,
    promptVoiceDraft,
  ]);

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
    clearAtomFocus();
    setPatchFlash([]);
    setPatchRibbon(null);
    setRevisionLog([]);
    setLeftExpanded(false);
    setRightExpanded(false);
    setLeftHover(false);
    setRightHover(false);
    setCostHover(false);
    setRunMeter({ tokens: 0, cost: 0, calls: 0, steps: [] });
  };

  const onEdit = () => {
    promptSpeech.discard();
    setPromptVoiceDraft(false);
    resetFlow();
    setCommitted(null);
    queueMicrotask(() => inputRef.current?.focus());
  };

  const onRun = async () => {
    const prompt = firstUnit(committed ?? draft);
    if (!prompt || running) return;

    const gen = ++generationRef.current;
    promptSpeech.discard();
    setPromptVoiceDraft(false);
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
    clearAtomFocus();
    setPatchFlash([]);
    setPatchRibbon(null);
    setRevisionLog([]);
    setRunMeter({ tokens: 0, cost: 0, calls: 0, steps: [] });

    try {
      // Fast path: return ports before applicability audit so the UI can prime.
      const designed = await api.designCriteria(prompt, model || undefined, {
        audit: false,
      });
      if (generationRef.current !== gen) return;
      setDesign(designed);
      addMeter("design", designed);

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
        addMeter("audit", audited);
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
        addMeter("needs", needs);
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
          addMeter("gather", gathered);
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
        addMeter("answer", answered);
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
    answer ? "has-answer" : "",
    running ? "is-running" : "",
    phase !== "idle" ? `phase-${phase}` : "",
    atomFocus ? "is-focus-mode" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const railsCompact = !!answer;
  const leftOpen = leftExpanded || leftHover;
  const rightOpen = rightExpanded || rightHover;
  const leftCompact = railsCompact && !leftOpen;
  const rightCompact = railsCompact && !rightOpen;

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
    const maxH = Math.min(280, window.innerHeight - 24);
    const below = r.bottom + 8;
    const above = r.top - 8;
    // Prefer below; flip above when the panel would clip the viewport bottom.
    const placeAbove = below + Math.min(160, maxH) > window.innerHeight - 12;
    const y = placeAbove
      ? Math.max(8, above - Math.min(maxH, 200))
      : Math.min(below, window.innerHeight - Math.min(maxH, 160) - 8);
    setTip({
      key,
      text: full,
      url: url?.trim() || undefined,
      x: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      y,
      maxH,
      placeAbove,
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
      <div
        className={stageClass}
        onClick={() => {
          if (atomFocus) clearAtomFocus();
          if (costHover) closeCost();
        }}
      >
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
            }${leftCompact ? " is-compact" : ""}${leftOpen && railsCompact ? " is-expanded" : ""}${!answer ? " is-loading-rail" : ""}${(focusKind && ["check", "defeater", "risk"].includes(focusKind)) || (atomFocus && ["check", "defeater", "risk"].includes(atomFocus.kind)) ? " has-focus" : ""}`}
            onMouseEnter={(e) => {
              if (!railsCompact || costHover) return;
              // mouseenter.target is the aside itself — hit-test the pointer.
              const hit = document.elementFromPoint(e.clientX, e.clientY);
              if (hit?.closest(".nimble-cost-wrap")) return;
              openLeftRail();
            }}
            onMouseLeave={() => {
              if (railsCompact && !costHover) scheduleCloseLeftRail();
            }}
          >
            {leftCompact ? (
              <div className="nimble-rail-glyphs" role="toolbar" aria-label="Left periphery">
                {criteria?.required_ports?.length ? (
                  <button
                    type="button"
                    className="nimble-glyph-btn"
                    title={`ports · ${criteria.required_ports.length}`}
                    onMouseEnter={openLeftRail}
                    onClick={() => setLeftExpanded((v) => !v)}
                  >
                    <span aria-hidden>⌗</span>
                    <span className="nimble-glyph-n">
                      {criteria.required_ports.length}
                    </span>
                  </button>
                ) : null}
                {openText ? (
                  <button
                    type="button"
                    className="nimble-glyph-btn leaf"
                    title="open"
                    onMouseEnter={openLeftRail}
                    onClick={() => setLeftExpanded((v) => !v)}
                  >
                    <span aria-hidden>○</span>
                  </button>
                ) : null}
                {settlementNeeds.length > 0 && (
                  <button
                    type="button"
                    className={`nimble-glyph-btn${focusKind === "check" ? " is-focus" : ""}`}
                    title={`checks · ${settlementNeeds.length}`}
                    onMouseEnter={openLeftRail}
                    onClick={() => setLeftExpanded((v) => !v)}
                  >
                    <span aria-hidden>▢</span>
                    <span className="nimble-glyph-n">{settlementNeeds.length}</span>
                  </button>
                )}
                {defeaterNeeds.length > 0 && (
                  <button
                    type="button"
                    className={`nimble-glyph-btn warn${focusKind === "defeater" ? " is-focus" : ""}`}
                    title={`hunts · ${defeaterNeeds.length}`}
                    onMouseEnter={openLeftRail}
                    onClick={() => setLeftExpanded((v) => !v)}
                  >
                    <span aria-hidden>▿</span>
                    <span className="nimble-glyph-n">{defeaterNeeds.length}</span>
                  </button>
                )}
                {defeaters.length > 0 && (
                  <button
                    type="button"
                    className={`nimble-glyph-btn danger${atomFocus?.kind === "defeater" && atomFocus.id.startsWith("defeater:") ? " is-focus" : ""}`}
                    title={`defeaters · ${defeaters.length}`}
                    onMouseEnter={openLeftRail}
                    onClick={() => setLeftExpanded((v) => !v)}
                  >
                    <span aria-hidden>✕</span>
                    <span className="nimble-glyph-n">{defeaters.length}</span>
                  </button>
                )}
                {(answer?.answer?.residual_uncertainty?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    className={`nimble-glyph-btn warn${focusKind === "risk" ? " is-focus" : ""}`}
                    title={`risks · ${answer!.answer.residual_uncertainty.length}`}
                    onMouseEnter={openLeftRail}
                    onClick={() => setLeftExpanded((v) => !v)}
                  >
                    <span aria-hidden>△</span>
                    <span className="nimble-glyph-n">
                      {answer!.answer.residual_uncertainty.length}
                    </span>
                  </button>
                )}
                {(runMeter.calls > 0 || running) && (
                  <div
                    ref={costWrapRef}
                    className="nimble-cost-wrap"
                  >
                    <button
                      type="button"
                      className={`nimble-glyph-btn cost${costHover ? " is-focus" : ""}`}
                      title="run cost"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCost();
                      }}
                    >
                      <span aria-hidden>$</span>
                      <span className="nimble-glyph-n">
                        {runMeter.calls || "·"}
                      </span>
                    </button>
                    {costHover && (
                      <div
                        className="nimble-cost-pop is-rail-left"
                        style={
                          costBox
                            ? { top: costBox.top, right: costBox.right }
                            : undefined
                        }
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="nimble-cost-k">run</div>
                        <div className="nimble-cost-row">
                          <span>tokens</span>
                          <span>{runMeter.tokens.toLocaleString()}</span>
                        </div>
                        <div className="nimble-cost-row">
                          <span>cost</span>
                          <span>${runMeter.cost.toFixed(4)}</span>
                        </div>
                        <div className="nimble-cost-row">
                          <span>calls</span>
                          <span>{runMeter.calls}</span>
                        </div>
                        {runMeter.steps.length > 0 && (
                          <ul className="nimble-cost-steps">
                            {runMeter.steps.map((s, i) => (
                              <li key={`${s.phase}-${i}`}>
                                {s.phase}
                                {s.tokens
                                  ? ` · ${s.tokens.toLocaleString()} tok`
                                  : ""}
                                {s.cost ? ` · $${s.cost.toFixed(4)}` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
            <div className="nimble-rail-scroll">
              {railsCompact && (
                <button
                  type="button"
                  className="nimble-rail-collapse"
                  onClick={() => {
                    setLeftExpanded(false);
                    setLeftHover(false);
                    setLeftSession((s) => s + 1);
                    if (costTimer.current) window.clearTimeout(costTimer.current);
                    setCostHover(false);
                    setCostBox(null);
                  }}
                  title="Collapse"
                >
                  «
                </button>
              )}
              {criteria?.required_ports?.length ? (
                <details
                  className="nimble-fold"
                  {...(focusKind === null && pipelineFoldsOpen
                    ? {}
                    : {})}
                >
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
                  key={`open-${design?.run_id ?? "x"}-${leftSession}`}
                  {...(!answer || pipelineFoldsOpen ? { open: true } : {})}
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
                  key={`checks-${leftSession}-${pipelineFoldsOpen ? "fill" : "side"}`}
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
                      const id = `check:${i}`;
                      const active = lens?.target.id === id || atomLit(id);
                      return (
                        <li
                          key={key}
                          className={atomClass(
                            "nimble-atom",
                            active && "is-focused",
                            atomLit(id) && "is-atom-focus",
                            atomFlashed(id) && "is-patched",
                          )}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            enterAtomFocus({
                              kind: "check",
                              id,
                              text: n.statement,
                              label: "check",
                            });
                          }}
                          {...soft(key, n.statement, 56)}
                        >
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
                  key={`hunts-${leftSession}-${pipelineFoldsOpen ? "fill" : "side"}`}
                  {...(pipelineFoldsOpen ? { open: true } : {})}
                >
                  <summary className="nimble-fold-sum">
                    <span className="nimble-fold-glyph warn" aria-hidden>
                      ▿
                    </span>
                    <span className="nimble-fold-k">hunts</span>
                    <span className="nimble-fold-n">{defeaterNeeds.length}</span>
                  </summary>
                  <ul className="nimble-fold-list">
                    {defeaterNeeds.map((n, i) => {
                      const key = `hunt-${i}`;
                      const id = `hunt:${i}`;
                      const active = lens?.target.id === id || atomLit(id);
                      return (
                        <li
                          key={key}
                          className={atomClass(
                            "nimble-atom",
                            active && "is-focused",
                            atomLit(id) && "is-atom-focus",
                            atomFlashed(id) && "is-patched",
                          )}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            enterAtomFocus({
                              kind: "defeater",
                              id,
                              text: n.statement,
                              label: "hunt",
                            });
                          }}
                          {...soft(key, n.statement, 56)}
                        >
                          {trunc(n.statement, 56)}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}

              {(answer?.answer?.residual_uncertainty?.length ?? 0) > 0 && (
                <details
                  className="nimble-fold"
                  key={`risks-${leftSession}`}
                >
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
                      const id = `risk:${i}`;
                      const active = lens?.target.id === id || atomLit(id);
                      return (
                        <li
                          key={key}
                          className={atomClass(
                            "nimble-atom",
                            active && "is-focused",
                            atomLit(id) && "is-atom-focus",
                            (atomFlashed(id) ||
                              atomFlashed("risk:new")) &&
                              "is-patched",
                          )}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            enterAtomFocus({
                              kind: "risk",
                              id,
                              text: u,
                              label: "risk",
                            });
                          }}
                          {...soft(key, u, 64)}
                        >
                          {trunc(u, 64)}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}

              {defeaters.length > 0 && (
                <details
                  className="nimble-fold"
                  key={`defs-${leftSession}`}
                >
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
                      const id = `defeater:${i}`;
                      return (
                        <li
                          key={key}
                          className={atomClass(
                            "nimble-atom",
                            atomLit(id) && "is-atom-focus",
                            atomFlashed(id) && "is-patched",
                          )}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            enterAtomFocus({
                              kind: "defeater",
                              id,
                              text: d.text,
                              label: "defeater",
                            });
                          }}
                          {...soft(key, d.text, 56)}
                        >
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

              {(runMeter.calls > 0 || running) && !railsCompact && (
                <div ref={costWrapRef} className="nimble-cost-inline">
                  <button
                    type="button"
                    className={`nimble-glyph-btn cost${costHover ? " is-focus" : ""}`}
                    title="run cost"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCost();
                    }}
                  >
                    <span aria-hidden>$</span>
                    <span className="nimble-glyph-n">{runMeter.calls || "·"}</span>
                  </button>
                  {costHover && (
                    <div
                      className="nimble-cost-pop is-rail-left"
                      style={
                        costBox
                          ? { top: costBox.top, right: costBox.right }
                          : undefined
                      }
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="nimble-cost-k">run</div>
                      <div className="nimble-cost-row">
                        <span>tokens</span>
                        <span>{runMeter.tokens.toLocaleString()}</span>
                      </div>
                      <div className="nimble-cost-row">
                        <span>cost</span>
                        <span>${runMeter.cost.toFixed(4)}</span>
                      </div>
                      <div className="nimble-cost-row">
                        <span>calls</span>
                        <span>{runMeter.calls}</span>
                      </div>
                      {runMeter.steps.length > 0 && (
                        <ul className="nimble-cost-steps">
                          {runMeter.steps.map((s, i) => (
                            <li key={`${s.phase}-${i}`}>
                              {s.phase}
                              {s.tokens ? ` · ${s.tokens.toLocaleString()} tok` : ""}
                              {s.cost ? ` · $${s.cost.toFixed(4)}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            )}
          </aside>
        )}

        <div
          className={`nimble-prompt-block${committed == null ? " is-editing" : ""}`}
          onMouseUp={() => {
            if (!answer || committed == null) return;
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed) return;
            const text = sel.toString().replace(/\s+/g, " ").trim();
            if (text.length < 6 || text.length > 280) return;
            enterAtomFocus({
              kind: "summary",
              id: "selection",
              text,
              label: "selection",
            });
            setFocusNote(text.slice(0, 160));
          }}
        >
          {committed == null ? (
            <>
              <div className="nimble-prompt-row">
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
                      promptSpeech.discard();
                      void onRun();
                    }
                  }}
                />
                {promptSpeech.supported && (
                  <button
                    type="button"
                    className={`nimble-mic${promptSpeech.listening ? " is-listening" : ""}`}
                    onClick={togglePromptMic}
                    disabled={running}
                    aria-label={
                      promptSpeech.listening
                        ? "Stop listening"
                        : "Dictate prompt"
                    }
                    aria-pressed={promptSpeech.listening}
                  >
                    <MicIcon />
                  </button>
                )}
                {(promptSpeech.listening || promptVoiceDraft) && (
                  <button
                    type="button"
                    className="nimble-mic-discard"
                    onClick={discardPromptDraft}
                    disabled={running}
                    aria-label="Discard draft"
                  >
                    ×
                  </button>
                )}
              </div>
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
                      <span
                        className={`nimble-above-tag nimble-phase-tag${
                          phase === "gather" || phase === "answer"
                            ? " is-pulse"
                            : ""
                        }`}
                      >
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
                  onClick={(e) => e.stopPropagation()}
                >
                  {figures.map((f, i) => {
                    const id = `figure:${i}`;
                    return (
                      <div
                        key={`${f.label}-${f.value}-${i}`}
                        role="button"
                        tabIndex={0}
                        className={atomClass(
                          "nimble-figure",
                          "nimble-atom",
                          f.role === "primary" ? "is-primary" : "is-sat",
                          atomLit(id) && "is-atom-focus",
                          atomFlashed(id) && "is-patched",
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          enterAtomFocus({
                            kind: "figure",
                            id,
                            text: `${f.value} ${f.label}`,
                            label: "figure",
                          });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            enterAtomFocus({
                              kind: "figure",
                              id,
                              text: `${f.value} ${f.label}`,
                              label: "figure",
                            });
                          }
                        }}
                        {...soft(
                          `fig-${f.label}-${f.value}-${i}`,
                          f.tip || `${f.value} · ${f.label}`,
                          8,
                        )}
                      >
                        <div className="nimble-figure-value">{f.value}</div>
                        <div
                          className={`nimble-figure-label${f.label.length > 18 ? " is-long" : ""}`}
                          title={f.tip}
                        >
                          {f.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {verdictFull && (
                <p
                  className={atomClass(
                    "nimble-verdict",
                    "nimble-atom",
                    atomLit("verdict") && "is-atom-focus",
                    atomFlashed("verdict") && "is-patched",
                  )}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    enterAtomFocus({
                      kind: "verdict",
                      id: "verdict",
                      text: verdictFull,
                      label: "verdict",
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      enterAtomFocus({
                        kind: "verdict",
                        id: "verdict",
                        text: verdictFull,
                        label: "verdict",
                      });
                    }
                  }}
                >
                  {verdictFull}
                </p>
              )}

              {summaryText && summaryText !== verdictFull.trim() && (
                <p
                  className={atomClass(
                    "nimble-summary",
                    "nimble-italic",
                    "nimble-atom",
                    atomLit("summary") && "is-atom-focus",
                    atomFlashed("summary") && "is-patched",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    enterAtomFocus({
                      kind: "summary",
                      id: "summary",
                      text: summaryText,
                      label: "summary",
                    });
                  }}
                >
                  {summaryHot.length === 0
                    ? summaryText
                    : renderHotSummary(summaryText, summaryHot, {
                        activeId: lens?.spanId ?? null,
                        onEnter: (spanId, target, index) =>
                          showLens(spanId, target, index),
                        onLeave: (spanId) => hideLens(spanId),
                        onClick: (spanId, target, index) => {
                          pinLens(spanId, target, index);
                          const kind = target.kind as PatchFocusKind | "section";
                          if (kind === "section") return;
                          enterAtomFocus({
                            kind,
                            id: target.id,
                            text: target.body,
                            label: target.label || kind,
                          });
                        },
                      })}
                </p>
              )}

              {schemaTokens.length > 0 && (
                <div
                  className="nimble-schema-stamp"
                  aria-label="schema"
                  onClick={(e) => e.stopPropagation()}
                >
                  {schemaTokens.map((tok) => {
                    const id = `schema:${tok.toLowerCase()}`;
                    return (
                      <button
                        key={tok}
                        type="button"
                        className={atomClass(
                          "nimble-schema-tok",
                          "nimble-atom",
                          (lens?.spanId === `tok-${tok.toLowerCase()}` ||
                            atomLit(id)) &&
                            "is-active",
                          atomLit(id) && "is-atom-focus",
                          atomFlashed(id) && "is-patched",
                        )}
                        onMouseEnter={() => activateToken(tok)}
                        onMouseLeave={() =>
                          hideLens(`tok-${tok.toLowerCase()}`)
                        }
                        onClick={() => {
                          activateToken(tok, true);
                          enterAtomFocus({
                            kind: "schema",
                            id,
                            text: tok,
                            label: "schema",
                          });
                        }}
                      >
                        {tok}
                      </button>
                    );
                  })}
                </div>
              )}

              {lens && (
                <div
                  className={`nimble-lens${lens.pinned ? " is-pinned" : ""}`}
                  onMouseEnter={() => {
                    if (lensTimer.current) {
                      window.clearTimeout(lensTimer.current);
                    }
                  }}
                  onMouseLeave={() => hideLens()}
                >
                  <div className="nimble-lens-top">
                    <span className="nimble-lens-k">
                      {lens.target.label}
                      {lens.pinned ? " · pinned" : ""}
                    </span>
                    {lens.pinned && (
                      <button
                        type="button"
                        className="nimble-lens-clear"
                        onClick={clearFocus}
                        title="Unpin (Esc)"
                      >
                        ×
                      </button>
                    )}
                  </div>
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

              {!verdictFull &&
                !summaryText &&
                answer?.answer?.assertions?.[0]?.statement && (
                  <p className="nimble-verdict">
                    {answer.answer.assertions[0].statement}
                  </p>
                )}

              {((answer?.answer?.assertions?.length ?? 0) > 0 ||
                sections.length > 0) && (
                <details
                  className="nimble-fold nimble-fold-center"
                  key={`detail-${focusKind === "assertion" || focusKind === "section" || atomFocus?.kind === "assertion" ? "fill" : "side"}`}
                  {...(focusKind === "assertion" ||
                  focusKind === "section" ||
                  atomFocus?.kind === "assertion"
                    ? { open: true }
                    : {})}
                >
                  <summary className="nimble-fold-sum">
                    <span className="nimble-fold-k">detail</span>
                    <span className="nimble-fold-n">
                      {(answer?.answer?.assertions?.length ?? 0) +
                        sections.length}
                    </span>
                  </summary>
                  <div className="nimble-fold-body">
                    {(answer?.answer?.assertions?.length ?? 0) > 0 && (
                      <ul className="nimble-fold-list">
                        {answer!.answer.assertions.map((a, i) => {
                          const key = `assert-${i}`;
                          const id = `assertion:${i}`;
                          const full = a.basis
                            ? `${a.statement} — ${a.basis}`
                            : a.statement;
                          const active =
                            lens?.target.id === id || atomLit(id);
                          return (
                            <li
                              key={key}
                              className={atomClass(
                                "nimble-atom",
                                active && "is-focused",
                                atomLit(id) && "is-atom-focus",
                                atomFlashed(id) && "is-patched",
                              )}
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                enterAtomFocus({
                                  kind: "assertion",
                                  id,
                                  text: a.statement,
                                  label: "assertion",
                                });
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  enterAtomFocus({
                                    kind: "assertion",
                                    id,
                                    text: a.statement,
                                    label: "assertion",
                                  });
                                }
                              }}
                              {...soft(key, full, 160)}
                            >
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
                      const active = lens?.target.id === `section:${i}`;
                      return (
                        <div
                          key={key}
                          className={`nimble-section-block${active ? " is-focused" : ""}`}
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
              gather || running || revisionLog.length > 0 ? " in" : ""
            }${rightCompact ? " is-compact" : ""}${rightOpen && railsCompact ? " is-expanded" : ""}${focusKind === "claim" || atomFocus?.kind === "claim" ? " has-focus" : ""}`}
            onMouseEnter={() => {
              if (railsCompact) openRightRail();
            }}
            onMouseLeave={() => {
              if (railsCompact) scheduleCloseRightRail();
            }}
          >
            {rightCompact ? (
              <div className="nimble-rail-glyphs" role="toolbar" aria-label="Claims">
                <button
                  type="button"
                  className={`nimble-glyph-btn${focusKind === "claim" ? " is-focus" : ""}`}
                  title={`claims · ${allFinds.length || 0}`}
                  onMouseEnter={openRightRail}
                  onClick={() => setRightExpanded((v) => !v)}
                >
                  <span aria-hidden>«</span>
                  <span className="nimble-glyph-n">{allFinds.length || "·"}</span>
                </button>
                {revisionLog.length > 0 && (
                  <button
                    type="button"
                    className="nimble-glyph-btn leaf"
                    title={`revises · ${revisionLog.length}`}
                    onMouseEnter={openRightRail}
                    onClick={() => setRightExpanded((v) => !v)}
                  >
                    <span aria-hidden>↻</span>
                    <span className="nimble-glyph-n">{revisionLog.length}</span>
                  </button>
                )}
              </div>
            ) : (
            <div className="nimble-rail-scroll">
              {railsCompact && (
                <button
                  type="button"
                  className="nimble-rail-collapse"
                  onClick={() => {
                    setRightExpanded(false);
                    setRightHover(false);
                    setRightSession((s) => s + 1);
                  }}
                  title="Collapse"
                >
                  »
                </button>
              )}
              <details
                className="nimble-fold"
                key={`claims-${rightSession}`}
                open
              >
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
                    const id = `claim:${f.id}`;
                    const tipBody = [
                      f.claim,
                      f.source_title ? `Source: ${f.source_title}` : "",
                      f.source_publisher || "",
                      f.published_at || "",
                    ]
                      .filter(Boolean)
                      .join("\n");
                    const focused =
                      focusedClaimId === f.id || atomLit(id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        className={atomClass(
                          "nimble-claim-row",
                          "nimble-atom",
                          focused && "is-focused",
                          atomLit(id) && "is-atom-focus",
                          atomFlashed(id) && "is-patched",
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          enterAtomFocus({
                            kind: "claim",
                            id,
                            text: f.claim || f.source_title || f.id,
                            label: "claim",
                          });
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

              {revisionLog.length > 0 && (
                <details
                  className="nimble-fold"
                  key={`revises-${rightSession}`}
                  open
                >
                  <summary className="nimble-fold-sum">
                    <span className="nimble-fold-glyph leaf" aria-hidden>
                      ↻
                    </span>
                    <span className="nimble-fold-k">revises</span>
                    <span className="nimble-fold-n">{revisionLog.length}</span>
                  </summary>
                  <div className="nimble-revise-list">
                    {[...revisionLog].reverse().map((r) => (
                      <article
                        key={r.revision}
                        className={`nimble-revise-card${r.stub ? " is-stub" : ""}${
                          patchRibbon?.revision === r.revision ? " is-latest" : ""
                        }`}
                      >
                        <div className="nimble-revise-line">
                          <span className="nimble-patch-rev">r{r.revision}</span>
                          {r.line}
                          {r.stub ? " · stub" : ""}
                        </div>
                        {r.ops.length > 0 && (
                          <ul className="nimble-patch-ops is-rail">
                            {r.ops.map((op, i) => (
                              <li key={`${r.revision}-${op.op}-${op.target_id}-${i}`}>
                                <span className="nimble-patch-op-k">{op.op}</span>
                                {op.before ? (
                                  <span className="nimble-patch-before">
                                    {op.before}
                                  </span>
                                ) : null}
                                {op.before && op.after ? (
                                  <span className="nimble-patch-arrow">→</span>
                                ) : null}
                                {op.after ? (
                                  <span className="nimble-patch-after">{op.after}</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </article>
                    ))}
                  </div>
                </details>
              )}
            </div>
            )}
          </aside>
        )}
      </div>

      {tip && (
        <div
          className={`nimble-tip${tip.placeAbove ? " is-above" : ""}`}
          style={{
            left: tip.x,
            top: tip.y,
            maxHeight: tip.maxH ?? 280,
          }}
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

      {atomFocus && answer && (
        <div
          className="nimble-focus-dock is-overlay"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="nimble-focus-dock-top">
            <span className="nimble-focus-dock-k">{atomFocus.label}</span>
            <button
              type="button"
              className="nimble-lens-clear"
              onClick={clearAtomFocus}
              aria-label="Discard"
            >
              ×
            </button>
          </div>
          <p className="nimble-focus-dock-snip">{atomFocus.text}</p>
          {atomFocus.kind === "claim" &&
            (() => {
              const fid = atomFocus.id.replace(/^claim:/, "");
              const find = gather?.finds.find((f) => f.id === fid) ?? null;
              if (!find?.source_url && !find?.source_title) return null;
              return find.source_url ? (
                <a
                  className="nimble-focus-source"
                  href={find.source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {find.source_title || find.source_url}
                </a>
              ) : (
                <div className="nimble-focus-source is-plain">
                  {find.source_title}
                </div>
              );
            })()}
          <div className="nimble-focus-note-row">
            <input
              ref={focusNoteRef}
              className="nimble-focus-note"
              value={focusNote}
              disabled={patching}
              placeholder={focusSpeech.listening ? "listening…" : "note"}
              onChange={(e) => setFocusNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  focusSpeech.discard();
                  void applyAtomPatch("critique");
                }
              }}
            />
            {focusSpeech.supported && (
              <button
                type="button"
                className={`nimble-mic${focusSpeech.listening ? " is-listening" : ""}`}
                onClick={toggleFocusMic}
                disabled={patching}
                aria-label={
                  focusSpeech.listening ? "Stop listening" : "Dictate note"
                }
                aria-pressed={focusSpeech.listening}
              >
                <MicIcon />
              </button>
            )}
          </div>
          {focusSpeech.error && (
            <span className="nimble-mic-error">{focusSpeech.error}</span>
          )}
          {patching && (
            <span className="nimble-italic nimble-focus-wait">working…</span>
          )}
        </div>
      )}

      <div className="nimble-dock">
        <span className="nimble-dock-hint">
          {promptSpeech.error
            ? promptSpeech.error
            : promptSpeech.listening
              ? "Listening… · Esc discard"
              : "Enter run · Shift+Enter line"}
        </span>
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
            onClick={() => {
              promptSpeech.discard();
              void onRun();
            }}
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
  return clipWords(s, n);
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
  if (isBrokenFigureLabel(t) || isWeakFigureLabel(t)) return 0;
  if (/^(chance|range|percent|record|wins|place|division|alt\b)/i.test(t)) {
    return 1;
  }
  let score = Math.min(t.length, 36);
  if (/\b(20\d{2})\b/.test(t)) score += 4;
  if (
    /\b(vote|odds|share|poll|record|leader|chance|risk|ruin|parity|capacity|compute|yield|production|stock|growth|revenue|YoY)\b/i.test(
      t,
    )
  ) {
    score += 5;
  }
  return score;
}

function isWeakFigureLabel(label: string): boolean {
  return /^(reached?|reaching|shows?|shown|unlikely|likely|remains?|leaving|versus|with|from|into|under|given|about|that|this|have|has|had|been|were|was|are|is|to|of|in|on|at|by|for|as|and|or|the|a|an|far|exceeding|exceeds|above|over|below)$/i.test(
    label.trim(),
  );
}

/** Reject mid-paren scraps like "~9B end-2025) far exceeding". */
function isBrokenFigureLabel(label: string): boolean {
  const t = label.trim();
  if (!t) return true;
  if (/[~()]/.test(t)) return true;
  if (/^\W/.test(t)) return true;
  if (
    /^(far|exceeding|exceeds|above|over|under|below|from|vs\.?|versus)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/** Drop parenthetical asides so labels aren't cut from "(…)" guts. */
function stripParens(s: string): string {
  return s
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pull a short distinctive label from text around a numeric match. */
function labelNear(
  before: string,
  after: string,
  fallback: string,
): string {
  const bRaw = before.replace(/\s+/g, " ").trim();
  const a = after.replace(/\s+/g, " ").trim();
  const b = stripParens(bRaw);

  // "41% of global AI chip deployment" / "41 percent share of …"
  const ofAfter = a.match(
    /^\s*(?:percent\s+)?(?:share\s+)?(?:of|in)\s+(.{3,42})/i,
  );
  if (ofAfter?.[1]) {
    const cand = trimLabel(ofAfter[1].replace(/[,.;:].*$/, "").trim(), 48);
    if (cand && !isWeakFigureLabel(cand) && !isBrokenFigureLabel(cand)) {
      return cand;
    }
  }

  // "multi-fold growth far exceeding 25%" / "revenue above 12%"
  const thr = b.match(
    /((?:multi[- ]?fold\s+)?(?:growth|revenue|sales|return|margin|gain|increase|profit)s?(?:\s+rate)?)\s+(?:far\s+)?(?:exceeding|exceeds|above|over|under|below|vs\.?|versus)\s*$/i,
  );
  if (thr?.[1]) {
    let cand = thr[1].trim();
    const yoy = a.match(/^\s*((?:YoY|year[- ]over[- ]year)(?:\s+\w+){0,2})/i);
    if (yoy?.[1]) cand = `${cand} ${yoy[1]}`.trim();
    cand = trimLabel(cand, 48);
    if (cand && !isWeakFigureLabel(cand) && !isBrokenFigureLabel(cand)) {
      return cand;
    }
  }

  // Bare "exceeding 25% YoY" — use after as the anchor when before is gluey.
  if (
    /(?:far\s+)?(?:exceeding|exceeds|above|over|under|below)\s*$/i.test(b)
  ) {
    const yoy = a.match(
      /^\s*((?:YoY|year[- ]over[- ]year)(?:\s+(?:growth|gain|increase))?)/i,
    );
    if (yoy?.[1]) {
      const cand = trimLabel(yoy[1].trim(), 32);
      if (cand && !isBrokenFigureLabel(cand)) return cand;
    }
  }

  // "share of X … at 41%" / "parity by 2030 at 41%"
  const shareBefore = b.match(
    /((?:share|portion|odds|chance|probability|capacity|parity|stock|yield|production|growth|revenue)(?:\s+(?:of|in|for)\s+[^,.;:]{2,36})?)\s*(?:at|to|near|around|≈|~)?\s*$/i,
  );
  if (shareBefore?.[1]) {
    const cand = trimLabel(shareBefore[1].trim(), 48);
    if (cand && !isWeakFigureLabel(cand) && !isBrokenFigureLabel(cand)) {
      return cand;
    }
  }

  const ofThat =
    b.match(
      /(?:chance|probability|odds|likelihood|rate|share|margin|vote|capacity|parity|growth)\s+(?:of|that|for|as)?\s*(.{3,42})$/i,
    ) ||
    a.match(
      /^(?:chance|probability|odds|likelihood|share)\s+(?:of|that|for)\s+(.{3,42})/i,
    );
  if (ofThat?.[1]) {
    const cand = trimLabel(ofThat[1].replace(/[,.;:].*$/, "").trim(), 44);
    if (cand && !isWeakFigureLabel(cand) && !isBrokenFigureLabel(cand)) {
      return cand;
    }
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
        !/^(a|an|the|of|to|in|on|at|vs|is|are|and|or|with|under|about|was|were|has|had|been|reach|reached|reaching|unlikely|likely|far|exceeding|exceeds|above|over|below|reflecting|approximately)$/i.test(
          w,
        ),
    )
    .slice(-4)
    .join(" ");
  if (topic && topic.length >= 3 && !isWeakFigureLabel(topic) && !isBrokenFigureLabel(topic)) {
    const yearBit = byYear
      ? byYear[1] || `${byYear[2]}–${byYear[3]}`
      : "";
    return trimLabel(
      yearBit && !topic.includes(yearBit) ? `${topic} ${yearBit}` : topic,
      48,
    );
  }
  if (byYear) return byYear[1] || `${byYear[2]}–${byYear[3]}`;

  // Last resort: short after-context (e.g. "YoY") if clean.
  const afterBit = a
    .replace(/^[%\s.,;:—-]+/, "")
    .replace(/[,.;:].*$/, "")
    .trim();
  if (
    afterBit.length >= 2 &&
    afterBit.length <= 24 &&
    !isWeakFigureLabel(afterBit) &&
    !isBrokenFigureLabel(afterBit)
  ) {
    return afterBit;
  }
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
    /(.{0,72}?)(\d{1,3}(?:\.\d+)?)\s*[-–]\s*(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)\b(.{0,36})/gi,
  )) {
    const label = labelNear(m[1], m[4], "range");
    const value = `${m[2]}–${m[3]}%`;
    add(value, label, "chance", `${value} · ${label}`, 3);
  }

  for (const m of text.matchAll(
    /(.{0,72}?)(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)\b(.{0,36})/gi,
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
    // Threshold comparisons ("exceeding 25%") are weak hero figures.
    const isThreshold =
      /(?:far\s+)?(?:exceeding|exceeds|above|over|under|below|vs\.?|versus)\s*$/i.test(
        stripParens(m[1].replace(/\s+/g, " ")),
      );
    add(
      value,
      label,
      "chance",
      `${value} · ${label}`,
      isThreshold ? 0.5 : 2,
    );
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
    const bestLabel =
      isWeakFigureLabel(fig.label) || isBrokenFigureLabel(fig.label)
        ? alts[0] || fig.label
        : fig.label;
    const tipParts = [
      `${fig.value} — ${bestLabel}`,
      ...alts.filter((l) => l.toLowerCase() !== bestLabel.toLowerCase()).slice(0, 3),
    ];
    return {
      ...fig,
      label: bestLabel,
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

