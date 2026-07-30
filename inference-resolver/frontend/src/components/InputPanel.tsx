import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import type { Demo } from "../types";

// Fills the space it is given and shrinks its font until the whole input fits,
// so the left column never needs to scroll.
function FitTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const fit = () => {
    const el = ref.current;
    if (!el) return;
    let size = 12;
    el.style.fontSize = `${size}px`;
    while (size > 6.5 && el.scrollHeight > el.clientHeight) {
      size -= 0.5;
      el.style.fontSize = `${size}px`;
    }
  };

  useLayoutEffect(fit, [props.value]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  return (
    <div className="fit-input">
      <textarea ref={ref} {...props} />
    </div>
  );
}

export function InputPanel() {
  const s = useStore();
  const [demos, setDemos] = useState<Demo[]>([]);

  useEffect(() => {
    api.demos().then(setDemos).catch(() => setDemos([]));
  }, []);

  const canRun =
    !s.running &&
    (s.inputKind === "text" ? s.text.trim().length > 0 : s.claimsJson.trim().length > 0);

  return (
    <div className="panel left-col">
      <div className="chip-row">
        {demos.map((d) => (
          <span key={d.id} className="chip" onClick={() => s.loadDemo(d)}>
            {d.label ?? d.title}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <span
          className={`chip ${s.inputKind === "text" ? "active" : ""}`}
          onClick={() => s.setField("inputKind", "text")}
        >
          Text
        </span>
        <span
          className={`chip ${s.inputKind === "claims" ? "active" : ""}`}
          onClick={() => s.setField("inputKind", "claims")}
        >
          JSON
        </span>
      </div>

      {s.inputKind === "text" ? (
        <FitTextarea
          placeholder="Paste prose, notes, or a bullet list. The extract stage turns it into claims."
          value={s.text}
          onChange={(e) => s.setField("text", e.target.value)}
        />
      ) : (
        <FitTextarea
          placeholder='["claim one", "claim two"] or [{"text": "..."}] — passed through with zero extract tokens.'
          value={s.claimsJson}
          onChange={(e) => s.setField("claimsJson", e.target.value)}
        />
      )}

      <div className="row" style={{ marginBottom: 8 }}>
        <select
          title="Run mode"
          value={s.mode}
          onChange={(e) => s.setField("mode", e.target.value as any)}
        >
          <option value="batched">batched</option>
          <option value="pairwise">pairwise</option>
        </select>
        <select
          title="Model"
          value={s.model}
          onChange={(e) => s.setField("model", e.target.value)}
        >
          {(s.health?.models ?? []).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="row">
        <button disabled={!canRun} onClick={() => s.run()}>
          {s.running ? "Running..." : "Resolve"}
        </button>
        <button
          className="secondary"
          disabled={!canRun || !s.result}
          title="Run the same input in the other mode to compare cost"
          onClick={() => s.runComparison()}
        >
          Compare
        </button>
      </div>

      {s.error && <div className="error">{s.error}</div>}
      {s.result?.warnings?.map((w, i) => (
        <div key={i} className="warn-text">
          {w}
        </div>
      ))}
    </div>
  );
}
