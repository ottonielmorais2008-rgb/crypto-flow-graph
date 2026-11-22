import type { DetectResult } from "./types.js";

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BASE58_CHARSET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const ETH_TX = /^0x[0-9a-f]{64}$/;
const ETH_ADDRESS = /^0x[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export function normalizeInput(raw: string): string {
  return raw.trim();
}

export function detectQuery(raw: string): DetectResult {
  const trimmed = normalizeInput(raw);
  if (!trimmed) {
    return { ok: false, error: "Paste a Bitcoin or Ethereum address or transaction hash." };
  }

  const lower = trimmed.toLowerCase();

  if (ETH_TX.test(lower)) {
    return { ok: true, query: { chain: "eth", kind: "tx", value: lower } };
  }
  if (ETH_ADDRESS.test(lower)) {
    return { ok: true, query: { chain: "eth", kind: "address", value: lower } };
  }
  if (HEX64.test(lower)) {
    return {
      ok: true,
      query: { chain: "btc", kind: "tx", value: lower },
      alsoTry: { chain: "eth", kind: "tx", value: `0x${lower}` },
    };
  }
  if (lower.startsWith("tb1") || lower.startsWith("bcrt1")) {
    return { ok: false, error: "Testnet addresses are not supported. Use a mainnet Bitcoin address." };
  }
  if (lower.startsWith("bc1")) {
    if (!isBech32(lower)) {
      return { ok: false, error: "That does not look like a valid Bitcoin bech32 address." };
    }
    return { ok: true, query: { chain: "btc", kind: "address", value: lower } };
  }
  if (trimmed.startsWith("1") || trimmed.startsWith("3")) {
    if (!isLegacyBtcAddress(trimmed)) {
      return { ok: false, error: "That does not look like a valid Bitcoin address." };
    }
    return { ok: true, query: { chain: "btc", kind: "address", value: trimmed } };
  }

  return {
    ok: false,
    error: "Could not detect a Bitcoin or Ethereum address or transaction hash.",
  };
}

export function isBech32(value: string): boolean {
  if (value.length < 14 || value.length > 74) return false;
  const sep = value.lastIndexOf("1");
  if (sep < 2) return false;
  const hrp = value.slice(0, sep);
  const data = value.slice(sep + 1);
  if (hrp !== "bc" || data.length < 6) return false;
  return [...data].every((ch) => BECH32_CHARSET.includes(ch));
}

export function isLegacyBtcAddress(value: string): boolean {
  if (value.length < 26 || value.length > 35) return false;
  if (value[0] !== "1" && value[0] !== "3") return false;
  return [...value].every((ch) => BASE58_CHARSET.includes(ch));
}

export function isEthAddress(value: string): boolean {
  return ETH_ADDRESS.test(value.trim().toLowerCase());
}
