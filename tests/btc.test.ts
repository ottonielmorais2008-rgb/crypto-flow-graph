
import { describe, expect, it } from "vitest";
import {
  graphFromBtcAddress,
  graphFromBtcTx,
  transfersFromBtcTx,
  type MempoolTx,
} from "../src/lib/btc.js";
import { COINBASE_ID } from "../src/lib/types.js";

const fanout: MempoolTx = {
  txid: "9421c806a8f3fd46841241659637d75b944b42af61fabe7b9359349bc50d2ea6",
  vin: [
    {
      prevout: { scriptpubkey_address: "bc1qsenderxxxxxxxxxxxxxxxxxxxxxxxxxx", value: 161_184_546 },
    },
  ],
  vout: [
    { scriptpubkey_address: "36teKbgRKkQx35q1BMAdN9HiJEsVAAEwmP", value: 559_734 },
    { scriptpubkey_address: "1BbLcnmH3VBdUALJArUHgoCk4JN3gSMvxm", value: 516_198 },
    { scriptpubkey_address: "3Lk6Di4eoDCs5RjZkFi5sbYBELxfjXP8Vn", value: 569_485 },
    { scriptpubkey_address: "18FyePUmMfLsW7oYrPFH4MvZhBBZFL8Ngv", value: 585_475 },
    { scriptpubkey_address: "bc1q5zepe53k52k924ny0nlfjqq0z0allga5x29s8u", value: 606_841 },
    { scriptpubkey_address: "3MEszGNau7vWTuR67sMMmTEazbbyioLnFJ", value: 641_151 },
    { scriptpubkey_address: "39XpoaixBAbUZzaq7g73tmvogBw6rGv8JP", value: 157_705_662 },
  ],
};

const changeTx: MempoolTx = {
  txid: "change-tx",
  vin: [
    { prevout: { scriptpubkey_address: "addrA", value: 2_000_000 } },
    { prevout: { scriptpubkey_address: "addrB", value: 1_000_000 } },
  ],
  vout: [
    { scriptpubkey_address: "addrC", value: 2_200_000 },
    { scriptpubkey_address: "addrA", value: 700_000 },
    { scriptpubkey_type: "op_return", value: 0 },
  ],
};

const coinbase: MempoolTx = {
  txid: "coinbase-tx",
  vin: [{ is_coinbase: true }],
  vout: [{ scriptpubkey_address: "miner", value: 6_250_000_00 }],
};

describe("transfersFromBtcTx", () => {
  it("builds a fan-out from one sender to each recipient with output amounts", () => {
    const transfers = transfersFromBtcTx(fanout);
    expect(transfers).toHaveLength(7);
    expect(transfers.every((item) => item.from === "bc1qsenderxxxxxxxxxxxxxxxxxxxxxxxxxx")).toBe(true);
    const largest = [...transfers].sort((a, b) => b.amount - a.amount)[0]!;
    expect(largest.to).toBe("39XpoaixBAbUZzaq7g73tmvogBw6rGv8JP");
    expect(largest.amount).toBeCloseTo(1.57705662, 7);
    const total = transfers.reduce((sum, item) => sum + item.amount, 0);
    expect(total).toBeCloseTo(1.61184546, 7);
  });

  it("allocates multi-input amounts in proportion and skips change and OP_RETURN", () => {
    const transfers = transfersFromBtcTx(changeTx);
    expect(transfers.every((item) => item.to !== "addrA")).toBe(true);
    expect(transfers.every((item) => item.to !== undefined && item.amount > 0)).toBe(true);
    const toC = transfers.filter((item) => item.to === "addrC");
    expect(toC).toHaveLength(2);
    const fromA = toC.find((item) => item.from === "addrA")!;
    const fromB = toC.find((item) => item.from === "addrB")!;
    expect(fromA.amount).toBeCloseTo(0.01466666, 5);
    expect(fromB.amount).toBeCloseTo(0.00733333, 5);
  });

  it("maps a coinbase transaction to a coinbase node", () => {
    const transfers = transfersFromBtcTx(coinbase);
    expect(transfers).toEqual([
      { from: COINBASE_ID, to: "miner", amount: 6.25, txid: "coinbase-tx", chain: "btc" },
    ]);
  });

  it("returns nothing for a transaction with no spendable outputs", () => {
    expect(transfersFromBtcTx({ txid: "empty", vin: [], vout: [] })).toEqual([]);
    expect(transfersFromBtcTx({ txid: "no-id" } as MempoolTx)).toEqual([]);
  });
});

describe("graphFromBtcTx and graphFromBtcAddress", () => {
  it("builds a graph with a sender, seven recipients and seven edges", () => {
    const graph = graphFromBtcTx(fanout);
    expect(graph.chain).toBe("btc");
    expect(graph.origin.kind).toBe("tx");
    expect(graph.nodes).toHaveLength(8);
    expect(graph.edges).toHaveLength(7);
    expect(graph.transactionCount).toBe(1);
    const sink = graph.nodes.find((node) => node.id === "39XpoaixBAbUZzaq7g73tmvogBw6rGv8JP");
    expect(sink?.role).toBe("output");
    expect(sink?.received).toBeCloseTo(1.57705662, 7);
  });

  it("marks the searched address and warns when the page is full", () => {
    const many = Array.from({ length: 50 }, (_, index) => ({
      ...fanout,
      txid: `tx-${index}`,
    }));
    const graph = graphFromBtcAddress("bc1qsenderxxxxxxxxxxxxxxxxxxxxxxxxxx", many);
    const origin = graph.nodes.find((node) => node.id === "bc1qsenderxxxxxxxxxxxxxxxxxxxxxxxxxx");
    expect(origin?.role).toBe("searched");
    expect(origin?.expanded).toBe(true);
    expect(graph.warnings.join(" ")).toMatch(/most recent/);
    expect(graph.transactionCount).toBe(50);
  });
});
