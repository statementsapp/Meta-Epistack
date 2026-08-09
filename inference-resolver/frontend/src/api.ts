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
  CriteriaAnswer,
  CriteriaObject,
  CriteriaPatchResult,
  DesignResult,
  EvidenceNeedPlan,
  EvidenceNeedResult,
  GatherPacket,
  GatherResult,
  PatchFocus,
} from "./criteria/types";

async function jsonOrThrow(res: Response) {
  if (!res.ok) {
    const raw = await res.text();
    let detail = res.statusText || `HTTP ${res.status}`;
    if (raw.trim()) {
      try {
        const body = JSON.parse(raw);
        if (typeof body.detail === "string") {
          detail = body.detail;
        } else if (body.detail) {
          detail = JSON.stringify(body.detail);
        } else if (typeof body.message === "string") {
          detail = body.message;
        } else {
          detail = raw.trim().slice(0, 400);
        }
      } catch {
        detail = raw.trim().slice(0, 400);
      }
    }
    const path = (() => {
      try {
        return new URL(res.url).pathname;
      } catch {
        return res.url || "request";
      }
    })();
    throw new Error(`${detail} (${res.status} ${path})`);
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
  designCriteria: (
    prompt: string,
    model?: string,
    opts?: { audit?: boolean },
  ): Promise<DesignResult> =>
    fetch("/api/criteria/design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        model,
        audit: opts?.audit ?? true,
      }),
    }).then(jsonOrThrow),
  auditCriteria: (payload: {
    prompt: string;
    criteria: CriteriaObject;
    model?: string;
    run_id: number;
  }): Promise<DesignResult> =>
    fetch("/api/criteria/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
  patchCriteria: (payload: {
    prompt: string;
    run_id: number;
    model?: string;
    action: "critique" | "probe";
    note?: string;
    focus: PatchFocus;
    answer: CriteriaAnswer;
    gather?: GatherPacket;
    evidence_needs?: EvidenceNeedPlan;
    criteria?: CriteriaObject;
  }): Promise<CriteriaPatchResult> =>
    fetch("/api/criteria/patch", {
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
