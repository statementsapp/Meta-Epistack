import type { LinkType } from "./types";

// Single source of truth for the epistemics-to-visuals mapping. A richer or
// skeuomorphic re-skin changes these tokens without touching pipeline or views.
export const theme = {
  bg: "#0f1115",
  panel: "#171a21",
  panelAlt: "#1e222b",
  border: "#2a2f3a",
  text: "#e6e8ee",
  textDim: "#9aa1b0",
  accent: "#5b8cff",
  node: "#c8ccd6",
  nodeText: "#0f1115",
};

export const linkColor: Record<LinkType, string> = {
  supports: "#3fb950",
  rebuts: "#f85149",
  qualifies: "#d29922",
};

export const linkLabel: Record<LinkType, string> = {
  supports: "supports",
  rebuts: "rebuts",
  qualifies: "qualifies",
};

// Edge thickness scales with confidence; node size with degree.
export const edgeWidth = (confidence: number) => 1 + confidence * 4;
export const nodeSize = (degree: number) => 5 + Math.min(degree, 8) * 1.5;
