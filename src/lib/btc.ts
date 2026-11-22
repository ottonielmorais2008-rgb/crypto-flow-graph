import { satsToBtc } from "./format.js";
import { graphFromTransfers } from "./graph.js";
import { ADDRESS_TX_PAGE, COINBASE_ID, type DetectedQuery, type FlowGraph, type Transfer } from "./types.js";

export interface MempoolPrevout {
  scriptpubkey_address?: string;
  value?: number;
}

export interface MempoolVin {
  txid?: string;
  prevout?: MempoolPrevout;
  is_coinbase?: boolean;
}

export interface MempoolVout {
  scriptpubkey_address?: string;
  value?: number;
  scriptpubkey_type?: string;
}

export interface MempoolTx {
  txid: string;
  vin?: MempoolVin[];
  vout?: MempoolVout[];
  fee?: number;
  status?: { confirmed?: boolean; block_height?: number };
}

interface Participant {
  address: string;
  value: number;
}

export function transfersFromBtcTx(tx: MempoolTx): Transfer[] {
  const txid = tx.txid;
  if (!txid) return [];

  const inputs: Participant[] = [];
  for (const vin of tx.vin ?? []) {
    if (vin.is_coinbase || !vin.prevout) {
      const already = inputs.find((item) => item.address === COINBASE_ID);
      if (already) continue;
      inputs.push({ address: COINBASE_ID, value: 0 });
      continue;
    }
    const address = vin.prevout.scriptpubkey_address;
    const value = vin.prevout.value ?? 0;
    if (!address || value < 0) continue;
    const existing = inputs.find((item) => item.address === address);
    if (existing) existing.value += value;
    else inputs.push({ address, value });
  }

  const outputs: Participant[] = [];
  for (const vout of tx.vout ?? []) {
    const address = vout.scriptpubkey_address;
    const value = vout.value ?? 0;
    if (!address || value <= 0) continue;
    const existing = outputs.find((item) => item.address === address);
    if (existing) existing.value += value;
    else outputs.push({ address, value });
  }

  const outputTotal = outputs.reduce((sum, item) => sum + item.value, 0);
  if (outputTotal <= 0 || outputs.length === 0) return [];

  const coinbase = inputs.length === 1 && inputs[0]?.address === COINBASE_ID;
  if (coinbase) {
    return outputs.map((output) => ({
      from: COINBASE_ID,
      to: output.address,
      amount: satsToBtc(output.value),
      txid,
      chain: "btc" as const,
    }));
  }

  const spendable = inputs.filter((item) => item.address !== COINBASE_ID && item.value > 0);
  const inputTotal = spendable.reduce((sum, item) => sum + item.value, 0);
  if (inputTotal <= 0 || spendable.length === 0) return [];

  const inputIds = new Set(spendable.map((item) => item.address));
  const external = outputs.filter((item) => !inputIds.has(item.address));
  if (external.length === 0) return [];

  const transfers: Transfer[] = [];
  for (const input of spendable) {
    for (const output of external) {
      const amount = satsToBtc((input.value * output.value) / inputTotal);
      if (amount <= 0) continue;
      transfers.push({
        from: input.address,
        to: output.address,
        amount,
        txid,
        chain: "btc",
      });
    }
  }
  return transfers;
}

export function transfersFromBtcAddress(_address: string, txs: MempoolTx[]): Transfer[] {
  return txs.flatMap((tx) => transfersFromBtcTx(tx));
}

export function graphFromBtcTx(tx: MempoolTx, origin?: DetectedQuery): FlowGraph {
  const query = origin ?? { chain: "btc" as const, kind: "tx" as const, value: tx.txid };
  return graphFromTransfers(query, transfersFromBtcTx(tx), { txids: [tx.txid] });
}

export function graphFromBtcAddress(address: string, txs: MempoolTx[]): FlowGraph {
  const page = txs.slice(0, ADDRESS_TX_PAGE);
  const warnings: string[] = [];
  if (txs.length >= ADDRESS_TX_PAGE) {
    warnings.push(
      "Only the most recent transactions returned by mempool.space are shown. Click an address to load more of its recent activity.",
    );
  }
  return graphFromTransfers(
    { chain: "btc", kind: "address", value: address },
    transfersFromBtcAddress(address, page),
    { searched: address, warnings, txids: page.map((tx) => tx.txid) },
  );
}
