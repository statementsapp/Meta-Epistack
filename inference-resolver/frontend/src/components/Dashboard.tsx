import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import type { RunResult } from "../types";

const fmtCost = (v: number) => `$${v.toFixed(4)}`;

function StageChart({ result }: { result: RunResult }) {
  const data = result.stage_summary.map((s) => ({
    stage: s.stage,
    prompt: s.prompt_tokens,
    completion: s.completion_tokens,
  }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
        <XAxis dataKey="stage" stroke="#9aa1b0" fontSize={11} />
        <YAxis stroke="#9aa1b0" fontSize={11} />
        <Tooltip
          contentStyle={{ background: "#1e222b", border: "1px solid #2a2f3a" }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="prompt" stackId="a" fill="#5b8cff" name="prompt tok" />
        <Bar dataKey="completion" stackId="a" fill="#3fb950" name="completion tok" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ComparisonChart({ a, b }: { a: RunResult; b: RunResult }) {
  const data = [a, b].map((r) => ({
    mode: r.mode,
    tokens: r.total_tokens,
    cost: r.total_cost_usd,
  }));
  const colors = ["#5b8cff", "#d29922"];
  return (
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
        <XAxis dataKey="mode" stroke="#9aa1b0" fontSize={11} />
        <YAxis stroke="#9aa1b0" fontSize={11} />
        <Tooltip
          contentStyle={{ background: "#1e222b", border: "1px solid #2a2f3a" }}
        />
        <Bar dataKey="tokens" name="total tokens">
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Dashboard({
  result,
  comparison,
  saved = false,
}: {
  result: RunResult;
  comparison: RunResult | null;
  saved?: boolean;
}) {
  const exportArtifact = async () => {
    const data = await api.exportRun(result.run_id);
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `inference-resolver-run-${result.run_id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="section-title">
        This run ({result.mode}
        {saved ? " · saved, no API call" : ""})
      </div>
      <div className="stat-grid">
        <div className="stat">
          <div className="label">Total tokens</div>
          <div className="value">{result.total_tokens.toLocaleString()}</div>
        </div>
        <div className="stat">
          <div className="label">Total cost</div>
          <div className="value">{fmtCost(result.total_cost_usd)}</div>
        </div>
        <div className="stat">
          <div className="label">Links</div>
          <div className="value">{result.links.length}</div>
        </div>
        <div className="stat">
          <div className="label">Cost / link</div>
          <div className="value">
            {result.cost_per_link != null ? fmtCost(result.cost_per_link) : "N/A"}
          </div>
        </div>
      </div>

      <div className="section-title">Tokens by stage</div>
      <StageChart result={result} />

      <div className="section-title">Calls ({result.calls.length})</div>
      <div className="calls-list">
        {result.calls.map((c) => (
          <div key={c.id} className="metric">
            <span>
              #{c.id} · {c.stage}
            </span>
            <span className="val">
              {c.total_tokens} tok · {c.latency_ms}ms
            </span>
          </div>
        ))}
      </div>

      {comparison && (
        <>
          <div className="section-title">Mode comparison (same input)</div>
          <ComparisonChart a={result} b={comparison} />
          <div className="metric">
            <span>{result.mode}</span>
            <span className="val">
              {result.total_tokens} tok · {fmtCost(result.total_cost_usd)}
            </span>
          </div>
          <div className="metric">
            <span>{comparison.mode}</span>
            <span className="val">
              {comparison.total_tokens} tok · {fmtCost(comparison.total_cost_usd)}
            </span>
          </div>
        </>
      )}

      <button
        className="secondary"
        style={{ marginTop: 12, width: "100%" }}
        onClick={exportArtifact}
      >
        Export artifact (JSON)
      </button>
    </div>
  );
}
