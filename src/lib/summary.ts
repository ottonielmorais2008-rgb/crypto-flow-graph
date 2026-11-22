import { formatAmount, shortAddress } from "./format.js";
import { totalsFor } from "./graph.js";
import type { FlowGraph } from "./types.js";

export const MAX_SUMMARY_CHARS = 8_000;

export interface GraphSummary {
  chain: "btc" | "eth";
  origin: { kind: "address" | "tx"; value: string };
  nodeCount: number;
  edgeCount: number;
  transactionCount: number;
  truncated: boolean;
  warnings: string[];
  originTotals?: { received: string; sent: string; counterparties: number };
  nodes: { id: string; short: string; role: string; isContract: boolean; label?: string; depth: number }[];
  topFlows: { from: string; to: string; amount: string; txCount: number }[];
}

export function summarizeGraph(graph: FlowGraph, limit = 18): GraphSummary {
  const originId = graph.origin.kind === "address" ? graph.origin.value : undefined;
  const totals = originId ? totalsFor(graph, originId) : undefined;
  const ranked = [...graph.edges].sort((a, b) => b.amount - a.amount).slice(0, limit);
  const used = new Set<string>();
  if (originId) used.add(originId);
  for (const edge of ranked) {
    used.add(edge.source);
    used.add(edge.target);
  }
  const nodes = graph.nodes
    .filter((node) => used.has(node.id))
    .map((node) => ({
      id: node.id,
      short: shortAddress(node.id),
      role: node.role,
      isContract: node.isContract,
      label: node.label,
      depth: node.depth,
    }));

  return {
    chain: graph.chain,
    origin: graph.origin,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    transactionCount: graph.transactionCount,
    truncated: graph.truncated,
    warnings: graph.warnings,
    originTotals: totals
      ? {
          received: formatAmount(totals.received, graph.chain),
          sent: formatAmount(totals.sent, graph.chain),
          counterparties: totals.counterparties,
        }
      : undefined,
    nodes,
    topFlows: ranked.map((edge) => ({
      from: shortAddress(edge.source),
      to: shortAddress(edge.target),
      amount: formatAmount(edge.amount, graph.chain),
      txCount: edge.txids.length,
    })),
  };
}

export function serializeSummary(graph: FlowGraph): string {
  return JSON.stringify(summarizeGraph(graph));
}
