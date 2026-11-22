import { COINBASE_ID, type Chain } from "./types.js";

export function shortAddress(value: string, size = 5): string {
  if (value === COINBASE_ID) return "coinbase";
  if (value.startsWith("0x") && value.length >= 12) {
    return `${value.slice(0, 2 + size)}…${value.slice(-size)}`;
  }
  if (value.length <= size * 2 + 1) return value;
  return `${value.slice(0, size)}…${value.slice(-size)}`;
}

export function explorerAddressUrl(chain: Chain, address: string): string {
  if (address === COINBASE_ID) {
    return chain === "btc" ? "https://mempool.space" : "https://etherscan.io";
  }
  return chain === "btc"
    ? `https://mempool.space/address/${address}`
    : `https://etherscan.io/address/${address}`;
}

export function explorerTxUrl(chain: Chain, txid: string): string {
  return chain === "btc" ? `https://mempool.space/tx/${txid}` : `https://etherscan.io/tx/${txid}`;
}

export function formatAmount(amount: number, chain: Chain): string {
  if (!Number.isFinite(amount)) return "unknown";
  const unit = chain === "btc" ? "BTC" : "ETH";
  if (amount === 0) return `0 ${unit}`;
  const abs = Math.abs(amount);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.0001 ? 6 : 8;
  const text = amount.toFixed(digits).replace(/\.?0+$/, "");
  return `${text} ${unit}`;
}

export function satsToBtc(sats: number | bigint): number {
  return Number(sats) / 1e8;
}

export function weiToEth(wei: string | bigint): number {
  let value: bigint;
  try {
    value = typeof wei === "bigint" ? wei : BigInt(wei);
  } catch {
    return 0;
  }
  const whole = value / 1_000_000_000_000_000_000n;
  const frac = value % 1_000_000_000_000_000_000n;
  return Number(whole) + Number(frac) / 1e18;
}

export function unitLabel(chain: Chain): string {
  return chain === "btc" ? "BTC" : "ETH";
}
