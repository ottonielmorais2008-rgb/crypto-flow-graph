import { afterEach, describe, expect, it, vi } from "vitest";
import { resetCache } from "../src/lib/cache.js";
import { loadGraph, LookupError, MEMPOOL_API, BLOCKSCOUT_API } from "../src/lib/fetch-data.js";

afterEach(() => {
  resetCache();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

describe("loadGraph", () => {
  it("builds a Bitcoin transaction graph from a mempool.space payload", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toBe(`${MEMPOOL_API}/tx/abcd`);
      return jsonResponse({
        txid: "abcd",
        vin: [{ prevout: { scriptpubkey_address: "fromA", value: 200_000 } }],
        vout: [{ scriptpubkey_address: "toB", value: 180_000 }],
      });
    });
    const graph = await loadGraph({ chain: "btc", kind: "tx", value: "abcd" }, { fetchFn });
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.source).toBe("fromA");
    expect(graph.edges[0]?.target).toBe("toB");
  });

  it("builds an Ethereum address graph from Blockscout and documents the RPC limit", async () => {
    const address = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toBe(`${BLOCKSCOUT_API}/addresses/${address}/transactions`);
      return jsonResponse({
        items: [
          {
            hash: "0x1",
            from: { hash: "0x1111111111111111111111111111111111111111" },
            to: { hash: address },
            value: "1000000000000000000",
          },
        ],
      });
    });
    const graph = await loadGraph({ chain: "eth", kind: "address", value: address }, { fetchFn });
    expect(graph.edges).toHaveLength(1);
    expect(graph.warnings.join(" ")).toMatch(/Blockscout/);
  });

  it("maps 404 and 429 responses to clear errors", async () => {
    const notFound: typeof fetch = async () => jsonResponse({ error: "missing" }, 404);
    await expect(loadGraph({ chain: "btc", kind: "tx", value: "00".repeat(32) }, { fetchFn: notFound })).rejects.toBeInstanceOf(
      LookupError,
    );
    const limited: typeof fetch = async () => jsonResponse({ error: "slow down" }, 429);
    await expect(loadGraph({ chain: "btc", kind: "address", value: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" }, { fetchFn: limited })).rejects.toThrow(
      /rate-limiting/,
    );
  });

  it("falls back from a failed Bitcoin lookup to the optional Ethereum hash", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("mempool.space")) return jsonResponse({}, 404);
      if (url.includes("/internal-transactions")) return jsonResponse({ items: [] });
      if (url.includes("/transactions/0xabcd")) {
        return jsonResponse({
          hash: "0xabcd",
          from: { hash: "0x1111111111111111111111111111111111111111" },
          to: { hash: "0x2222222222222222222222222222222222222222" },
          value: "1000000000000000000",
        });
      }
      return jsonResponse({}, 500);
    });
    const graph = await loadGraph(
      { chain: "btc", kind: "tx", value: "abcd" },
      { fetchFn },
      { chain: "eth", kind: "tx", value: "0xabcd" },
    );
    expect(graph.chain).toBe("eth");
    expect(graph.edges[0]?.amount).toBe(1);
  });
});
