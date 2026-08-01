import type { LinkType } from "./types";

// Single source of truth for the epistemics-to-visuals mapping. A richer or
// skeuomorphic re-skin changes these tokens without touching pipeline or views.
export const theme = {
  bg: "#151a24",
  panel: "#1c2433",
  panelAlt: "#243044",
  border: "#354560",
  text: "#e8ecf5",
  textDim: "#a4b0c4",
  accent: "#7aa6ff",
  node: "#c8ccd6",
  nodeText: "#151a24",
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
