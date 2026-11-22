import { cachedJson } from "./cache.js";
import { graphFromBtcAddress, graphFromBtcTx, type MempoolTx } from "./btc.js";
import {
  graphFromEthAddress,
  graphFromEthTx,
  graphFromRpcTx,
  type BlockscoutInternalTx,
  type BlockscoutTx,
  type BlockscoutTxPage,
  type RpcTransaction,
} from "./eth.js";
import { mergeGraphs } from "./graph.js";
import type { DetectedQuery, FlowGraph } from "./types.js";

export const MEMPOOL_API = "https://mempool.space/api";
export const BLOCKSCOUT_API = "https://eth.blockscout.com/api/v2";
export const ETH_RPCS = ["https://ethereum.publicnode.com", "https://rpc.ankr.com/eth", "https://cloudflare-eth.com"];

export class LookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LookupError";
  }
}

export interface FetchDeps {
  fetchFn?: typeof fetch;
}

async function getJson<T>(url: string, deps: FetchDeps, key: string): Promise<T> {
  const fetchFn = deps.fetchFn ?? fetch;
  return cachedJson(key, async () => {
    const response = await fetchFn(url, { headers: { Accept: "application/json" } });
    if (response.status === 404) throw new LookupError("Nothing was found for that address or transaction.");
    if (response.status === 429) throw new LookupError("The public API is rate-limiting requests. Please wait a moment and try again.");
    if (!response.ok) throw new LookupError("The public API could not be reached. Please try again.");
    return (await response.json()) as T;
  });
}

export async function loadBtcTx(txid: string, deps: FetchDeps = {}): Promise<MempoolTx> {
  return getJson<MempoolTx>(`${MEMPOOL_API}/tx/${txid}`, deps, `btc:tx:${txid}`);
}

export async function loadBtcAddressTxs(address: string, deps: FetchDeps = {}): Promise<MempoolTx[]> {
  const data = await getJson<MempoolTx[]>(`${MEMPOOL_API}/address/${encodeURIComponent(address)}/txs`, deps, `btc:addr:${address}`);
  if (!Array.isArray(data)) throw new LookupError("The Bitcoin address response was not a transaction list.");
  return data;
}

export async function loadEthTx(hash: string, deps: FetchDeps = {}): Promise<{ tx: BlockscoutTx; internals: BlockscoutInternalTx[] }> {
  const tx = await getJson<BlockscoutTx>(`${BLOCKSCOUT_API}/transactions/${hash}`, deps, `eth:tx:${hash}`);
  if (!tx?.hash) throw new LookupError("Nothing was found for that Ethereum transaction.");
  let internals: BlockscoutInternalTx[] = [];
  try {
    const page = await getJson<{ items?: BlockscoutInternalTx[] }>(
      `${BLOCKSCOUT_API}/transactions/${hash}/internal-transactions`,
      deps,
      `eth:internal:${hash}`,
    );
    internals = Array.isArray(page.items) ? page.items.slice(0, 40) : [];
  } catch {
    internals = [];
  }
  return { tx, internals };
}

export async function loadEthAddressTxs(address: string, deps: FetchDeps = {}): Promise<BlockscoutTxPage> {
  return getJson<BlockscoutTxPage>(
    `${BLOCKSCOUT_API}/addresses/${address}/transactions`,
    deps,
    `eth:addr:${address}`,
  );
}

async function loadEthTxFromRpc(hash: string, deps: FetchDeps = {}): Promise<RpcTransaction> {
  const fetchFn = deps.fetchFn ?? fetch;
  let lastError: Error | undefined;
  for (const endpoint of ETH_RPCS) {
    try {
      const payload = await cachedJson(`eth:rpc:${endpoint}:${hash}`, async () => {
        const response = await fetchFn(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getTransactionByHash",
            params: [hash],
          }),
        });
        if (!response.ok) throw new Error("rpc http");
        return (await response.json()) as { result?: RpcTransaction | null };
      });
      if (payload.result) return payload.result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("rpc failed");
    }
  }
  throw lastError ?? new LookupError("The Ethereum transaction could not be loaded from a public RPC.");
}

export async function loadGraph(query: DetectedQuery, deps: FetchDeps = {}, alsoTry?: DetectedQuery): Promise<FlowGraph> {
  try {
    if (query.chain === "btc" && query.kind === "tx") {
      const tx = await loadBtcTx(query.value, deps);
      return graphFromBtcTx(tx, query);
    }
    if (query.chain === "btc" && query.kind === "address") {
      const txs = await loadBtcAddressTxs(query.value, deps);
      return graphFromBtcAddress(query.value, txs);
    }
    if (query.chain === "eth" && query.kind === "tx") {
      try {
        const { tx, internals } = await loadEthTx(query.value, deps);
        return graphFromEthTx(tx, internals, query);
      } catch (error) {
        if (error instanceof LookupError && /rate-limiting/.test(error.message)) throw error;
        const tx = await loadEthTxFromRpc(query.value, deps);
        const graph = graphFromRpcTx(tx, query);
        graph.warnings = [
          ...graph.warnings,
          "Blockscout was unavailable, so this transaction was loaded from a public Ethereum RPC. Internal transfers are not included.",
        ];
        return graph;
      }
    }
    const page = await loadEthAddressTxs(query.value, deps);
    if (!page || (!page.items && !Array.isArray(page))) {
      throw new LookupError("The Ethereum address history could not be loaded.");
    }
    return graphFromEthAddress(query.value, page);
  } catch (error) {
    if (alsoTry) return loadGraph(alsoTry, deps);
    if (error instanceof LookupError) throw error;
    throw new LookupError("The lookup failed. Check the address or hash and try again.");
  }
}

export async function expandAddress(graph: FlowGraph, address: string, deps: FetchDeps = {}): Promise<FlowGraph> {
  const node = graph.nodes.find((item) => item.id === address);
  if (node?.expanded) return graph;
  const query: DetectedQuery = { chain: graph.chain, kind: "address", value: address };
  const incoming = await loadGraph(query, deps);
  return mergeGraphs(graph, incoming, address);
}
