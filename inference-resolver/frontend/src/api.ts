import type {
  CallDetail,
  Claim,
  Demo,
  Fixture,
  Health,
  InputKind,
  RunMode,
  RunResult,
} from "./types";
import type {
  AnswerResult,
  CriteriaObject,
  DesignResult,
  EvidenceNeedPlan,
  EvidenceNeedResult,
  GatherPacket,
  GatherResult,
} from "./criteria/types";

async function jsonOrThrow(res: Response) {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

export interface RunPayload {
  input_kind: InputKind;
  text?: string;
  claims?: Claim[];
  mode: RunMode;
  model?: string;
  run_extract?: boolean;
}

export const api = {
  health: (): Promise<Health> => fetch("/api/health").then(jsonOrThrow),
  demos: (): Promise<Demo[]> => fetch("/api/demos").then(jsonOrThrow),
  run: (payload: RunPayload): Promise<RunResult> =>
    fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(jsonOrThrow),
  designCriteria: (prompt: string, model?: string): Promise<DesignResult> =>
    fetch("/api/criteria/design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, model }),
    }).then(jsonOrThrow),
  planEvidenceNeeds: (payload: {
    prompt: string;
    criteria: CriteriaObject;
    model?: string;
    run_id: number;
  }): Promise<EvidenceNeedResult> =>
    fetch("/api/criteria/evidence-needs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(jsonOrThrow),
  gatherEvidence: (payload: {
    prompt: string;
    criteria: CriteriaObject;
    evidence_needs: EvidenceNeedPlan;
    model?: string;
    run_id: number;
  }): Promise<GatherResult> =>
    fetch("/api/criteria/gather", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(jsonOrThrow),
  answerCriteria: (payload: {
    prompt: string;
    criteria: CriteriaObject;
    model?: string;
    run_id: number;
    evidence_needs?: EvidenceNeedPlan;
    gather?: GatherPacket;
  }): Promise<AnswerResult> =>
    fetch("/api/criteria/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(jsonOrThrow),
  call: (id: number): Promise<CallDetail> =>
    fetch(`/api/calls/${id}`).then(jsonOrThrow),
  fixture: (demoId: string): Promise<Fixture> =>
    fetch(`/api/fixtures/${demoId}`).then(jsonOrThrow),
  exportRun: (id: number): Promise<unknown> =>
    fetch(`/api/export/${id}`).then(jsonOrThrow),
};
