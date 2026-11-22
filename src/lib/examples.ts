import type { DetectedQuery } from "./types.js";

export interface ExampleQuery {
  id: string;
  label: string;
  note: string;
  query: DetectedQuery;
  default?: boolean;
}

// Historical Bitcoin transaction in block 700,000: one address pays seven others.
// Stable, public, and visually clear (a larger payment plus several smaller ones).
export const BTC_FANOUT_TX = "9421c806a8f3fd46841241659637d75b944b42af61fabe7b9359349bc50d2ea6";

// First Ethereum transaction, often used as a public example.
export const ETH_FIRST_TX = "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060";

// Public figure address with a well-known ENS name on explorers.
export const ETH_VITALIK = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";

export const EXAMPLES: ExampleQuery[] = [
  {
    id: "btc-fanout",
    label: "BTC payout",
    note: "A Bitcoin transaction in block 700,000 with one sender and seven recipients.",
    query: { chain: "btc", kind: "tx", value: BTC_FANOUT_TX },
    default: true,
  },
  {
    id: "eth-first",
    label: "First ETH tx",
    note: "The first Ethereum transaction, a small transfer between two addresses.",
    query: { chain: "eth", kind: "tx", value: ETH_FIRST_TX },
  },
  {
    id: "eth-address",
    label: "ETH address",
    note: "Recent native transfers for a well-known public Ethereum address, via Blockscout.",
    query: { chain: "eth", kind: "address", value: ETH_VITALIK },
  },
];

export function defaultExample(): ExampleQuery {
  return EXAMPLES.find((example) => example.default) ?? EXAMPLES[0]!;
}
