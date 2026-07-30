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
  type GraphLink,
  type GraphNode,
} from "./renderers";

interface Props {
  claims: Claim[];
  links: Link[];
  selectedLinkId: string | null;
  onSelectLink: (id: string | null) => void;
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
    const nodes: GraphNode[] = claims.map((c) => ({
      id: c.id,
      label: c.text,
      degree: degree[c.id] ?? 0,
      r: radiusForText(c.text),
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
    fg.d3Force("collide", forceCollide((n: GraphNode) => n.r + 14));
    fg.d3Force("charge")?.strength(-90);
    fg.d3Force("link")?.distance(
      (l: any) => (l.source?.r ?? 30) + (l.target?.r ?? 30) + 95
    );
    fg.d3Force("x", forceX(0).strength(0.05));
    fg.d3Force("y", forceY(0).strength(0.05));
    fg.d3ReheatSimulation?.();

    const timer = setTimeout(() => {
      fgRef.current?.zoomToFit(400, 50);
      fittedRef.current = true;
    }, 2200);
    return () => clearTimeout(timer);
  }, [data, size]);

  const zoomToFit = () => {
    if (!fittedRef.current && fgRef.current) {
      fgRef.current.zoomToFit(400, 50);
      fittedRef.current = true;
    }
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
          linkDirectionalArrowLength={12}
          linkDirectionalArrowRelPos={1}
          linkCanvasObjectMode={() => "after"}
          linkCanvasObject={(l: any, ctx: any, scale: number) =>
            renderLinkOverlay(l, ctx, scale, l.id === selectedLinkId)
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
