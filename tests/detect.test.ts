
import { describe, expect, it } from "vitest";
import { detectQuery, isBech32, isLegacyBtcAddress } from "../src/lib/detect.js";

describe("detectQuery", () => {
  it("rejects empty or whitespace input", () => {
    expect(detectQuery("").ok).toBe(false);
    expect(detectQuery("   ").ok).toBe(false);
  });

  it("detects an Ethereum address and lowercases it", () => {
    const result = detectQuery("  0xD8DA6BF26964aF9D7eEd9e03E53415D37aA96045  ");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query).toEqual({
      chain: "eth",
      kind: "address",
      value: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    });
  });

  it("detects an Ethereum transaction hash", () => {
    const hash = "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060";
    const result = detectQuery(hash.toUpperCase());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query).toEqual({ chain: "eth", kind: "tx", value: hash });
  });

  it("treats 64 hex characters as a Bitcoin txid and also offers Ethereum", () => {
    const txid = "9421c806a8f3fd46841241659637d75b944b42af61fabe7b9359349bc50d2ea6";
    const result = detectQuery(txid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query).toEqual({ chain: "btc", kind: "tx", value: txid });
    expect(result.alsoTry).toEqual({ chain: "eth", kind: "tx", value: `0x${txid}` });
  });

  it("detects legacy, P2SH and bech32 Bitcoin addresses", () => {
    const legacy = detectQuery("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
    const p2sh = detectQuery("3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy");
    const bech32 = detectQuery("BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4");
    expect(legacy.ok && legacy.query).toEqual({
      chain: "btc",
      kind: "address",
      value: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    });
    expect(p2sh.ok && p2sh.query.kind).toBe("address");
    expect(bech32.ok && bech32.query).toEqual({
      chain: "btc",
      kind: "address",
      value: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    });
  });

  it("detects a taproot bech32m address", () => {
    const result = detectQuery("bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.chain).toBe("btc");
    expect(result.query.kind).toBe("address");
  });

  it("rejects testnet bech32 and unknown strings", () => {
    const testnet = detectQuery("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx");
    expect(testnet.ok).toBe(false);
    if (testnet.ok) return;
    expect(testnet.error).toMatch(/Testnet/);
    expect(detectQuery("not-an-address").ok).toBe(false);
    expect(detectQuery("0xdead").ok).toBe(false);
  });
});

describe("address format helpers", () => {
  it("accepts known bech32 and legacy shapes and rejects bad characters", () => {
    expect(isBech32("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBe(true);
    expect(isBech32("bc1qinvalidb")).toBe(false);
    expect(isLegacyBtcAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBe(true);
    expect(isLegacyBtcAddress("1O0")).toBe(false);
  });
});
