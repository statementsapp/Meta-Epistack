import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import type { CallSummary } from "../types";
import { AnswerOverlay } from "./AnswerOverlay";
import {
  LOGIC_FRAGMENT_LABELS,
  PORT_CATALOGUE,
  PORT_IDS,
  type AnswerResult,
  type CriteriaAnswer,
  type CriteriaObject,
  type DesignResult,
  type PortId,
} from "./types";

const fmtCost = (v: number) => `$${v.toFixed(4)}`;
const OVERLAY_DELAY_MS = 7000;

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
  const [answerLoading, setAnswerLoading] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [answerPayload, setAnswerPayload] = useState<AnswerResult | null>(null);

  const generationRef = useRef(0);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const model = storeModel || health?.default_model || "";

  useEffect(() => {
    return () => {
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    };
  }, []);

  const clearAnswerFlow = () => {
    generationRef.current += 1;
    if (overlayTimerRef.current) {
      clearTimeout(overlayTimerRef.current);
      overlayTimerRef.current = null;
    }
    setOverlayOpen(false);
    setAnswerLoading(false);
    setAnswerError(null);
    setAnswerPayload(null);
  };

  const startAnswerFlow = (next: DesignResult, sourcePrompt: string) => {
    if (!next.bouncer.admitted || !next.criteria || next.run_id == null) return;

    const gen = ++generationRef.current;
    setAnswerLoading(true);
    setAnswerError(null);
    setAnswerPayload(null);
    setOverlayOpen(false);

    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    overlayTimerRef.current = setTimeout(() => {
      if (generationRef.current === gen) setOverlayOpen(true);
    }, OVERLAY_DELAY_MS);

    void api
      .answerCriteria({
        prompt: sourcePrompt,
        criteria: next.criteria,
        model: next.model || model || undefined,
        run_id: next.run_id,
      })
      .then((answered) => {
        if (generationRef.current !== gen) return;
        setAnswerPayload(answered);
        setAnswerLoading(false);
        setResult((prev) =>
          prev && prev.run_id === answered.run_id
            ? {
                ...prev,
                calls: answered.calls,
                total_tokens: answered.total_tokens,
                total_cost_usd: answered.total_cost_usd,
                model: answered.model,
              }
            : prev,
        );
      })
      .catch((e) => {
        if (generationRef.current !== gen) return;
        setAnswerError((e as Error).message);
        setAnswerLoading(false);
      });
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
      startAnswerFlow(next, prompt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const criteria = result?.criteria ?? null;
  const bouncer = result?.bouncer ?? null;
  const answer: CriteriaAnswer | null = answerPayload?.answer ?? null;

  return (
    <div className="criteria-view">
      <div className="criteria-layout">
        <div className="panel criteria-input">
          <div className="section-title">Prompt</div>
          <p className="criteria-lead">
            Before search or answer generation, an LLM classifies the prompt and
            designs structural criteria that a good response must satisfy.
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
          {answerLoading && bouncer?.admitted && (
            <div className="warn-text">Drafting criteria-satisfying answer…</div>
          )}
          {answerPayload && !overlayOpen && (
            <button
              type="button"
              className="secondary"
              style={{ marginTop: 8, width: "100%" }}
              onClick={() => setOverlayOpen(true)}
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
            <>
              <div className="section-title">Bouncer</div>
              {bouncer.admitted ? (
                <div className="inspector-link">
                  <div className="type" style={{ color: "#3fb950" }}>
                    Admitted
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13 }}>
                    Type: <span className="claim-id">{bouncer.inquiry_type}</span>
                  </div>
                  <div style={{ marginTop: 4, color: "var(--text-dim)", fontSize: 12 }}>
                    {bouncer.note}
                  </div>
                  <SurfaceFeaturesBlock features={bouncer.features} />
                </div>
              ) : (
                <div className="inspector-link">
                  <div className="type" style={{ color: "#f85149" }}>
                    Rejected
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13 }}>
                    Type: <span className="claim-id">{bouncer.label}</span>
                    <span style={{ color: "var(--text-dim)" }}>
                      {" "}
                      ({bouncer.rejected_type})
                    </span>
                  </div>
                  <div className="error" style={{ marginTop: 8 }}>
                    {bouncer.message}
                  </div>
                  {"features" in bouncer && bouncer.features && (
                    <SurfaceFeaturesBlock features={bouncer.features} />
                  )}
                </div>
              )}
            </>
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
              Enter a prompt and generate criteria. Uses the same LLM + token
              ledger as claim resolution. Rejected prompts show a type label only.
            </div>
          )}

          {!running && bouncer && !bouncer.admitted && (
            <div className="empty" style={{ position: "relative", minHeight: 280 }}>
              Outside design envelope. No criteria generated.
            </div>
          )}

          {!running && criteria && (
            <CriteriaPanel
              criteria={criteria}
              selectedPort={selectedPort}
              onSelectPort={setSelectedPort}
            />
          )}
        </div>
      </div>

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

function TokenStats({ result }: { result: DesignResult }) {
  const calls = result.calls ?? [];
  return (
    <>
      <div className="section-title">This design run</div>
      <div className="stat-grid">
        <div className="stat">
          <div className="label">Total tokens</div>
          <div className="value">{(result.total_tokens ?? 0).toLocaleString()}</div>
        </div>
        <div className="stat">
          <div className="label">Total cost</div>
          <div className="value">{fmtCost(result.total_cost_usd ?? 0)}</div>
        </div>
        <div className="stat">
          <div className="label">Model</div>
          <div className="value" style={{ fontSize: 12 }}>
            {result.model ?? "N/A"}
          </div>
        </div>
        <div className="stat">
          <div className="label">Run id</div>
          <div className="value">{result.run_id ?? "N/A"}</div>
        </div>
        {result.criteria?.prompt_hash && (
          <div className="stat criteria-run-hash">
            <div className="label">Prompt hash</div>
            <div className="value mono">{result.criteria.prompt_hash}</div>
          </div>
        )}
      </div>
      {result.run_id != null && (
        <div className="criteria-log-hint">
          Logged as run #{result.run_id} under backend/app/data/criteria_runs/
          and criteria_run_log.jsonl
        </div>
      )}
      {calls.length > 0 && (
        <>
          <div className="section-title">Calls ({calls.length})</div>
          <div className="calls-list">
            {calls.map((c: CallSummary) => (
              <div key={c.id} className="metric">
                <span>
                  #{c.id} · {c.stage}
                </span>
                <span className="val">
                  {c.total_tokens} tok · {c.latency_ms}ms · {fmtCost(c.cost_usd)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {(result.warnings?.length ?? 0) > 0 && (
        <div className="warn-text">{result.warnings!.join("\n")}</div>
      )}
    </>
  );
}

function SurfaceFeaturesBlock({
  features,
}: {
  features: CriteriaObject["surface_features"];
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <div className="section-title" style={{ marginTop: 0 }}>
        Surface features
      </div>
      <div className="metric">
        <span>tense</span>
        <span className="val">{features.tense}</span>
      </div>
      <div className="metric">
        <span>quantifiers</span>
        <span className="val">{features.hasQuantifiers ? "yes" : "no"}</span>
      </div>
      <div className="metric">
        <span>modals</span>
        <span className="val">{features.hasModals ? "yes" : "no"}</span>
      </div>
      <div className="metric">
        <span>evaluative language</span>
        <span className="val">{features.hasEvaluativeLanguage ? "yes" : "no"}</span>
      </div>
      <div className="metric">
        <span>closedness</span>
        <span className="val">{features.closedness}</span>
      </div>
    </div>
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
}: {
  criteria: CriteriaObject;
  selectedPort: PortId | null;
  onSelectPort: (id: PortId) => void;
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

            <div className="section-title">Criteria object</div>
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
