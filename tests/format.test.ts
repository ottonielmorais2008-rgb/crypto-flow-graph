
import { describe, expect, it } from "vitest";
import {
  explorerAddressUrl,
  explorerTxUrl,
  formatAmount,
  satsToBtc,
  shortAddress,
  weiToEth,
} from "../src/lib/format.js";
import { COINBASE_ID } from "../src/lib/types.js";

describe("shortAddress", () => {
  it("abbreviates long addresses and labels coinbase", () => {
    expect(shortAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBe("1A1zP…ivfNa");
    expect(shortAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045")).toMatch(/^0xd8da6…/);
    expect(shortAddress(COINBASE_ID)).toBe("coinbase");
  });
});

describe("explorers and amounts", () => {
  it("builds mempool and etherscan URLs", () => {
    expect(explorerAddressUrl("btc", "abc")).toBe("https://mempool.space/address/abc");
    expect(explorerTxUrl("eth", "0xabc")).toBe("https://etherscan.io/tx/0xabc");
    expect(explorerAddressUrl("btc", COINBASE_ID)).toBe("https://mempool.space");
  });

  it("formats BTC and ETH amounts and converts units", () => {
    expect(formatAmount(0, "btc")).toBe("0 BTC");
    expect(formatAmount(1.57705662, "btc")).toContain("BTC");
    expect(satsToBtc(100_000_000)).toBe(1);
    expect(weiToEth("1000000000000000000")).toBe(1);
    expect(weiToEth("0x0")).toBe(0);
    expect(weiToEth("not-a-number")).toBe(0);
  });
});
