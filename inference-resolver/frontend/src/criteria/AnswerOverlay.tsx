import { useEffect } from "react";
import {
  PORT_CATALOGUE,
  type CriteriaAnswer,
  type CriteriaObject,
  type EvidenceNeedPlan,
  type GatheredFind,
  type GatherPacket,
  type PortId,
} from "./types";

const fmtCost = (v: number) => `$${v.toFixed(4)}`;

export type DraftFlowPhase = "idle" | "needs" | "gather" | "answer";

function findById(
  gather: GatherPacket | null | undefined,
  id: string,
): GatheredFind | undefined {
  return gather?.finds.find((f) => f.id === id);
}

function FindChips({
  ids,
  gather,
}: {
  ids: string[];
  gather: GatherPacket | null | undefined;
}) {
  if (!ids.length || !gather?.finds.length) return null;
  return (
    <div className="answer-find-chips">
      {ids.map((id) => {
        const f = findById(gather, id);
        if (!f) {
          return (
            <span key={id} className="answer-find-chip muted">
              {id}
            </span>
          );
        }
        const label = f.source_title || f.id;
        if (f.source_url) {
          return (
            <a
              key={id}
              className="answer-find-chip"
              href={f.source_url}
              target="_blank"
              rel="noreferrer"
              title={f.claim}
            >
              {label}
            </a>
          );
        }
        return (
          <span key={id} className="answer-find-chip" title={f.claim}>
            {label}
          </span>
        );
      })}
    </div>
  );
}

function loadingCopy(phase: DraftFlowPhase): string {
  if (phase === "needs") return "Planning evidence needs from criteria…";
  if (phase === "gather") return "Gathering provenance-bearing finds…";
  if (phase === "answer") return "Drafting a criteria-satisfying answer…";
  return "Working…";
}

function workingSchemaText(
  answer: CriteriaAnswer | null,
  criteria: CriteriaObject | null | undefined,
): string {
  if (answer?.working_query_schema?.trim()) return answer.working_query_schema.trim();
  if (!criteria) return "";
  const cf = criteria.port_parameters?.canonical_form;
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  if (cf && typeof cf === "object") {
    try {
      return JSON.stringify(cf);
    } catch {
      /* ignore */
    }
  }
  return (
    criteria.answerhood?.open_answerhood?.trim() ||
    (criteria.prompt_leaves_open
      ? `Prompt left open: ${criteria.prompt_leaves_open}`
      : "")
  );
}

function resolutionModeBlurb(mode: string | undefined): string {
  switch (mode) {
    case "discourse_map":
      return "Discourse map: success is mapping positions and speakers, not settling a mechanism.";
    case "mixed":
      return "Mixed: keep mechanism claims separate from discourse claims.";
    case "mechanism_inference":
    default:
      return "Mechanism inference: settle via observables and hypothesis/program support or ruling-out, not debate scores.";
  }
}

export function AnswerOverlay({
  answer,
  loading,
  error,
  model,
  totalTokens,
  totalCostUsd,
  runId,
  flowPhase = "idle",
  criteria = null,
  needsPlan = null,
  gather = null,
  onClose,
}: {
  answer: CriteriaAnswer | null;
  loading: boolean;
  error: string | null;
  model?: string;
  totalTokens?: number;
  totalCostUsd?: number;
  runId?: number | null;
  flowPhase?: DraftFlowPhase;
  criteria?: CriteriaObject | null;
  needsPlan?: EvidenceNeedPlan | null;
  gather?: GatherPacket | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const schema = workingSchemaText(answer, criteria);
  const retrievalStatus =
    gather?.retrieval_status ||
    needsPlan?.retrieval_status ||
    (loading ? "pending" : "unknown");
  const findCount = gather?.finds.length ?? 0;
  const unmet = gather?.unmet_needs ?? [];
  const mode = criteria?.resolution_mode || "mechanism_inference";

  return (
    <div
      className="answer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Criteria-satisfying answer"
    >
      <button
        type="button"
        className="answer-overlay-backdrop"
        aria-label="Dismiss answer"
        onClick={onClose}
      />
      <div className="answer-overlay-panel">
        <div className="answer-overlay-top">
          <div className="section-title" style={{ marginTop: 0 }}>
            Criteria-satisfying draft
          </div>
          <button type="button" className="secondary answer-overlay-close" onClick={onClose}>
            Close
          </button>
        </div>

        {loading && !answer && (
          <div className="answer-overlay-status">{loadingCopy(flowPhase)}</div>
        )}

        {error && !answer && (
          <div className="error" style={{ marginTop: 8 }}>
            {error}
          </div>
        )}

        {(answer || needsPlan || gather || criteria) && (
          <div className="answer-grounding-strip">
            <div>
              <span className="answer-grounding-label">Resolution mode</span>{" "}
              <span className="claim-id">{mode.replace(/_/g, " ")}</span>
            </div>
            <p className="criteria-prose">{resolutionModeBlurb(mode)}</p>
            <div>
              <span className="answer-grounding-label">Gather</span>{" "}
              <span className="claim-id">{retrievalStatus}</span>
              {findCount > 0 ? ` · ${findCount} find(s)` : ""}
            </div>
            {gather?.note && <p className="criteria-prose">{gather.note}</p>}
            {unmet.length > 0 && (
              <>
                <div className="section-title">Unmet needs</div>
                <ul className="answer-list">
                  {unmet.map((n, i) => (
                    <li key={`unmet-${i}`}>{n}</li>
                  ))}
                </ul>
              </>
            )}
            {retrievalStatus === "gathered" && findCount === 0 && (
              <p className="criteria-prose">
                Gather reported success but attached no finds. Treat grounding as
                thin.
              </p>
            )}
            {(retrievalStatus === "gather_failed" ||
              retrievalStatus === "skipped" ||
              retrievalStatus === "planned_only") &&
              !loading && (
                <p className="criteria-prose">
                  This draft may rely on model judgment more than provenance-bearing
                  finds.
                </p>
              )}
          </div>
        )}

        {answer && (
          <div className="answer-overlay-body">
            <h2 className="answer-headline">{answer.headline}</h2>
            {answer.summary && <p className="criteria-prose">{answer.summary}</p>}

            {schema && (
              <>
                <div className="section-title">Working query schema</div>
                <p className="criteria-prose">{schema}</p>
              </>
            )}

            {answer.assertions.length > 0 && (
              <>
                <div className="section-title">Answer assertions</div>
                <div className="answer-assertions">
                  {answer.assertions.map((a, i) => (
                    <div key={i} className="inspector-link">
                      <div className="type">Assertion {i + 1}</div>
                      <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.45 }}>
                        {a.statement}
                      </div>
                      {a.basis && (
                        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-dim)" }}>
                          Basis: {a.basis}
                        </div>
                      )}
                      <FindChips ids={a.find_ids ?? []} gather={gather} />
                      {a.defeaters.length > 0 && (
                        <>
                          <div className="section-title">Defeaters</div>
                          <ul className="answer-list">
                            {a.defeaters.map((d, j) => {
                              const text = typeof d === "string" ? d : d.text;
                              const salience =
                                typeof d === "string" ? "medium" : d.salience;
                              const findIds =
                                typeof d === "string" ? [] : d.find_ids ?? [];
                              return (
                                <li key={j}>
                                  <span className="criteria-layer-tag">{salience}</span>{" "}
                                  {text}
                                  <FindChips ids={findIds} gather={gather} />
                                </li>
                              );
                            })}
                          </ul>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {answer.sections.length > 0 && (
              <>
                <div className="section-title">Criteria coverage</div>
                {answer.sections.map((s) => {
                  const label =
                    PORT_CATALOGUE[s.port as PortId]?.label ?? s.title ?? s.port;
                  return (
                    <div key={s.port} className="inspector-link">
                      <div className="type">{label}</div>
                      {s.body && (
                        <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.45 }}>
                          {s.body}
                        </div>
                      )}
                      {s.items.length > 0 && (
                        <ul className="answer-list">
                          {s.items.map((item, j) => (
                            <li key={j}>{item}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {answer.residual_uncertainty.length > 0 && (
              <>
                <div className="section-title">Still open</div>
                <ul className="answer-list">
                  {answer.residual_uncertainty.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              </>
            )}

            <div className="answer-overlay-footer">
              <span>
                {runId != null ? `run #${runId}` : "run N/A"} · {model ?? "N/A"}
              </span>
              <span>
                {(totalTokens ?? 0).toLocaleString()} tok · {fmtCost(totalCostUsd ?? 0)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
