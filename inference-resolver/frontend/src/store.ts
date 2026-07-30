import { create } from "zustand";
import { api, type RunPayload } from "./api";
import type {
  CallDetail,
  Claim,
  Demo,
  Health,
  InputKind,
  RunMode,
  RunResult,
} from "./types";

interface AppState {
  health: Health | null;
  inputKind: InputKind;
  text: string;
  claimsJson: string;
  mode: RunMode;
  model: string;
  running: boolean;
  error: string | null;
  result: RunResult | null;
  // Same input run under the other mode, for the comparison chart.
  comparison: RunResult | null;
  selectedLinkId: string | null;
  // Set when the current result came from a saved fixture: raw LLM exchanges
  // embedded in the fixture, so the inspector works without the ledger.
  fixtureCalls: Record<number, CallDetail> | null;

  init: () => Promise<void>;
  setField: <K extends keyof AppState>(key: K, value: AppState[K]) => void;
  loadDemo: (demo: Demo) => Promise<void>;
  run: () => Promise<void>;
  runComparison: () => Promise<void>;
  selectLink: (id: string | null) => void;
}

function buildPayload(s: AppState, mode: RunMode): RunPayload {
  if (s.inputKind === "claims") {
    let claims: Claim[] = [];
    const parsed = JSON.parse(s.claimsJson);
    const arr = Array.isArray(parsed) ? parsed : parsed.claims;
    claims = (arr as unknown[]).map((c, i) => {
      if (typeof c === "string") return { id: `c${i}`, text: c };
      const obj = c as { id?: string; text: string };
      return { id: obj.id ?? `c${i}`, text: obj.text };
    });
    return { input_kind: "claims", claims, mode, model: s.model };
  }
  return { input_kind: "text", text: s.text, mode, model: s.model };
}

export const useStore = create<AppState>((set, get) => ({
  health: null,
  inputKind: "text",
  text: "",
  claimsJson: "",
  mode: "batched",
  model: "",
  running: false,
  error: null,
  result: null,
  comparison: null,
  selectedLinkId: null,
  fixtureCalls: null,

  init: async () => {
    const health = await api.health();
    set({ health, model: get().model || health.default_model });
  },

  setField: (key, value) => set({ [key]: value } as Partial<AppState>),

  loadDemo: async (demo) => {
    set({
      inputKind: demo.input_kind,
      text: demo.input_kind === "text" ? demo.text ?? "" : "",
      claimsJson:
        demo.input_kind === "claims"
          ? JSON.stringify(demo.claims ?? [], null, 2)
          : "",
      result: null,
      comparison: null,
      selectedLinkId: null,
      error: null,
      fixtureCalls: null,
    });
    // Saved run result: shows the full UI with zero LLM calls.
    try {
      const fx = await api.fixture(demo.id);
      const fixtureCalls: Record<number, CallDetail> = {};
      for (const detail of Object.values(fx.call_details)) {
        fixtureCalls[detail.id] = detail;
      }
      set({ result: fx.result, fixtureCalls });
    } catch {
      // No fixture for this demo; user can run live.
    }
  },

  run: async () => {
    set({
      running: true,
      error: null,
      comparison: null,
      selectedLinkId: null,
      fixtureCalls: null,
    });
    try {
      const result = await api.run(buildPayload(get(), get().mode));
      set({ result });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ running: false });
    }
  },

  runComparison: async () => {
    const s = get();
    const other: RunMode = s.mode === "batched" ? "pairwise" : "batched";
    set({ running: true, error: null });
    try {
      const comparison = await api.run(buildPayload(s, other));
      set({ comparison });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ running: false });
    }
  },

  selectLink: (id) => set({ selectedLinkId: id }),
}));
