export type Chain = "btc" | "eth";
export type QueryKind = "address" | "tx";
export type NodeRole = "searched" | "input" | "output" | "both" | "contract";

export interface DetectedQuery {
  chain: Chain;
  kind: QueryKind;
  value: string;
}

export interface DetectSuccess {
  ok: true;
  query: DetectedQuery;
  alsoTry?: DetectedQuery;
}

export interface DetectFailure {
  ok: false;
  error: string;
}

export type DetectResult = DetectSuccess | DetectFailure;

export interface FlowNode {
  id: string;
  chain: Chain;
  role: NodeRole;
  isContract: boolean;
  depth: number;
  expanded: boolean;
  label?: string;
  received: number;
  sent: number;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  amount: number;
  txids: string[];
  chain: Chain;
}

export interface FlowGraph {
  chain: Chain;
  origin: DetectedQuery;
  nodes: FlowNode[];
  edges: FlowEdge[];
  warnings: string[];
  truncated: boolean;
  transactionCount: number;
}

export interface GraphFilters {
  minAmount: number;
  maxDepth: number;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
  txid: string;
  chain: Chain;
  fromContract?: boolean;
  toContract?: boolean;
  fromLabel?: string;
  toLabel?: string;
}

export const COINBASE_ID = "coinbase";
export const MAX_GRAPH_NODES = 80;
export const MAX_GRAPH_EDGES = 120;
export const ADDRESS_TX_PAGE = 50;
