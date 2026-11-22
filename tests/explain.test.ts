import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  getGeminiApiKey,
  handleExplainHttp,
  MAX_GRAPH_CHARS,
  prepareExplainPayload,
  SYSTEM,
  callGemini,
} from "../src/lib/explain.js";
import { graphFromBtcTx, type MempoolTx } from "../src/lib/btc.js";
import { resetRateLimit } from "../src/lib/rate-limit.js";
import type { HttpResponse } from "../src/lib/http.js";

const fanout: MempoolTx = {
  txid: "9421c806a8f3fd46841241659637d75b944b42af61fabe7b9359349bc50d2ea6",
  vin: [{ prevout: { scriptpubkey_address: "bc1qsenderxxxxxxxxxxxxxxxxxxxxxxxxxx", value: 1_000_000 } }],
  vout: [
    { scriptpubkey_address: "36teKbgRKkQx35q1BMAdN9HiJEsVAAEwmP", value: 300_000 },
    { scriptpubkey_address: "39XpoaixBAbUZzaq7g73tmvogBw6rGv8JP", value: 700_000 },
  ],
};

const graph = graphFromBtcTx(fanout);

afterEach(() => {
  resetRateLimit();
});

function collect() {
  let status = 0;
  let body: unknown;
  const res: HttpResponse = {
    status(code) {
      status = code;
      return res;
    },
    json(value) {
      body = value;
    },
    setHeader() {},
  };
  return { res, read: () => ({ status, body: body as Record<string, unknown> }) };
}

describe("prepareExplainPayload", () => {
  it("serializes a compact summary below the size cap", () => {
    const prepared = prepareExplainPayload({ graph });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.serialized.length).toBeLessThan(MAX_GRAPH_CHARS);
    expect(prepared.serialized).toContain("btc");
    expect(prepared.serialized).toContain("topFlows");
    expect(prepared.serialized).not.toMatch(/GEMINI|AIza|api[_-]?key/i);
  });

  it("rejects a missing, incomplete or empty graph", () => {
    expect(prepareExplainPayload({}).ok).toBe(false);
    expect(prepareExplainPayload({ graph: { origin: { chain: "btc", kind: "tx", value: "bad" } } }).ok).toBe(false);
    expect(
      prepareExplainPayload({
        graph: { origin: graph.origin, nodes: [], edges: [], warnings: [], truncated: false, transactionCount: 0, chain: "btc" },
      }).ok,
    ).toBe(false);
  });
});

describe("handleExplainHttp", () => {
  it("answers OPTIONS and rejects non-POST methods", async () => {
    const options = collect();
    await handleExplainHttp({ method: "OPTIONS" }, options.res, { env: {} });
    expect(options.read().status).toBe(204);
    const get = collect();
    await handleExplainHttp({ method: "GET" }, get.res, { env: {} });
    expect(get.read().status).toBe(405);
  });

  it("returns 503 when no API key is configured and does not mention any key in the error", async () => {
    const box = collect();
    await handleExplainHttp(
      { method: "POST", headers: { "x-forwarded-for": "9.9.9.9" }, body: { graph } },
      box.res,
      { env: {} },
    );
    const { status, body } = box.read();
    expect(status).toBe(503);
    expect(JSON.stringify(body).toLowerCase()).not.toMatch(/aiza|aq\.|api[_-]?key|gemini_key/);
  });

  it("rate-limits explanation requests", async () => {
    let limited = 0;
    for (let i = 0; i < 8; i += 1) {
      const box = collect();
      await handleExplainHttp(
        { method: "POST", headers: { "x-forwarded-for": "2.2.2.2" }, body: { graph } },
        box.res,
        { env: { GEMINI_API_KEY: "test-key" }, generate: async () => "ok" },
      );
      if (box.read().status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it("returns an explanation and the configured model", async () => {
    const box = collect();
    await handleExplainHttp(
      { method: "POST", headers: { "x-forwarded-for": "3.3.3.3" }, body: { graph } },
      box.res,
      {
        env: { GEMINI_API_KEY: "test-key", GOOGLE_MODEL: DEFAULT_MODEL },
        generate: async (serialized, model, apiKey) => {
          expect(apiKey).toBe("test-key");
          expect(model).toBe(DEFAULT_MODEL);
          expect(serialized).toContain("topFlows");
          return "This address received from 1 wallet and sent most of the funds to one address.";
        },
      },
    );
    const { status, body } = box.read();
    expect(status).toBe(200);
    expect(body.explanation).toMatch(/sent most/);
    expect(body.model).toBe(DEFAULT_MODEL);
  });

  it("rejects a body that is too large", async () => {
    const box = collect();
    await handleExplainHttp(
      {
        method: "POST",
        headers: { "content-length": String(MAX_GRAPH_CHARS + 4000) },
        body: { graph },
      },
      box.res,
      { env: { GEMINI_API_KEY: "test-key" } },
    );
    expect(box.read().status).toBe(413);
  });

  it("returns 502 when generation fails", async () => {
    const box = collect();
    await handleExplainHttp(
      { method: "POST", headers: { "x-forwarded-for": "4.4.4.4" }, body: { graph } },
      box.res,
      {
        env: { GEMINI_API_KEY: "test-key" },
        generate: async () => {
          throw new Error("nope");
        },
      },
    );
    expect(box.read().status).toBe(502);
  });
});

describe("Gemini helpers", () => {
  it("reads the key from known env names and ignores blanks", () => {
    expect(getGeminiApiKey({})).toBeUndefined();
    expect(getGeminiApiKey({ GEMINI_API_KEY: "  " })).toBeUndefined();
    expect(getGeminiApiKey({ GEMINI_API_KEY: "abc" })).toBe("abc");
    expect(getGeminiApiKey({ GOOGLE_GENERATIVE_AI_API_KEY: "from-legacy" })).toBe("from-legacy");
  });

  it("instructs the model not to invent labels and not to give financial advice", () => {
    expect(SYSTEM).toMatch(/not financial advice/i);
    expect(SYSTEM).toMatch(/Do not invent entity names/i);
    expect(SYSTEM).toMatch(/not sure/i);
  });

  it("parses a Gemini response through a mocked fetch", async () => {
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "A compact explanation." }] } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    const text = await callGemini("{}", DEFAULT_MODEL, "test-key", fetchFn);
    expect(text).toBe("A compact explanation.");
  });

  it("throws when the Gemini HTTP call fails or is empty", async () => {
    const fail: typeof fetch = async () => new Response("no", { status: 500 });
    await expect(callGemini("{}", DEFAULT_MODEL, "test-key", fail)).rejects.toThrow(/unavailable/);
    const empty: typeof fetch = async () =>
      new Response(JSON.stringify({ candidates: [] }), { status: 200 });
    await expect(callGemini("{}", DEFAULT_MODEL, "test-key", empty)).rejects.toThrow(/empty/);
  });
});
