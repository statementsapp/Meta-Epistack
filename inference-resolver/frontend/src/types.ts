export type LinkType = "supports" | "rebuts" | "qualifies";
export type RunMode = "pairwise" | "batched";
export type InputKind = "text" | "claims";

export interface SourceSpan {
  start: number;
  end: number;
}

export interface Claim {
  id: string;
  text: string;
  span?: SourceSpan | null;
}

export interface Link {
  id: string;
  source: string;
  target: string;
  type: LinkType;
  rationale: string;
  assumption: string;
  confidence: number;
  call_ids: number[];
  model: string;
}

export interface CallSummary {
  id: number;
  stage: string;
  mode: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  latency_ms: number;
}

export interface StageSummary {
  stage: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

export interface RunResult {
  run_id: number;
  mode: string;
  model: string;
  input_kind: string;
  claims: Claim[];
  links: Link[];
  calls: CallSummary[];
  stage_summary: StageSummary[];
  total_tokens: number;
  total_cost_usd: number;
  cost_per_link: number | null;
  warnings: string[];
}

export interface Health {
  key_present: boolean;
  models: string[];
  default_model: string;
  max_claims: number;
}

export interface Demo {
  id: string;
  title: string;
  label?: string;
  input_kind: InputKind;
  text?: string;
  claims?: { text: string }[];
}

export interface CallDetail extends CallSummary {
  run_id: number;
  prompt: string;
  response: string;
}

export interface Fixture {
  demo_id: string;
  generated_at: string;
  result: RunResult;
  call_details: Record<string, CallDetail>;
}
