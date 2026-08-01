import { linkColor } from "../theme";
import type { LinkType } from "../types";

// Swappable renderers. These are the simple day-one implementations; a richer
// "claim card / string link" set can replace them without touching GraphView.

export interface GraphNode {
  id: string;
  label: string;
  degree: number;
  r: number;
  // Vertical rank from argumentative standing (rebutted sinks, support lifts).
  targetY: number;
  // Horizontal column: attack/rebuttal subsystem vs support subsystem.
  targetX: number;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
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
  return Math.min(64, 20 + Math.sqrt(text.length) * 3);
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
  ctx.fillStyle = "#1c2433";
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

// Per-link "after" pass: selection highlight only. Warrant boxes are drawn in
// a frame-post pass (renderWarrantBoxes) so node circles can't cover them.
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
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draw every complete warrant above the graph. Selection changes emphasis,
// never visibility.
export function renderWarrantBoxes(
  links: GraphLink[],
  ctx: CanvasRenderingContext2D,
  scale: number,
  selectedLinkId: string | null
) {
  const typeSize = 9.5 / scale;
  const assumpSize = 8.5 / scale;
  const pad = 5 / scale;
  const maxW = 96 / scale;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  type Box = { x: number; y: number; w: number; h: number };
  const occupied: Box[] = [];
  const overlaps = (a: Box, b: Box, gap = 5 / scale) =>
    a.x < b.x + b.w + gap &&
    a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap &&
    a.y + a.h + gap > b.y;

  // Liang–Barsky: does a segment touch the box? Used to keep a warrant off
  // edges it doesn't describe, which would otherwise make it ambiguous.
  const crosses = (
    box: Box,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    let t0 = 0;
    let t1 = 1;
    const edges: [number, number][] = [
      [-dx, x1 - box.x],
      [dx, box.x + box.w - x1],
      [-dy, y1 - box.y],
      [dy, box.y + box.h - y1],
    ];
    for (const [p, q] of edges) {
      if (p === 0) {
        if (q < 0) return false;
        continue;
      }
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
    return true;
  };

  const segments = links
    .filter((l) => (l.source as GraphNode).x != null)
    .map((l) => ({
      id: l.id,
      x1: (l.source as GraphNode).x!,
      y1: (l.source as GraphNode).y!,
      x2: (l.target as GraphNode).x!,
      y2: (l.target as GraphNode).y!,
    }));

  // Reserve claim circles so warrants do not obscure their text.
  const seenNodes = new Set<GraphNode>();
  for (const link of links) {
    for (const node of [link.source as GraphNode, link.target as GraphNode]) {
      if (seenNodes.has(node) || node.x == null || node.y == null) continue;
      seenNodes.add(node);
      occupied.push({
        x: node.x - node.r,
        y: node.y - node.r,
        w: node.r * 2,
        h: node.r * 2,
      });
    }
  }

  // Draw selected warrant last so it remains on top. Candidates hug the box's
  // own edge: centred on it first, then just beside it, so a warrant is never
  // parked somewhere ambiguous between two unrelated claims.
  const ordered = [
    ...links.filter((l) => l.id !== selectedLinkId),
    ...links.filter((l) => l.id === selectedLinkId),
  ];

  ordered.forEach((link) => {
    const s = link.source as GraphNode;
    const t = link.target as GraphNode;
    if (s.x == null || t.x == null) return;

    const dx = t.x! - s.x;
    const dy = t.y! - s.y!;
    const len = Math.hypot(dx, dy) || 1;
    const selected = link.id === selectedLinkId;

    ctx.font = `600 ${typeSize}px "Segoe UI", sans-serif`;
    const typeW = ctx.measureText(link.type).width;

    ctx.font = `${assumpSize}px "Segoe UI", sans-serif`;
    const assumpLines = link.assumption
      ? wrapLabel(ctx, link.assumption, maxW)
      : [];
    const assumpW = assumpLines.length
      ? Math.max(...assumpLines.map((l) => ctx.measureText(l).width))
      : 0;

    const boxW = Math.max(typeW, assumpW) + pad * 2;
    const typeH = typeSize * 1.35;
    const assumpH = assumpLines.length * assumpSize * 1.3;
    const boxH = typeH + (assumpLines.length ? assumpH + pad * 0.6 : 0) + pad;

    // Perpendicular to the edge, in world units.
    const nx = -dy / len;
    const ny = dx / len;
    const clear = 12 / scale;
    const sideStep = boxW / 2 + clear;

    type Candidate = { box: Box; ax: number; ay: number };
    const candidates: Candidate[] = [];
    for (const along of [0.5, 0.42, 0.58, 0.34, 0.66]) {
      const ax = s.x + dx * along;
      const ay = s.y! + dy * along;
      for (const offset of [
        0,
        sideStep,
        -sideStep,
        sideStep + boxW,
        -(sideStep + boxW),
      ]) {
        candidates.push({
          box: {
            x: ax + nx * offset - boxW / 2,
            y: ay + ny * offset - boxH / 2,
            w: boxW,
            h: boxH,
          },
          ax,
          ay,
        });
      }
    }

    // Penalty: overlapping a claim/warrant, or straddling a foreign edge.
    const cost = (candidate: Candidate) =>
      occupied.filter((placed) => overlaps(candidate.box, placed)).length * 2 +
      segments.filter(
        (seg) =>
          seg.id !== link.id &&
          crosses(candidate.box, seg.x1, seg.y1, seg.x2, seg.y2)
      ).length;

    const chosen =
      candidates.find((candidate) => cost(candidate) === 0) ??
      candidates.reduce((best, candidate) =>
        cost(candidate) < cost(best) ? candidate : best
      );
    occupied.push(chosen.box);
    const mx = chosen.box.x + chosen.box.w / 2;
    const my = chosen.box.y + chosen.box.h / 2;

    // Leader from the edge to the box, so an offset warrant still reads as
    // belonging to that specific relation. Box fill covers the inner half.
    if (Math.hypot(mx - chosen.ax, my - chosen.ay) > boxW * 0.3) {
      ctx.beginPath();
      ctx.moveTo(chosen.ax, chosen.ay);
      ctx.lineTo(mx, my);
      ctx.strokeStyle = linkColor[link.type];
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 0.7 / scale;
      ctx.setLineDash([3 / scale, 2 / scale]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    roundRect(ctx, mx - boxW / 2, my - boxH / 2, boxW, boxH, 4 / scale);
    ctx.fillStyle = "rgba(13, 15, 19, 0.94)";
    ctx.fill();
    ctx.lineWidth = (selected ? 1.6 : 0.9) / scale;
    ctx.strokeStyle = selected ? "#ffffff" : linkColor[link.type];
    ctx.stroke();

    let y = my - boxH / 2 + pad / 2 + typeH / 2;
    ctx.font = `600 ${typeSize}px "Segoe UI", sans-serif`;
    ctx.fillStyle = linkColor[link.type];
    ctx.fillText(link.type, mx, y);

    if (assumpLines.length) {
      y += typeH / 2 + pad * 0.4 + assumpSize * 0.65;
      ctx.font = `${assumpSize}px "Segoe UI", sans-serif`;
      ctx.fillStyle = "#d0d4de";
      for (const line of assumpLines) {
        ctx.fillText(line, mx, y);
        y += assumpSize * 1.3;
      }
    }
  });
}
