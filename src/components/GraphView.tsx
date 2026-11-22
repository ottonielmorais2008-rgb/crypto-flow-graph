import { useEffect, useRef } from "react";
import ForceGraph from "force-graph";
import { formatAmount, shortAddress } from "../lib/format";
import type { FlowGraph, FlowNode, NodeRole } from "../lib/types";

const ROLE_COLOR: Record<NodeRole, string> = {
  searched: "#d1f56e",
  input: "#6ec8f5",
  output: "#f5c14a",
  both: "#c9a0ff",
  contract: "#ff8a6b",
};

interface GraphNodeDatum extends FlowNode {
  name: string;
  x?: number;
  y?: number;
}

interface GraphLinkDatum {
  id: string;
  source: string | GraphNodeDatum;
  target: string | GraphNodeDatum;
  amount: number;
  txids: string[];
  label: string;
}

export type Selected =
  | { type: "node"; id: string }
  | { type: "edge"; id: string }
  | null;

interface GraphViewProps {
  graph: FlowGraph;
  selected: Selected;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
}

export function nodeColor(node: Pick<FlowNode, "role" | "isContract">): string {
  if (node.isContract && node.role !== "searched") return ROLE_COLOR.contract;
  return ROLE_COLOR[node.role] ?? "#8b93a1";
}

function paintNode(
  node: GraphNodeDatum,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  selected: Selected,
): void {
  const label = node.label || shortAddress(node.id, 4);
  const fontSize = Math.max(11 / globalScale, 2.6);
  const radius = (node.role === "searched" ? 8 : 5.5) * 0.7;
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fillStyle = nodeColor(node);
  ctx.fill();
  if (selected?.type === "node" && selected.id === node.id) {
    ctx.lineWidth = 2 / globalScale;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }
  ctx.font = `${fontSize}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#e8eaed";
  ctx.fillText(label, x, y + radius + 1);
}

export function GraphView({ graph, selected, onSelectNode, onSelectEdge }: GraphViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraph<GraphNodeDatum, GraphLinkDatum> | null>(null);
  const callbacks = useRef({ onSelectNode, onSelectEdge, selected });
  callbacks.current = { onSelectNode, onSelectEdge, selected };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const graphApi = new ForceGraph<GraphNodeDatum, GraphLinkDatum>(host)
      .backgroundColor("#08090b")
      .nodeId("id")
      .nodeLabel((node) => {
        const title = node.label || shortAddress(node.id);
        return `${title}\n${node.role}${node.isContract ? " · contract" : ""}`;
      })
      .linkLabel((link) => `${link.label} · ${link.txids.length} tx`)
      .nodeRelSize(6)
      .nodeVal((node) => (node.role === "searched" ? 8 : node.isContract ? 6 : 4))
      .nodeColor((node) => nodeColor(node))
      .linkColor(() => "rgba(209, 245, 110, 0.28)")
      .linkWidth((link) => Math.max(1, Math.min(6, Math.log10(link.amount * 1e6 + 10))))
      .linkDirectionalArrowLength(5)
      .linkDirectionalArrowRelPos(1)
      .linkDirectionalParticles(2)
      .linkDirectionalParticleWidth(1.4)
      .linkDirectionalParticleSpeed(0.004)
      .nodeCanvasObject((node, ctx, globalScale) => {
        paintNode(node, ctx, globalScale, callbacks.current.selected);
      })
      .onNodeClick((node) => {
        callbacks.current.onSelectNode(node.id);
      })
      .onLinkClick((link) => {
        if (link.id) callbacks.current.onSelectEdge(link.id);
      });

    graphRef.current = graphApi;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      graphApi.width(rect.width).height(rect.height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    return () => {
      observer.disconnect();
      graphApi._destructor();
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    const api = graphRef.current;
    if (!api) return;
    const nodes: GraphNodeDatum[] = graph.nodes.map((node) => ({
      ...node,
      name: node.label || shortAddress(node.id),
    }));
    const links: GraphLinkDatum[] = graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      amount: edge.amount,
      txids: edge.txids,
      label: formatAmount(edge.amount, graph.chain),
    }));
    api.graphData({ nodes, links });
  }, [graph]);

  useEffect(() => {
    graphRef.current?.nodeCanvasObject((node, ctx, globalScale) => {
      paintNode(node, ctx, globalScale, selected);
    });
  }, [selected]);

  return <div ref={hostRef} className="graph-canvas" role="img" aria-label="Transaction flow graph" />;
}

export { ROLE_COLOR };
