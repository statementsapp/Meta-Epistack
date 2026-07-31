import { useEffect } from "react";
import { PORT_CATALOGUE, type CriteriaAnswer, type PortId } from "./types";

const fmtCost = (v: number) => `$${v.toFixed(4)}`;

export function AnswerOverlay({
  answer,
  loading,
  error,
  model,
  totalTokens,
  totalCostUsd,
  onClose,
}: {
  answer: CriteriaAnswer | null;
  loading: boolean;
  error: string | null;
  model?: string;
  totalTokens?: number;
  totalCostUsd?: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="answer-overlay" role="dialog" aria-modal="true" aria-label="Criteria-satisfying answer">
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
          <div className="answer-overlay-status">
            Drafting an answer that covers the required criteria…
          </div>
        )}

        {error && !answer && (
          <div className="error" style={{ marginTop: 8 }}>
            {error}
          </div>
        )}

        {answer && (
          <div className="answer-overlay-body">
            <h2 className="answer-headline">{answer.headline}</h2>
            {answer.summary && <p className="criteria-prose">{answer.summary}</p>}

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
                      {a.defeaters.length > 0 && (
                        <>
                          <div className="section-title">Defeaters</div>
                          <ul className="answer-list">
                            {a.defeaters.map((d, j) => (
                              <li key={j}>{d}</li>
                            ))}
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
              <span>{model ?? "N/A"}</span>
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
