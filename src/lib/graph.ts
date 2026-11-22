import { COINBASE_ID, MAX_GRAPH_EDGES, MAX_GRAPH_NODES, type DetectedQuery, type FlowEdge, type FlowGraph, type FlowNode, type GraphFilters, type NodeRole, type Transfer } from "./types.js";

export function emptyGraph(origin: DetectedQuery, warnings: string[] = []): FlowGraph {
  return {
    chain: origin.chain,
    origin,
    nodes: [],
    edges: [],
    warnings,
    truncated: false,
    transactionCount: 0,
  };
}

export function graphFromTransfers(
  origin: DetectedQuery,
  transfers: Transfer[],
  options: { warnings?: string[]; searched?: string; txids?: string[] } = {},
): FlowGraph {
  const nodes = new Map<string, FlowNode>();
  const edges = new Map<string, FlowEdge>();
  const searched = options.searched;

  const ensure = (
    id: string,
    role: NodeRole,
    extra: { isContract?: boolean; label?: string; depth?: number },
  ): FlowNode => {
    const existing = nodes.get(id);
    if (existing) {
      existing.role = mergeRole(existing.role, role, id === searched);
      if (extra.isContract) existing.isContract = true;
      if (extra.label && !existing.label) existing.label = extra.label;
      if (extra.depth != null) existing.depth = Math.min(existing.depth, extra.depth);
      return existing;
    }
    const isSearched = id === searched;
    const node: FlowNode = {
      id,
      chain: origin.chain,
      role: isSearched ? "searched" : role,
      isContract: Boolean(extra.isContract) || role === "contract",
      depth: extra.depth ?? (isSearched ? 0 : 1),
      expanded: isSearched,
      label: extra.label,
      received: 0,
      sent: 0,
    };
    nodes.set(id, node);
    return node;
  };

  for (const transfer of transfers) {
    if (!transfer.from || !transfer.to || transfer.from === transfer.to) continue;
    const fromRole: NodeRole = transfer.from === COINBASE_ID ? "input" : "input";
    const toRole: NodeRole = transfer.toContract ? "contract" : "output";
    const from = ensure(transfer.from, fromRole, {
      isContract: transfer.fromContract,
      label: transfer.fromLabel,
      depth: transfer.from === searched ? 0 : 1,
    });
    const to = ensure(transfer.to, toRole, {
      isContract: transfer.toContract,
      label: transfer.toLabel,
      depth: transfer.to === searched ? 0 : 1,
    });
    from.sent += transfer.amount;
    to.received += transfer.amount;
    if (from.isContract && from.role !== "searched") from.role = mergeRole(from.role, "contract", false);
    if (to.isContract && to.role !== "searched") to.role = mergeRole(to.role, "contract", false);

    const edgeId = `${transfer.from}->${transfer.to}`;
    const existing = edges.get(edgeId);
    if (existing) {
      existing.amount += transfer.amount;
      if (!existing.txids.includes(transfer.txid)) existing.txids.push(transfer.txid);
    } else {
      edges.set(edgeId, {
        id: edgeId,
        source: transfer.from,
        target: transfer.to,
        amount: transfer.amount,
        txids: [transfer.txid],
        chain: origin.chain,
      });
    }
  }

  if (searched && !nodes.has(searched)) {
    ensure(searched, "searched", { depth: 0 });
  }

  return truncateGraph({
    chain: origin.chain,
    origin,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    warnings: options.warnings ?? [],
    truncated: false,
    transactionCount: new Set(options.txids ?? transfers.map((item) => item.txid)).size,
  });
}

export function mergeRole(current: NodeRole, incoming: NodeRole, isSearched: boolean): NodeRole {
  if (isSearched) return "searched";
  if (current === "searched") return "searched";
  if (current === incoming) return current;
  if (current === "both" || incoming === "both") return "both";
  if ((current === "input" && incoming === "output") || (current === "output" && incoming === "input")) {
    return "both";
  }
  if (incoming === "contract") {
    return current === "input" || current === "output" ? "both" : current;
  }
  if (current === "contract" && (incoming === "input" || incoming === "output")) return "both";
  return current;
}

export function mergeGraphs(base: FlowGraph, incoming: FlowGraph, fromNode?: string): FlowGraph {
  const nodes = new Map(base.nodes.map((node) => [node.id, { ...node }]));
  const edges = new Map(base.edges.map((edge) => [edge.id, { ...edge, txids: [...edge.txids] }]));
  const parent = fromNode ? nodes.get(fromNode) : undefined;
  const nextDepth = parent ? parent.depth + 1 : 1;

  for (const node of incoming.nodes) {
    const existing = nodes.get(node.id);
    const depth = node.id === fromNode ? (parent?.depth ?? 0) : nextDepth;
    if (!existing) {
      nodes.set(node.id, {
        ...node,
        depth,
        role: node.id === base.origin.value ? "searched" : node.role,
        expanded: node.id === fromNode ? true : node.expanded,
      });
      continue;
    }
    existing.role = mergeRole(existing.role, node.role, node.id === base.origin.value);
    existing.isContract = existing.isContract || node.isContract;
    if (node.label && !existing.label) existing.label = node.label;
    existing.depth = Math.min(existing.depth, depth);
    existing.received += node.received;
    existing.sent += node.sent;
    if (node.id === fromNode) existing.expanded = true;
  }

  for (const edge of incoming.edges) {
    const existing = edges.get(edge.id);
    if (!existing) {
      edges.set(edge.id, { ...edge, txids: [...edge.txids] });
      continue;
    }
    existing.amount += edge.amount;
    for (const txid of edge.txids) {
      if (!existing.txids.includes(txid)) existing.txids.push(txid);
    }
  }

  if (parent) parent.expanded = true;

  const warnings = [...base.warnings];
  for (const warning of incoming.warnings) {
    if (!warnings.includes(warning)) warnings.push(warning);
  }

  return truncateGraph({
    chain: base.chain,
    origin: base.origin,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    warnings,
    truncated: base.truncated || incoming.truncated,
    transactionCount: base.transactionCount + incoming.transactionCount,
  });
}

export function filterGraph(graph: FlowGraph, filters: GraphFilters): FlowGraph {
  const minAmount = Math.max(0, filters.minAmount);
  const maxDepth = Math.max(0, filters.maxDepth);
  const originId = graph.origin.kind === "address" ? graph.origin.value : undefined;

  const edges = graph.edges.filter((edge) => edge.amount >= minAmount);
  const linked = new Set<string>();
  for (const edge of edges) {
    linked.add(edge.source);
    linked.add(edge.target);
  }
  if (originId) linked.add(originId);

  const nodes = graph.nodes.filter((node) => {
    if (originId && node.id === originId) return node.depth <= maxDepth;
    return node.depth <= maxDepth && linked.has(node.id);
  });
  const ids = new Set(nodes.map((node) => node.id));
  const keptEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));

  return {
    ...graph,
    nodes,
    edges: keptEdges,
  };
}

export function truncateGraph(graph: FlowGraph): FlowGraph {
  if (graph.nodes.length <= MAX_GRAPH_NODES && graph.edges.length <= MAX_GRAPH_EDGES) {
    return graph;
  }

  const ranked = [...graph.edges].sort((a, b) => b.amount - a.amount).slice(0, MAX_GRAPH_EDGES);
  const originId = graph.origin.kind === "address" ? graph.origin.value : undefined;
  const ids = new Set<string>();
  if (originId) ids.add(originId);
  for (const edge of ranked) {
    ids.add(edge.source);
    ids.add(edge.target);
    if (ids.size >= MAX_GRAPH_NODES) break;
  }
  const nodes = graph.nodes.filter((node) => ids.has(node.id)).slice(0, MAX_GRAPH_NODES);
  const keep = new Set(nodes.map((node) => node.id));
  const edges = ranked.filter((edge) => keep.has(edge.source) && keep.has(edge.target));
  const warning = "The graph was limited to the largest flows so it stays readable.";
  const warnings = graph.warnings.includes(warning) ? graph.warnings : [...graph.warnings, warning];
  return { ...graph, nodes, edges, warnings, truncated: true };
}

export function totalsFor(graph: FlowGraph, address: string): { received: number; sent: number; counterparties: number } {
  let received = 0;
  let sent = 0;
  const counterparties = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.target === address) {
      received += edge.amount;
      counterparties.add(edge.source);
    }
    if (edge.source === address) {
      sent += edge.amount;
      counterparties.add(edge.target);
    }
  }
  return { received, sent, counterparties: counterparties.size };
}
