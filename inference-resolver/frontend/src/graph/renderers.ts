import { linkColor } from "../theme";
import type { LinkType } from "../types";

// Swappable renderers. These are the simple day-one implementations; a richer
// "claim card / string link" set can replace them without touching GraphView.

export interface GraphNode {
  id: string;
  label: string;
  degree: number;
  r: number;
  x?: number;
  y?: number;
  __fit?: { fontSize: number; lines: string[]; forText: string };
}

export interface GraphLink {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  type: LinkType;
  confidence: number;
  assumption: string;
}

// Circle radius (world units) grows with text length so the label fits at a
// readable size.
export function radiusForText(text: string): number {
  return Math.min(52, 16 + Math.sqrt(text.length) * 2.6);
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Finds the largest font size whose wrapped text — including the claim id
// line — fits inside a square fully inscribed in the circle (side 1.3r, so
// corners stay well within the rim); caches the result per node.
function fitText(
  ctx: CanvasRenderingContext2D,
  node: GraphNode
): { fontSize: number; lines: string[] } {
  if (node.__fit && node.__fit.forText === node.label) return node.__fit;

  const box = node.r * 1.3;
  let result: { fontSize: number; lines: string[] } | null = null;

  for (let f = 8; f >= 2; f -= 0.25) {
    ctx.font = `${f}px "Segoe UI", sans-serif`;
    const lines = wrapText(ctx, node.label, box);
    const idHeight = f * 0.75 * 1.4;
    const height = idHeight + lines.length * f * 1.22;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (height <= box && widest <= box) {
      result = { fontSize: f, lines };
      break;
    }
  }

  if (!result) {
    // Extreme fallback: truncate at minimum font.
    const f = 2;
    ctx.font = `${f}px "Segoe UI", sans-serif`;
    const lines = wrapText(ctx, node.label, box);
    const maxLines = Math.floor((box - f * 1.05) / (f * 1.22));
    const cut = lines.slice(0, Math.max(1, maxLines));
    if (cut.length < lines.length) cut[cut.length - 1] += "…";
    result = { fontSize: f, lines: cut };
  }

  node.__fit = { ...result, forText: node.label };
  return result;
}

export function renderNode(
  node: GraphNode,
  ctx: CanvasRenderingContext2D,
  scale: number
) {
  ctx.beginPath();
  ctx.arc(node.x!, node.y!, node.r, 0, 2 * Math.PI);
  ctx.fillStyle = "#c9cdd7";
  ctx.fill();
  ctx.lineWidth = 1.5 / scale;
  ctx.strokeStyle = "#3a4150";
  ctx.stroke();

  const { fontSize, lines } = fitText(ctx, node);
  const lineHeight = fontSize * 1.22;
  const idSize = fontSize * 0.75;
  const idHeight = idSize * 1.4;
  const totalH = idHeight + lines.length * lineHeight;
  const top = node.y! - totalH / 2;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Claim id as the first line of the centered block.
  ctx.font = `700 ${idSize}px "Segoe UI", sans-serif`;
  ctx.fillStyle = "#4a6bd4";
  ctx.fillText(node.id, node.x!, top + idHeight / 2);

  ctx.font = `${fontSize}px "Segoe UI", sans-serif`;
  ctx.fillStyle = "#171a21";
  let y = top + idHeight + lineHeight / 2;
  for (const line of lines) {
    ctx.fillText(line, node.x!, y);
    y += lineHeight;
  }
}

export function paintNodePointerArea(
  node: GraphNode,
  color: string,
  ctx: CanvasRenderingContext2D
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(node.x!, node.y!, node.r, 0, 2 * Math.PI);
  ctx.fill();
}

function wrapLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  else if (line && lines.length === maxLines) {
    lines[lines.length - 1] =
      lines[lines.length - 1].replace(/\s+\S*$/, "") + "…";
  }
  return lines;
}

// Drawn after the built-in link line/arrow: type chip + assumption warrant.
export function renderLinkOverlay(
  link: GraphLink,
  ctx: CanvasRenderingContext2D,
  scale: number,
  selected: boolean
) {
  const s = link.source as GraphNode;
  const t = link.target as GraphNode;
  if (s.x == null || t.x == null) return;

  if (selected) {
    ctx.beginPath();
    ctx.moveTo(s.x, s.y!);
    ctx.lineTo(t.x!, t.y!);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2 / scale;
    ctx.setLineDash([4 / scale, 3 / scale]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const mx = (s.x + t.x!) / 2;
  const my = (s.y! + t.y!) / 2;
  const typeSize = 10 / scale;
  const assumpSize = 9 / scale;
  const pad = 4 / scale;
  const maxW = 140 / scale;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${typeSize}px "Segoe UI", sans-serif`;
  const typeW = ctx.measureText(link.type).width;

  ctx.font = `${assumpSize}px "Segoe UI", sans-serif`;
  const assumpLines = link.assumption
    ? wrapLabel(ctx, link.assumption, maxW, 3)
    : [];
  const assumpW = assumpLines.length
    ? Math.max(...assumpLines.map((l) => ctx.measureText(l).width))
    : 0;
  const boxW = Math.max(typeW, assumpW) + pad * 2;
  const typeH = typeSize * 1.3;
  const assumpH = assumpLines.length * assumpSize * 1.25;
  const boxH = typeH + (assumpLines.length ? assumpH + pad * 0.5 : 0) + pad;

  ctx.fillStyle = "rgba(13, 15, 19, 0.88)";
  ctx.fillRect(mx - boxW / 2, my - boxH / 2, boxW, boxH);

  let y = my - boxH / 2 + pad / 2 + typeH / 2;
  ctx.font = `600 ${typeSize}px "Segoe UI", sans-serif`;
  ctx.fillStyle = linkColor[link.type];
  ctx.fillText(link.type, mx, y);

  if (assumpLines.length) {
    y += typeH / 2 + pad * 0.4 + assumpSize * 0.6;
    ctx.font = `${assumpSize}px "Segoe UI", sans-serif`;
    ctx.fillStyle = "#d0d4de";
    for (const line of assumpLines) {
      ctx.fillText(line, mx, y);
      y += assumpSize * 1.25;
    }
  }
}
