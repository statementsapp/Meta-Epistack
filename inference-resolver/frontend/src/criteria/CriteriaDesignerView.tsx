import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { AnswerOverlay } from "./AnswerOverlay";
import { CriteriaObjectOverlay } from "./CriteriaObjectOverlay";
import {
  LOGIC_FRAGMENT_LABELS,
  PORT_CATALOGUE,
  PORT_IDS,
  type AnswerResult,
  type BouncerResult,
  type CriteriaAnswer,
  type CriteriaObject,
  type DesignResult,
  type EvidenceNeedItem,
  type EvidenceNeedPlan,
  type GatheredFind,
  type GatherPacket,
  type PortId,
} from "./types";

const fmtCost = (v: number) => `$${v.toFixed(4)}`;
const OVERLAY_DELAY_MS = 12000;

type FlowPhase = "idle" | "needs" | "gather" | "answer";

export function CriteriaDesignerView() {
  const health = useStore((s) => s.health);
  const storeModel = useStore((s) => s.model);
  const setField = useStore((s) => s.setField);

  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<DesignResult | null>(null);
  const [selectedPort, setSelectedPort] = useState<PortId | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [overlayOpen, setOverlayOpen] = useState(false);
  const [criteriaOverlayOpen, setCriteriaOverlayOpen] = useState(false);
  const [flowPhase, setFlowPhase] = useState<FlowPhase>("idle");
  const [answerLoading, setAnswerLoading] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [answerPayload, setAnswerPayload] = useState<AnswerResult | null>(null);
  const [needsPlan, setNeedsPlan] = useState<EvidenceNeedPlan | null>(null);
  const [needsError, setNeedsError] = useState<string | null>(null);
  const [gatherPacket, setGatherPacket] = useState<GatherPacket | null>(null);
  const [gatherError, setGatherError] = useState<string | null>(null);

  const generationRef = useRef(0);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const model = storeModel || health?.default_model || "";

  useEffect(() => {
    return () => {
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    };
  }, []);

  const mergeRunStats = (partial: {
    run_id: number;
    model?: string;
    calls?: AnswerResult["calls"];
    total_tokens?: number;
    total_cost_usd?: number;
  }) => {
    setResult((prev) =>
      prev && prev.run_id === partial.run_id
        ? {
            ...prev,
            calls: partial.calls ?? prev.calls,
            total_tokens: partial.total_tokens ?? prev.total_tokens,
            total_cost_usd: partial.total_cost_usd ?? prev.total_cost_usd,
            model: partial.model || prev.model,
          }
        : prev,
    );
  };

  const clearAnswerFlow = () => {
    generationRef.current += 1;
    if (overlayTimerRef.current) {
      clearTimeout(overlayTimerRef.current);
      overlayTimerRef.current = null;
    }
    setOverlayOpen(false);
    setCriteriaOverlayOpen(false);
    setFlowPhase("idle");
    setAnswerLoading(false);
    setAnswerError(null);
    setAnswerPayload(null);
    setNeedsPlan(null);
    setNeedsError(null);
    setGatherPacket(null);
    setGatherError(null);
  };

  const openAnswerOverlay = () => {
    setCriteriaOverlayOpen(false);
    setOverlayOpen(true);
  };

  const openCriteriaOverlay = () => {
    setOverlayOpen(false);
    setCriteriaOverlayOpen(true);
  };

  const startForwardFlow = (next: DesignResult, sourcePrompt: string) => {
    if (!next.bouncer.admitted || !next.criteria || next.run_id == null) return;

    const gen = ++generationRef.current;
    const runModel = next.model || model || undefined;
    setFlowPhase("needs");
    setAnswerLoading(true);
    setAnswerError(null);
    setAnswerPayload(null);
    setNeedsPlan(null);
    setNeedsError(null);
    setGatherPacket(null);
    setGatherError(null);
    setOverlayOpen(false);

    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    overlayTimerRef.current = setTimeout(() => {
      if (generationRef.current === gen) setOverlayOpen(true);
    }, OVERLAY_DELAY_MS);

    void (async () => {
      let plan: EvidenceNeedPlan | undefined;
      let packet: GatherPacket | undefined;

      try {
        const needs = await api.planEvidenceNeeds({
          prompt: sourcePrompt,
          criteria: next.criteria!,
          model: runModel,
          run_id: next.run_id!,
        });
        if (generationRef.current !== gen) return;
        plan = needs.evidence_needs;
        setNeedsPlan(plan);
        mergeRunStats(needs);
        if (needs.warnings?.length) {
          setNeedsError(needs.warnings.join(" "));
        }
      } catch (e) {
        if (generationRef.current !== gen) return;
        setNeedsError((e as Error).message);
      }

      if (generationRef.current !== gen) return;

      if (plan) {
        setFlowPhase("gather");
        try {
          const gathered = await api.gatherEvidence({
            prompt: sourcePrompt,
            criteria: next.criteria!,
            evidence_needs: plan,
            model: runModel,
            run_id: next.run_id!,
          });
          if (generationRef.current !== gen) return;
          packet = gathered.gather;
          plan = gathered.evidence_needs;
          setGatherPacket(packet);
          setNeedsPlan(plan);
          mergeRunStats(gathered);
          if (gathered.warnings?.length) {
            setGatherError(gathered.warnings.join(" "));
          }
        } catch (e) {
          if (generationRef.current !== gen) return;
          setGatherError((e as Error).message);
        }
      }

      if (generationRef.current !== gen) return;
      setFlowPhase("answer");

      try {
        const answered = await api.answerCriteria({
          prompt: sourcePrompt,
          criteria: next.criteria!,
          model: runModel,
          run_id: next.run_id!,
          evidence_needs: plan,
          gather: packet,
        });
        if (generationRef.current !== gen) return;
        setAnswerPayload(answered);
        setAnswerLoading(false);
        setFlowPhase("idle");
        mergeRunStats(answered);
      } catch (e) {
        if (generationRef.current !== gen) return;
        setAnswerError((e as Error).message);
        setAnswerLoading(false);
        setFlowPhase("idle");
      }
    })();
  };

  const onGenerate = async () => {
    clearAnswerFlow();
    setRunning(true);
    setError(null);
    try {
      const next = await api.designCriteria(prompt, model || undefined);
      setResult(next);
      setSelectedPort(
        (next.criteria?.required_ports[0] as PortId | undefined) ?? null,
      );
      startForwardFlow(next, prompt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const criteria = result?.criteria ?? null;
  const bouncer = result?.bouncer ?? null;
  const answer: CriteriaAnswer | null = answerPayload?.answer ?? null;

  const statusText =
    flowPhase === "needs"
      ? "Planning evidence needs from criteria…"
      : flowPhase === "gather"
        ? "Gathering provenance-bearing finds…"
        : flowPhase === "answer" || answerLoading
          ? "Drafting criteria-satisfying answer…"
          : null;

  return (
    <div className="criteria-view">
      <div className="criteria-layout">
        <div className="panel criteria-input">
          <div className="section-title">Prompt</div>
          <p className="criteria-lead">
            Criteria from the prompt, then evidence needs, then web gather into
            provenance-bearing finds, then a criteria-satisfying answer.
          </p>
          <textarea
            className="criteria-textarea"
            placeholder="Enter an inquiry… e.g. What caused the 2008 liquidity freeze in interbank markets?"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={running}
          />
          <div className="row" style={{ marginBottom: 8 }}>
            <select
              title="Model"
              value={model}
              onChange={(e) => setField("model", e.target.value)}
              disabled={running}
            >
              {(health?.models ?? (model ? [model] : [])).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={!prompt.trim() || running}
            onClick={() => void onGenerate()}
          >
            {running ? "Designing…" : "Generate Criteria"}
          </button>
          {error && <div className="error">{error}</div>}
          {statusText && bouncer?.admitted && (
            <div className="warn-text">{statusText}</div>
          )}
          {needsError && needsPlan && (
            <div className="warn-text" style={{ marginTop: 8 }}>
              Needs warnings: {needsError}
            </div>
          )}
          {needsError && !needsPlan && (
            <div className="warn-text" style={{ marginTop: 8 }}>
              Evidence-need plan failed ({needsError}); answering from criteria
              alone.
            </div>
          )}
          {gatherError && (
            <div className="warn-text" style={{ marginTop: 8 }}>
              Gather: {gatherError}
            </div>
          )}
          {answerPayload && !overlayOpen && (
            <button
              type="button"
              className="secondary"
              style={{ marginTop: 8, width: "100%" }}
              onClick={openAnswerOverlay}
            >
              Show answer
            </button>
          )}
          {answerError && !answerPayload && (
            <div className="error" style={{ marginTop: 8 }}>
              Answer failed: {answerError}
            </div>
          )}

          {bouncer && (
            <BouncerSummary bouncer={bouncer} />
          )}

          {result && (result.total_tokens != null || (result.calls?.length ?? 0) > 0) && (
            <TokenStats result={result} />
          )}
        </div>

        <div className="criteria-main">
          {running && (
            <div className="empty" style={{ position: "relative", minHeight: 280 }}>
              Calling model to design criteria…
            </div>
          )}

          {!running && !result && (
            <div className="empty" style={{ position: "relative", minHeight: 280 }}>
              Enter a prompt and generate criteria. Flow: criteria → evidence
              needs → gather → answer. Rejected prompts show a type label only.
            </div>
          )}

          {!running && bouncer && !bouncer.admitted && (
            <div className="empty" style={{ position: "relative", minHeight: 280 }}>
              Outside design envelope. No criteria generated.
            </div>
          )}

          {!running && criteria && (
            <>
              <CriteriaPanel
                criteria={criteria}
                selectedPort={selectedPort}
                onSelectPort={setSelectedPort}
                onShowObject={openCriteriaOverlay}
              />
              {(needsPlan || flowPhase === "needs") && (
                <EvidenceNeedsPanel
                  plan={needsPlan}
                  loading={flowPhase === "needs" && !needsPlan}
                />
              )}
              {(gatherPacket || flowPhase === "gather") && (
                <GatherPanel
                  packet={gatherPacket}
                  loading={flowPhase === "gather" && !gatherPacket}
                />
              )}
            </>
          )}
        </div>
      </div>

      {criteriaOverlayOpen && criteria && (
        <CriteriaObjectOverlay
          criteria={criteria}
          onClose={() => setCriteriaOverlayOpen(false)}
        />
      )}

      {overlayOpen && (
        <AnswerOverlay
          answer={answer}
          loading={answerLoading}
          error={answerError}
          model={answerPayload?.model ?? result?.model}
          totalTokens={answerPayload?.total_tokens ?? result?.total_tokens}
          totalCostUsd={answerPayload?.total_cost_usd ?? result?.total_cost_usd}
          onClose={() => setOverlayOpen(false)}
        />
      )}
    </div>
  );
}

function EvidenceNeedsPanel({
  plan,
  loading,
}: {
  plan: EvidenceNeedPlan | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="panel evidence-needs-panel">
        <div className="section-title">Evidence needs</div>
        <p className="criteria-prose">Deriving settlement and defeater needs from criteria…</p>
      </div>
    );
  }
  if (!plan) return null;

  return (
    <div className="panel evidence-needs-panel">
      <div className="section-title">Evidence needs</div>
      <p className="criteria-prose">{plan.note}</p>
      <p className="criteria-log-hint">Status: {plan.retrieval_status}</p>
      {plan.scope && (
        <>
          <div className="section-title">Scope</div>
          <p className="criteria-prose">{plan.scope}</p>
        </>
      )}
      <NeedList title="Settlement checks" items={plan.settlement_checks} empty="None (observation_map not required)." />
      <NeedList title="Defeater hunts" items={plan.defeater_hunts} empty="None (revision_protocol not required)." />
      <NeedList title="Class hints" items={plan.class_hints} empty="None (source_class_ranking not required)." />
      {plan.non_needs.length > 0 && (
        <>
          <div className="section-title">Non-needs (answer form only)</div>
          <ul className="criteria-statements">
            {plan.non_needs.map((n) => (
              <li key={n.port}>
                <strong>{PORT_CATALOGUE[n.port as PortId]?.label ?? n.port}</strong>
                {": "}
                {n.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function GatherPanel({
  packet,
  loading,
}: {
  packet: GatherPacket | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="panel gather-panel">
        <div className="section-title">Gather</div>
        <p className="criteria-prose">
          Searching the web for provenance-bearing finds against the need plan…
        </p>
      </div>
    );
  }
  if (!packet) return null;

  return (
    <div className="panel gather-panel">
      <div className="section-title">Gather</div>
      <p className="criteria-prose">{packet.note}</p>
      <p className="criteria-log-hint">
        Status: {packet.retrieval_status}
        {packet.finds.length > 0 ? ` · ${packet.finds.length} find(s)` : ""}
      </p>
      {packet.finds.length === 0 ? (
        <p className="criteria-prose">No finds attached for this run.</p>
      ) : (
        <ul className="criteria-statements">
          {packet.finds.map((f) => (
            <GatherFindRow key={f.id} find={f} />
          ))}
        </ul>
      )}
      {packet.unmet_needs.length > 0 && (
        <>
          <div className="section-title">Unmet needs</div>
          <ul className="criteria-statements">
            {packet.unmet_needs.map((n, i) => (
              <li key={`unmet-${i}`}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function GatherFindRow({ find }: { find: GatheredFind }) {
  return (
    <li>
      <span className="criteria-layer-tag">{find.need_kind}</span>{" "}
      <span className="criteria-layer-tag">{find.salience}</span>
      <div style={{ marginTop: 4 }}>{find.claim}</div>
      {(find.source_title || find.source_url) && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-dim)" }}>
          {find.source_url ? (
            <a href={find.source_url} target="_blank" rel="noreferrer">
              {find.source_title || find.source_url}
            </a>
          ) : (
            find.source_title
          )}
          {find.source_publisher ? ` · ${find.source_publisher}` : ""}
        </div>
      )}
      {find.quoted_or_paraphrase && (
        <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-dim)" }}>
          {find.quoted_or_paraphrase}
        </div>
      )}
    </li>
  );
}

function NeedList({
  title,
  items,
  empty,
}: {
  title: string;
  items: EvidenceNeedItem[];
  empty: string;
}) {
  return (
    <>
      <div className="section-title">{title}</div>
      {items.length === 0 ? (
        <p className="criteria-prose">{empty}</p>
      ) : (
        <ul className="criteria-statements">
          {items.map((item, i) => (
            <li key={`${item.kind}-${i}`}>
              <span className="criteria-layer-tag">{item.salience}</span>{" "}
              {item.statement}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function BouncerSummary({ bouncer }: { bouncer: BouncerResult }) {
  const failed = !bouncer.admitted;

  if (!failed) {
    return (
      <div className="bouncer-summary bouncer-pass" title={bouncer.note || "Admitted"}>
        <span className="bouncer-mark" aria-hidden="true">
          ✓
        </span>
        <span className="bouncer-label">Bouncer</span>
        <span className="bouncer-status">Admitted · {bouncer.inquiry_type}</span>
      </div>
    );
  }

  return (
    <details className="bouncer-summary bouncer-fail" open>
      <summary>
        <span className="bouncer-mark" aria-hidden="true">
          ✕
        </span>
        <span className="bouncer-label">Bouncer</span>
        <span className="bouncer-status">Rejected · {bouncer.label}</span>
      </summary>
      <div className="bouncer-fail-body">
        <div style={{ fontSize: 13 }}>
          Type: <span className="claim-id">{bouncer.rejected_type}</span>
        </div>
        <div className="error" style={{ marginTop: 8 }}>
          {bouncer.message}
        </div>
      </div>
    </details>
  );
}

function TokenStats({ result }: { result: DesignResult }) {
  const calls = result.calls ?? [];
  return (
    <>
      <div className="section-title">This criteria run</div>
      <div className="stat-grid">
        <div className="stat">
          <div className="label">Tokens</div>
          <div className="value">{(result.total_tokens ?? 0).toLocaleString()}</div>
        </div>
        <div className="stat">
          <div className="label">Cost</div>
          <div className="value">{fmtCost(result.total_cost_usd ?? 0)}</div>
        </div>
        <div className="stat">
          <div className="label">Run</div>
          <div className="value">#{result.run_id ?? "N/A"}</div>
        </div>
      </div>
      {calls.length > 0 && (
        <div className="criteria-log-hint">
          {calls.length} call{calls.length === 1 ? "" : "s"} · {result.model ?? "N/A"}
        </div>
      )}
      {(result.warnings?.length ?? 0) > 0 && (
        <div className="warn-text">{result.warnings!.join("\n")}</div>
      )}
    </>
  );
}

function joinClauses(parts: string[]): string {
  const cleaned = parts.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (cleaned.length === 0) return "";
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} And ${cleaned[1].charAt(0).toLowerCase()}${cleaned[1].slice(1)}`;
  const last = cleaned[cleaned.length - 1];
  const head = cleaned.slice(0, -1).map((p, i) =>
    i === 0 ? p : `${p.charAt(0).toLowerCase()}${p.slice(1)}`,
  );
  return `${head.join("; ")}; and ${last.charAt(0).toLowerCase()}${last.slice(1)}`;
}

function generalCriteriaParagraph(criteria: CriteriaObject): string {
  const whys = criteria.required_ports
    .map((id) => PORT_CATALOGUE[id as PortId]?.why)
    .filter((w): w is string => Boolean(w));
  const names = criteria.required_ports
    .map((id) => PORT_CATALOGUE[id as PortId]?.label ?? id)
    .join(", ");
  const body = joinClauses(whys);
  return `Taken together, a good response must satisfy these structural criteria (${names}). ${body}`;
}

function promptCriteriaParagraph(criteria: CriteriaObject): string {
  const reasons = criteria.required_ports
    .map((id) => criteria.port_applicability?.[id as PortId])
    .filter((r): r is string => Boolean(r));
  if (reasons.length === 0) {
    return `For this ${criteria.inquiry_type.replace(/_/g, " ")} prompt, the required ports above are the ones the applicability audit approved. Each must be filled by something that fits its type signature without contradicting the others under ${criteria.logic_fragment.replace(/_/g, " ")}.`;
  }
  return `For this prompt specifically: ${joinClauses(reasons)}`;
}

function CriteriaPanel({
  criteria,
  selectedPort,
  onSelectPort,
  onShowObject,
}: {
  criteria: CriteriaObject;
  selectedPort: PortId | null;
  onSelectPort: (id: PortId) => void;
  onShowObject: () => void;
}) {
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const required = new Set(criteria.required_ports);
  const selected =
    selectedPort && PORT_CATALOGUE[selectedPort]
      ? selectedPort
      : (criteria.required_ports[0] as PortId | undefined);
  const sig = selected ? PORT_CATALOGUE[selected] : null;
  const params = selected ? criteria.port_parameters[selected] : null;
  const fragment =
    LOGIC_FRAGMENT_LABELS[criteria.logic_fragment] ?? {
      title: criteria.logic_fragment,
      blurb: "Declared logic in which attachments must not contradict each other.",
    };
  const portsOrdered = [
    ...PORT_IDS.filter((id) => required.has(id)),
    ...PORT_IDS.filter((id) => !required.has(id)),
  ];

  return (
    <div
      className={`criteria-panel-body ${
        technicalOpen ? "technical-open" : "technical-collapsed"
      }`}
    >
      <div className="criteria-readable">
        <div className="criteria-readable-top">
          <div className="section-title" style={{ marginTop: 0 }}>
            Required criteria
          </div>
          <button
            type="button"
            className="criteria-technical-toggle"
            aria-expanded={technicalOpen}
            onClick={() => setTechnicalOpen((open) => !open)}
          >
            {technicalOpen ? "Hide technical details" : "Show technical details"}
          </button>
        </div>
        <ul className="criteria-statements">
          {criteria.required_ports.map((id) => {
            const port = PORT_CATALOGUE[id as PortId];
            const layer = criteria.port_layers?.[id];
            return (
              <li key={id}>
                <strong>{port?.label ?? id}:</strong>{" "}
                {port?.shortCriterion ?? id}
                {layer ? (
                  <span className="criteria-layer-tag"> · {layer}</span>
                ) : null}
              </li>
            );
          })}
        </ul>

        {criteria.answerhood && (
          <>
            <div className="section-title">Answerhood (excavated)</div>
            <div className="inspector-link">
              <div className="metric">
                <span>partition licensed</span>
                <span className="val">
                  {criteria.answerhood.partition_licensed ? "yes" : "no"}
                </span>
              </div>
              {criteria.answerhood.direct_answer && (
                <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.45 }}>
                  <strong>Direct:</strong> {criteria.answerhood.direct_answer}
                </div>
              )}
              {criteria.answerhood.partial_answer && (
                <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.45 }}>
                  <strong>Partial:</strong> {criteria.answerhood.partial_answer}
                </div>
              )}
              {criteria.answerhood.presupposition_challenge && (
                <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.45 }}>
                  <strong>Presupposition challenge:</strong>{" "}
                  {criteria.answerhood.presupposition_challenge}
                </div>
              )}
              {!criteria.answerhood.partition_licensed &&
                criteria.answerhood.open_answerhood && (
                  <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.45 }}>
                    <strong>Open answerhood:</strong>{" "}
                    {criteria.answerhood.open_answerhood}
                  </div>
                )}
            </div>
          </>
        )}

        {(criteria.prompt_fixes || criteria.prompt_leaves_open) && (
          <>
            <div className="section-title">Underdetermination</div>
            {criteria.prompt_fixes && (
              <p className="criteria-prose">
                <strong>Prompt fixes:</strong> {criteria.prompt_fixes}
              </p>
            )}
            {criteria.prompt_leaves_open && (
              <p className="criteria-prose">
                <strong>Leaves open:</strong> {criteria.prompt_leaves_open}
              </p>
            )}
          </>
        )}

        <div className="section-title">What these criteria demand</div>
        <p className="criteria-prose">{generalCriteriaParagraph(criteria)}</p>
        <p className="criteria-prose">{promptCriteriaParagraph(criteria)}</p>

        <div className="section-title">Logic in force</div>
        <details className="inspector-link logic-disclosure">
          <summary className="type">{fragment.title}</summary>
          <div className="disclosure-body">
            <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
              {fragment.blurb}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-dim)" }}>
              Here, an answer assertion is a statement the eventual response asks
              readers to accept. It is not a claim ingested from a source.
              Attachments must not contradict one another under this logic.
            </div>
          </div>
        </details>

        <div className="section-title">All ports (schema)</div>
        <div className="chip-row">
          {portsOrdered.map((id) => (
            <span
              key={id}
              className={`chip ${selected === id ? "active" : ""}`}
              style={{
                opacity: required.has(id) ? 1 : 0.45,
                cursor: "pointer",
              }}
              onClick={() => onSelectPort(id)}
            >
              {required.has(id) ? "req · " : "opt · "}
              {id}
            </span>
          ))}
        </div>

        {sig && (
          <>
            <div className="section-title">Port inspector: {sig.label}</div>
            <div className="inspector-link">
              <div className="type">{sig.id}</div>
              <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-dim)" }}>
                {sig.description}
              </div>
              <div className="section-title">Why this is a criterion</div>
              <div style={{ fontSize: 13, lineHeight: 1.45 }}>{sig.why}</div>
              {required.has(sig.id) && criteria.port_applicability?.[sig.id] && (
                <>
                  <div className="section-title">Why required for this prompt</div>
                  <div style={{ fontSize: 13, lineHeight: 1.45 }}>
                    {criteria.port_applicability[sig.id]}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {technicalOpen && (
        <aside className="criteria-technical" aria-label="Technical criteria details">
          <div className="criteria-technical-content">
            {sig && (
              <>
                <details className="technical-disclosure">
                  <summary>Type signature: {sig.label}</summary>
                  <div className="mono">{sig.typeSignature}</div>
                </details>
                {params != null && (
                  <details className="technical-disclosure">
                    <summary>Parameters for this prompt</summary>
                    <div className="mono">{JSON.stringify(params, null, 2)}</div>
                  </details>
                )}
              </>
            )}

            <details className="technical-disclosure">
              <summary>Completeness template</summary>
              <div className="mono">{criteria.completeness_template}</div>
            </details>

            <div className="criteria-object-heading">
              <div className="section-title" style={{ marginTop: 0 }}>
                Criteria object
              </div>
              <button
                type="button"
                className="criteria-technical-toggle"
                onClick={onShowObject}
              >
                Show criteria object
              </button>
            </div>
            <div className="mono criteria-object">
              {JSON.stringify(
                {
                  prompt_hash: criteria.prompt_hash,
                  inquiry_type: criteria.inquiry_type,
                  logic_fragment: criteria.logic_fragment,
                  required_ports: criteria.required_ports,
                  port_parameters: criteria.port_parameters,
                  port_applicability: criteria.port_applicability,
                  port_layers: criteria.port_layers,
                  answerhood: criteria.answerhood,
                  presuppositions: criteria.presuppositions,
                  prompt_fixes: criteria.prompt_fixes,
                  prompt_leaves_open: criteria.prompt_leaves_open,
                },
                null,
                2,
              )}
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
