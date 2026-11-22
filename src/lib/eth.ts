import { weiToEth } from "./format.js";
import { graphFromTransfers } from "./graph.js";
import { ADDRESS_TX_PAGE, type DetectedQuery, type FlowGraph, type Transfer } from "./types.js";

export interface BlockscoutAddress {
  hash?: string;
  is_contract?: boolean;
  ens_domain_name?: string | null;
  name?: string | null;
}

export interface BlockscoutTx {
  hash?: string;
  from?: BlockscoutAddress | null;
  to?: BlockscoutAddress | null;
  value?: string;
  status?: string;
  created_contract?: BlockscoutAddress | null;
}

export interface BlockscoutTxPage {
  items?: BlockscoutTx[];
  next_page_params?: unknown;
}

export interface BlockscoutInternalTx {
  from?: BlockscoutAddress | null;
  to?: BlockscoutAddress | null;
  value?: string;
  transaction_hash?: string;
  type?: string;
}

export interface RpcTransaction {
  hash?: string;
  from?: string;
  to?: string | null;
  value?: string;
}

function labelOf(account?: BlockscoutAddress | null): string | undefined {
  const ens = account?.ens_domain_name?.trim();
  if (ens) return ens;
  const name = account?.name?.trim();
  if (name) return name;
  return undefined;
}

function hashOf(account?: BlockscoutAddress | null): string | undefined {
  const hash = account?.hash?.trim();
  return hash ? hash.toLowerCase() : undefined;
}

export function transferFromEthTx(tx: BlockscoutTx, options: { includeZero?: boolean } = {}): Transfer | null {
  const txid = tx.hash?.trim().toLowerCase();
  const from = hashOf(tx.from);
  const created = hashOf(tx.created_contract);
  const to = hashOf(tx.to) ?? created;
  if (!txid || !from || !to || from.toLowerCase() === to.toLowerCase()) return null;
  const amount = weiToEth(tx.value ?? "0");
  if (amount <= 0 && !options.includeZero) return null;
  return {
    from,
    to,
    amount,
    txid,
    chain: "eth",
    fromContract: Boolean(tx.from?.is_contract),
    toContract: Boolean(tx.to?.is_contract) || Boolean(created),
    fromLabel: labelOf(tx.from),
    toLabel: labelOf(tx.to) ?? labelOf(tx.created_contract),
  };
}

export function transfersFromEthInternals(txid: string, items: BlockscoutInternalTx[]): Transfer[] {
  const transfers: Transfer[] = [];
  for (const item of items) {
    const from = hashOf(item.from);
    const to = hashOf(item.to);
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) continue;
    const amount = weiToEth(item.value ?? "0");
    if (amount <= 0) continue;
    transfers.push({
      from,
      to,
      amount,
      txid: item.transaction_hash?.trim() || txid,
      chain: "eth",
      fromContract: Boolean(item.from?.is_contract),
      toContract: Boolean(item.to?.is_contract),
      fromLabel: labelOf(item.from),
      toLabel: labelOf(item.to),
    });
  }
  return transfers;
}

export function transfersFromEthAddress(items: BlockscoutTx[]): Transfer[] {
  const transfers: Transfer[] = [];
  for (const tx of items) {
    const transfer = transferFromEthTx(tx, { includeZero: false });
    if (transfer) transfers.push(transfer);
  }
  return transfers;
}

export function graphFromEthTx(
  tx: BlockscoutTx,
  internals: BlockscoutInternalTx[] = [],
  origin?: DetectedQuery,
): FlowGraph {
  const txid = tx.hash ?? origin?.value ?? "";
  const query = origin ?? { chain: "eth" as const, kind: "tx" as const, value: txid.toLowerCase() };
  const transfers = [
    ...[transferFromEthTx(tx, { includeZero: true })].filter((item): item is Transfer => Boolean(item)),
    ...transfersFromEthInternals(txid, internals),
  ];
  return graphFromTransfers(query, transfers, { txids: [txid] });
}

export function graphFromEthAddress(address: string, page: BlockscoutTxPage | BlockscoutTx[]): FlowGraph {
  const searched = address.toLowerCase();
  const items = Array.isArray(page) ? page : (page.items ?? []);
  const sliced = items.slice(0, ADDRESS_TX_PAGE);
  const warnings: string[] = [];
  const hasMore = (!Array.isArray(page) && Boolean(page.next_page_params)) || items.length >= ADDRESS_TX_PAGE;
  if (hasMore) {
    warnings.push(
      "Only the most recent transactions returned by Blockscout are shown. A plain Ethereum RPC cannot list address history. Click an address to load more of its recent activity.",
    );
  } else {
    warnings.push(
      "Ethereum address history is loaded from the public Blockscout API, because a plain Ethereum RPC cannot list transactions for an address.",
    );
  }
  return graphFromTransfers(
    { chain: "eth", kind: "address", value: searched },
    transfersFromEthAddress(sliced),
    { searched, warnings, txids: sliced.map((item) => (item.hash ?? "").toLowerCase()).filter(Boolean) },
  );
}

export function graphFromRpcTx(tx: RpcTransaction, origin?: DetectedQuery): FlowGraph {
  const txid = (tx.hash ?? origin?.value ?? "").toLowerCase();
  const from = tx.from?.toLowerCase();
  const to = tx.to?.toLowerCase() ?? undefined;
  const query = origin ?? { chain: "eth" as const, kind: "tx" as const, value: txid.toLowerCase() };
  if (!from || !to) {
    return graphFromTransfers(query, [], {
      warnings: ["The transaction has no recipient (it may be a contract creation)."],
      txids: [txid],
    });
  }
  const transfer: Transfer = {
    from,
    to,
    amount: weiToEth(tx.value ?? "0x0"),
    txid,
    chain: "eth",
  };
  return graphFromTransfers(query, [transfer], { txids: [txid] });
}
