import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
// @ts-expect-error no type declarations shipped
import { forceCollide, forceX, forceY } from "d3-force-3d";
import { edgeWidth, linkColor } from "../theme";
import type { Claim, Link } from "../types";
import {
  paintNodePointerArea,
  radiusForText,
  renderLinkOverlay,
  renderNode,
  renderWarrantBoxes,
  type GraphLink,
  type GraphNode,
} from "./renderers";

interface Props {
  claims: Claim[];
  links: Link[];
  selectedLinkId: string | null;
  onSelectLink: (id: string | null) => void;
}

const ROW_GAP = 175;
const BRANCH_GAP = 330;

// Build a deterministic argument map rather than asking force physics to infer
// semantics. Support forms upward-growing trees, qualifiers sit beside the
// claim they scope, and unsupported rebutted claims occupy the final row.
function computeLayout(
  claims: Claim[],
  links: Link[]
): Record<string, { x: number; y: number }> {
  const ids = claims.map((c) => c.id);
  const supportIn = new Set(
    links.filter((l) => l.type === "supports").map((l) => l.target)
  );
  const supportOut = new Set(
    links.filter((l) => l.type === "supports").map((l) => l.source)
  );
  const rebutIn = new Set(
    links.filter((l) => l.type === "rebuts").map((l) => l.target)
  );
  const supporters = new Map<string, string[]>();
  for (const link of links.filter((l) => l.type === "supports")) {
    supporters.set(link.target, [
      ...(supporters.get(link.target) ?? []),
      link.source,
    ]);
  }

  // Rank 0 is the supported conclusion. Every supporting premise is exactly
  // one row behind the claim it strengthens.
  const rank: Record<string, number> = Object.fromEntries(
    ids.map((id) => [id, 0])
  );
  for (let pass = 0; pass < claims.length; pass++) {
    for (const link of links.filter((l) => l.type === "supports")) {
      rank[link.source] = Math.max(rank[link.source], rank[link.target] + 1);
    }
  }
  for (const link of links.filter((l) => l.type === "qualifies")) {
    rank[link.source] = rank[link.target];
  }

  const defeated = new Set(
    claims
      .filter((c) => rebutIn.has(c.id) && !supportIn.has(c.id))
      .map((c) => c.id)
  );
  const ordinaryRanks = ids
    .filter((id) => !defeated.has(id))
    .map((id) => rank[id]);
  const finalRank = (ordinaryRanks.length ? Math.max(...ordinaryRanks) : 0) + 1;
  for (const id of defeated) rank[id] = finalRank;

  const x: Record<string, number> = {};
  const roots = ids.filter((id) => supportIn.has(id) && !supportOut.has(id));

  // Recursively place support leaves, then center every strengthened claim
  // over the premises feeding it.
  roots.forEach((root, rootIndex) => {
    let leaf = 0;
    const componentX: Record<string, number> = {};
    const place = (id: string, path: Set<string>): number => {
      if (componentX[id] != null) return componentX[id];
      if (path.has(id)) return leaf++ * BRANCH_GAP;
      const children = supporters.get(id) ?? [];
      if (!children.length) {
        componentX[id] = leaf++ * BRANCH_GAP;
        return componentX[id];
      }
      const nextPath = new Set(path).add(id);
      const childXs = children.map((child) => place(child, nextPath));
      componentX[id] =
        childXs.reduce((sum, value) => sum + value, 0) / childXs.length;
      return componentX[id];
    };
    place(root, new Set());
    const values = Object.values(componentX);
    const center =
      (Math.min(...values) + Math.max(...values)) / 2 - rootIndex * 760;
    for (const [id, value] of Object.entries(componentX)) {
      x[id] = value - center;
    }
  });

  // Qualifiers are lateral annotations at the same argumentative depth.
  for (const link of links.filter((l) => l.type === "qualifies")) {
    x[link.source] = (x[link.target] ?? 0) + BRANCH_GAP;
  }

  // Put defeated claims directly below the rebutter(s): the red arrow becomes
  // a clear vertical spine, with bolstering branches visible behind it.
  for (const id of defeated) {
    const rebutters = links
      .filter((l) => l.type === "rebuts" && l.target === id)
      .map((l) => x[l.source] ?? 0);
    x[id] = rebutters.length
      ? rebutters.reduce((sum, value) => sum + value, 0) / rebutters.length
      : 0;
  }

  // Isolated claims or pure rebutters receive stable side positions.
  let orphan = 0;
  for (const id of ids) {
    if (x[id] == null) x[id] = -(++orphan) * BRANCH_GAP;
  }

  return Object.fromEntries(
    ids.map((id) => [id, { x: x[id], y: rank[id] * ROW_GAP }])
  );
}

export function GraphView({ claims, links, selectedLinkId, onSelectLink }: Props) {
  const fgRef = useRef<any>(null);
  const fittedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // ForceGraph2D defaults to *window* dimensions, which would extend the
  // canvas underneath the side panels and mis-center zoomToFit. Size it to the
  // actual container instead.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () =>
      setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Data depends only on the run result, so selecting an edge doesn't
  // re-trigger layout; selection is read inside the render callbacks.
  const data = useMemo(() => {
    const degree: Record<string, number> = {};
    for (const l of links) {
      degree[l.source] = (degree[l.source] ?? 0) + 1;
      degree[l.target] = (degree[l.target] ?? 0) + 1;
    }
    const layout = computeLayout(claims, links);
    const nodes: GraphNode[] = claims.map((c) => ({
      id: c.id,
      label: c.text,
      degree: degree[c.id] ?? 0,
      r: radiusForText(c.text),
      targetY: layout[c.id]?.y ?? 0,
      targetX: layout[c.id]?.x ?? 0,
      fx: layout[c.id]?.x ?? 0,
      fy: layout[c.id]?.y ?? 0,
    }));
    const gLinks: GraphLink[] = links.map((l) => ({
      id: l.id,
      source: l.source,
      target: l.target,
      type: l.type,
      confidence: l.confidence,
      assumption: l.assumption ?? "",
    }));
    return { nodes, links: gLinks };
  }, [claims, links]);

  useEffect(() => {
    fittedRef.current = false;
    const fg = fgRef.current;
    if (!fg) return;
    // Keep circles apart with room for type + assumption chips on edges.
    fg.d3Force("collide", forceCollide((n: GraphNode) => n.r + 36));
    fg.d3Force("charge")?.strength(-180);
    // Let links breathe horizontally but stay soft vertically — the y force
    // owns vertical placement so argumentative rank reads cleanly.
    fg.d3Force("link")?.distance(
      (l: any) => (l.source?.r ?? 30) + (l.target?.r ?? 30) + 150
    );
    fg.d3Force("x", forceX((n: GraphNode) => n.targetX).strength(0.18));
    // Snap each node toward its semantic rank; strong so tiers stay legible.
    fg.d3Force("y", forceY((n: GraphNode) => n.targetY).strength(0.5));
    fg.d3ReheatSimulation?.();

    // Preliminary fit while physics settle; onEngineStop does the final,
    // authoritative fit once the vertical tiers have locked in.
    const timer = setTimeout(() => {
      fgRef.current?.zoomToFit(400, 60);
    }, 1200);
    return () => clearTimeout(timer);
  }, [data, size]);

  const zoomToFit = () => {
    fgRef.current?.zoomToFit(400, 60);
    fittedRef.current = true;
  };

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      {size.width > 0 ? (
        <ForceGraph2D
          ref={fgRef}
          width={size.width}
          height={size.height}
          graphData={data}
          nodeId="id"
          nodeRelSize={1}
          nodeVal={(n: any) => n.r * n.r}
          nodeCanvasObject={renderNode as any}
          nodePointerAreaPaint={paintNodePointerArea as any}
          linkColor={(l: any) => linkColor[l.type as keyof typeof linkColor]}
          linkWidth={(l: any) =>
            edgeWidth(l.confidence) * (l.id === selectedLinkId ? 1.6 : 1)
          }
          linkLineDash={(l: any) => (l.type === "qualifies" ? [6, 5] : null)}
          // Straight for every type: warrant placement tests edges as
          // segments, so a curve would let a label land on a line it isn't
          // describing. Qualifiers stay distinct via dashes + lateral rank.
          linkCurvature={0}
          linkDirectionalArrowLength={(l: any) =>
            l.type === "qualifies" ? 0 : 20
          }
          linkDirectionalArrowRelPos={0.86}
          linkCanvasObjectMode={() => "after"}
          linkCanvasObject={(l: any, ctx: any, scale: number) =>
            renderLinkOverlay(l, ctx, scale, l.id === selectedLinkId)
          }
          onRenderFramePost={(ctx: any, scale: number) =>
            renderWarrantBoxes(data.links, ctx, scale, selectedLinkId)
          }
          onLinkClick={(l: any) => onSelectLink(l.id)}
          onBackgroundClick={() => onSelectLink(null)}
          backgroundColor="rgba(0,0,0,0)"
          cooldownTicks={100}
          onEngineStop={zoomToFit}
        />
      ) : null}
    </div>
  );
}
