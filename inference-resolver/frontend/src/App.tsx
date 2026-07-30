import { useEffect } from "react";
import { InputPanel } from "./components/InputPanel";
import { Dashboard } from "./components/Dashboard";
import { Inspector } from "./components/Inspector";
import { GraphView } from "./graph/GraphView";
import { useStore } from "./store";
import { linkColor } from "./theme";

export function App() {
  const s = useStore();

  useEffect(() => {
    s.init().catch((e) => s.setField("error", (e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedLink =
    s.result?.links.find((l) => l.id === s.selectedLinkId) ?? null;

  return (
    <div className="app">
      <div className="topbar">
        <h1>Inference Resolver</h1>
        <span className="subtitle">
          claims in, typed support/rebuttal graph out, with per-stage token cost
        </span>
        {s.health && (
          <span className={`badge ${s.health.key_present ? "ok" : "warn"}`}>
            {s.health.key_present ? "Grok key loaded" : "No API key — add XAI_API_KEY to backend/.env"}
          </span>
        )}
      </div>

      <InputPanel />

      <div className="center">
        {s.result && s.result.claims.length > 0 ? (
          <>
            <div className="legend">
              {(["supports", "rebuts", "qualifies"] as const).map((t) => (
                <span key={t}>
                  <span className="swatch" style={{ background: linkColor[t] }} />
                  {t}
                </span>
              ))}
            </div>
            <GraphView
              claims={s.result.claims}
              links={s.result.links}
              selectedLinkId={s.selectedLinkId}
              onSelectLink={s.selectLink}
            />
          </>
        ) : (
          <div className="empty">
            {s.running
              ? "Resolving claims..."
              : "Load a demo or paste input, then Resolve to build the claim graph."}
          </div>
        )}
      </div>

      <div className="panel right">
        {selectedLink && s.result && (
          <>
            <div className="section-title">Selected link</div>
            <Inspector link={selectedLink} claims={s.result.claims} />
          </>
        )}
        {s.result ? (
          <Dashboard
            result={s.result}
            comparison={s.comparison}
            saved={s.fixtureCalls != null}
          />
        ) : (
          <div style={{ color: "var(--text-dim)", fontSize: 13 }}>
            Token usage and cost telemetry appear here after a run.
          </div>
        )}
      </div>
    </div>
  );
}
