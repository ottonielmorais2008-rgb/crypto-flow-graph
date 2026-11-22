
import { describe, expect, it } from "vitest";
import { graphFromBtcTx, type MempoolTx } from "../src/lib/btc.js";
import { graphFromEthAddress } from "../src/lib/eth.js";
import { filterGraph, mergeGraphs, mergeRole, totalsFor, truncateGraph } from "../src/lib/graph.js";
import { MAX_GRAPH_EDGES, type FlowEdge, type FlowGraph, type FlowNode } from "../src/lib/types.js";

const fanout: MempoolTx = {
  txid: "fan-out",
  vin: [{ prevout: { scriptpubkey_address: "sender", value: 1_000_000 } }],
  vout: [
    { scriptpubkey_address: "a1", value: 100_000 },
    { scriptpubkey_address: "a2", value: 200_000 },
    { scriptpubkey_address: "a3", value: 700_000 },
  ],
};

function stubGraph(edges: Array<[string, string, number]>, origin = "hub"): FlowGraph {
  const nodes = new Map<string, FlowNode>();
  const flowEdges: FlowEdge[] = [];
  const add = (id: string, depth: number): void => {
    if (nodes.has(id)) return;
    nodes.set(id, {
      id,
      chain: "btc",
      role: id === origin ? "searched" : "output",
      isContract: false,
      depth,
      expanded: id === origin,
      received: 0,
      sent: 0,
    });
  };
  add(origin, 0);
  for (const [source, target, amount] of edges) {
    add(source, source === origin ? 0 : 1);
    add(target, target === origin ? 0 : 1);
    flowEdges.push({
      id: `${source}->${target}`,
      source,
      target,
      amount,
      txids: ["t"],
      chain: "btc",
    });
  }
  return {
    chain: "btc",
    origin: { chain: "btc", kind: "address", value: origin },
    nodes: [...nodes.values()],
    edges: flowEdges,
    warnings: [],
    truncated: false,
    transactionCount: 1,
  };
}

describe("graph building and filters", () => {
  it("assigns input and output roles and sums the largest sink", () => {
    const graph = graphFromBtcTx(fanout);
    const sender = graph.nodes.find((node) => node.id === "sender")!;
    const sink = graph.nodes.find((node) => node.id === "a3")!;
    expect(sender.role).toBe("input");
    expect(sink.role).toBe("output");
    expect(sink.received).toBeCloseTo(0.007, 8);
    expect(totalsFor(graph, "sender").sent).toBeCloseTo(0.01, 8);
    expect(totalsFor(graph, "sender").counterparties).toBe(3);
  });

  it("filters edges below the minimum amount and drops orphaned nodes", () => {
    const graph = graphFromBtcTx(fanout);
    const filtered = filterGraph(graph, { minAmount: 0.005, maxDepth: 3 });
    expect(filtered.edges).toHaveLength(1);
    expect(filtered.edges[0]?.target).toBe("a3");
    expect(filtered.nodes.map((node) => node.id).sort()).toEqual(["a3", "sender"]);
  });

  it("hides nodes beyond the depth limit but keeps the origin", () => {
    const graph = stubGraph([["hub", "near", 1], ["hub", "far", 1]]);
    const far = graph.nodes.find((node) => node.id === "far")!;
    far.depth = 2;
    const filtered = filterGraph(graph, { minAmount: 0, maxDepth: 1 });
    expect(filtered.nodes.some((node) => node.id === "hub")).toBe(true);
    expect(filtered.nodes.some((node) => node.id === "far")).toBe(false);
    expect(filtered.edges).toHaveLength(1);
  });

  it("merges an expanded address and marks it expanded", () => {
    const base = graphFromBtcTx(fanout);
    const extra = graphFromEthAddress("a3", {
      items: [
        {
          hash: "0xexp",
          from: { hash: "a3" },
          to: { hash: "0x4444444444444444444444444444444444444444" },
          value: "1000000000000000000",
        },
      ],
    });
    // Re-tag extra as btc-shaped addresses by merging another btc graph instead.
    const more: MempoolTx = {
      txid: "expand",
      vin: [{ prevout: { scriptpubkey_address: "a3", value: 800_000 } }],
      vout: [{ scriptpubkey_address: "a4", value: 800_000 }],
    };
    const incoming = graphFromBtcTx(more, { chain: "btc", kind: "address", value: "a3" });
    const merged = mergeGraphs(base, incoming, "a3");
    expect(merged.nodes.some((node) => node.id === "a4")).toBe(true);
    expect(merged.nodes.find((node) => node.id === "a3")?.expanded).toBe(true);
    expect(merged.nodes.find((node) => node.id === "a4")?.depth).toBe(2);
    expect(extra.origin.chain).toBe("eth");
  });

  it("truncates large graphs to the biggest flows", () => {
    const edges: Array<[string, string, number]> = [];
    for (let i = 0; i < MAX_GRAPH_EDGES + 20; i += 1) {
      edges.push(["hub", `n${i}`, i + 1]);
    }
    const truncated = truncateGraph(stubGraph(edges));
    expect(truncated.truncated).toBe(true);
    expect(truncated.edges.length).toBeLessThanOrEqual(MAX_GRAPH_EDGES);
    expect(truncated.warnings.join(" ")).toMatch(/largest flows/);
    const amounts = truncated.edges.map((edge) => edge.amount);
    expect(Math.min(...amounts)).toBeGreaterThan(20);
  });

  it("merges complementary roles into both", () => {
    expect(mergeRole("input", "output", false)).toBe("both");
    expect(mergeRole("output", "input", false)).toBe("both");
    expect(mergeRole("input", "output", true)).toBe("searched");
    expect(mergeRole("searched", "contract", false)).toBe("searched");
  });
});
