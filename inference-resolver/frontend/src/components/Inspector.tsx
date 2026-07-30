import { useEffect, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { linkColor } from "../theme";
import type { CallDetail, Claim, Link } from "../types";

interface Props {
  link: Link;
  claims: Claim[];
}

export function Inspector({ link, claims }: Props) {
  const fixtureCalls = useStore((st) => st.fixtureCalls);
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [open, setOpen] = useState(false);

  const byId = (id: string) => claims.find((c) => c.id === id)?.text ?? id;
  const callId = link.call_ids[0];

  useEffect(() => {
    setDetail(null);
    setOpen(false);
  }, [link.id]);

  const loadCall = async () => {
    setOpen(true);
    if (detail == null && callId != null) {
      // Fixture-loaded runs embed their raw exchanges; live runs hit the ledger.
      const embedded = fixtureCalls?.[callId];
      if (embedded) {
        setDetail(embedded);
        return;
      }
      try {
        setDetail(await api.call(callId));
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <div className="inspector-link">
      <div className="type" style={{ color: linkColor[link.type] }}>
        {link.type}
      </div>
      <div style={{ margin: "6px 0", fontSize: 13 }}>
        <span className="claim-id">{link.source}</span> {byId(link.source)}
        <div style={{ color: "var(--text-dim)", margin: "4px 0" }}>
          {link.type} ↓
        </div>
        <span className="claim-id">{link.target}</span> {byId(link.target)}
      </div>
      <div className="metric">
        <span>Confidence</span>
        <span className="val">{link.confidence.toFixed(2)}</span>
      </div>
      {link.assumption && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <div style={{ color: "var(--text-dim)", fontSize: 11, marginBottom: 2 }}>
            Assumption
          </div>
          {link.assumption}
        </div>
      )}
      {link.rationale && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-dim)" }}>
          {link.rationale}
        </div>
      )}
      {callId != null && (
        <div style={{ marginTop: 8 }}>
          <a className="link-btn" onClick={loadCall}>
            {open ? "Raw LLM exchange" : "Show raw LLM exchange"}
          </a>
        </div>
      )}
      {open && detail && (
        <div style={{ marginTop: 8 }}>
          <div className="metric">
            <span>Call #{detail.id} · {detail.model}</span>
            <span className="val">{detail.total_tokens} tok</span>
          </div>
          <div className="section-title">Prompt</div>
          <div className="mono">{detail.prompt}</div>
          <div className="section-title">Response</div>
          <div className="mono">{detail.response}</div>
        </div>
      )}
    </div>
  );
}
