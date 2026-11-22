
import { describe, expect, it } from "vitest";
import {
  graphFromEthAddress,
  graphFromEthTx,
  graphFromRpcTx,
  transferFromEthTx,
  transfersFromEthAddress,
  transfersFromEthInternals,
  type BlockscoutTx,
} from "../src/lib/eth.js";

const firstTx: BlockscoutTx = {
  hash: "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060",
  from: { hash: "0xA1E4380A3B1f749673E270229993eE55F35663b4", is_contract: false },
  to: { hash: "0x5DF9B87991262F6BA471F09758CDE1c0FC1De734", is_contract: false },
  value: "31337",
  status: "ok",
};

const contractCall: BlockscoutTx = {
  hash: "0xaaa0000000000000000000000000000000000000000000000000000000000001",
  from: { hash: "0x1111111111111111111111111111111111111111" },
  to: { hash: "0x2222222222222222222222222222222222222222", is_contract: true, ens_domain_name: "vault.eth" },
  value: "0",
};

const created: BlockscoutTx = {
  hash: "0xbbb0000000000000000000000000000000000000000000000000000000000002",
  from: { hash: "0x1111111111111111111111111111111111111111" },
  to: null,
  created_contract: { hash: "0x3333333333333333333333333333333333333333", is_contract: true, name: "Factory" },
  value: "1000000000000000000",
};

describe("Ethereum parsers", () => {
  it("parses a simple native transfer and converts wei", () => {
    const transfer = transferFromEthTx(firstTx, { includeZero: true });
    expect(transfer?.from).toBe("0xa1e4380a3b1f749673e270229993ee55f35663b4");
    expect(transfer?.to).toBe("0x5df9b87991262f6ba471f09758cde1c0fc1de734");
    expect(transfer?.amount).toBeCloseTo(31337 / 1e18, 20);
  });

  it("skips zero-value calls in address history but keeps them for a single transaction", () => {
    expect(transferFromEthTx(contractCall, { includeZero: false })).toBeNull();
    const included = transferFromEthTx(contractCall, { includeZero: true });
    expect(included?.amount).toBe(0);
    expect(included?.toContract).toBe(true);
    expect(included?.toLabel).toBe("vault.eth");
    expect(transfersFromEthAddress([contractCall, firstTx])).toHaveLength(1);
  });

  it("uses the created contract as the recipient when to is missing", () => {
    const transfer = transferFromEthTx(created, { includeZero: true });
    expect(transfer?.to).toBe("0x3333333333333333333333333333333333333333");
    expect(transfer?.toContract).toBe(true);
    expect(transfer?.toLabel).toBe("Factory");
    expect(transfer?.amount).toBe(1);
  });

  it("parses internal transfers and ignores zero-value traces", () => {
    const transfers = transfersFromEthInternals(firstTx.hash!, [
      {
        from: { hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        to: { hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
        value: "2000000000000000000",
      },
      {
        from: { hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        to: { hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
        value: "0",
      },
    ]);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]?.amount).toBe(2);
  });

  it("builds a transaction graph including internals", () => {
    const graph = graphFromEthTx(firstTx, [
      {
        from: { hash: firstTx.to?.hash },
        to: { hash: "0xcccccccccccccccccccccccccccccccccccccccc", is_contract: true },
        value: "1000000000000000",
        transaction_hash: firstTx.hash,
      },
    ]);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(3);
    expect(graph.edges.length).toBe(2);
    expect(graph.nodes.some((node) => node.isContract)).toBe(true);
  });

  it("warns that Ethereum address history comes from Blockscout", () => {
    const graph = graphFromEthAddress("0xD8DA6BF26964aF9D7eEd9e03E53415D37aA96045", {
      items: [firstTx],
      next_page_params: { page: 2 },
    });
    expect(graph.origin.value).toBe("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
    expect(graph.warnings.join(" ")).toMatch(/Blockscout/);
    expect(graph.warnings.join(" ")).toMatch(/plain Ethereum RPC cannot list/);
  });

  it("builds a fallback graph from a public RPC transaction", () => {
    const graph = graphFromRpcTx({
      hash: "0xabc",
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      value: "0xde0b6b3a7640000",
    });
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.amount).toBe(1);
  });
});
