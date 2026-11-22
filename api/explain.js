// src/lib/detect.ts
var BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
var BASE58_CHARSET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
var ETH_TX = /^0x[0-9a-f]{64}$/;
var ETH_ADDRESS = /^0x[0-9a-f]{40}$/;
var HEX64 = /^[0-9a-f]{64}$/;
function normalizeInput(raw) {
  return raw.trim();
}
function detectQuery(raw) {
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
      alsoTry: { chain: "eth", kind: "tx", value: `0x${lower}` }
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
    error: "Could not detect a Bitcoin or Ethereum address or transaction hash."
  };
}
function isBech32(value) {
  if (value.length < 14 || value.length > 74) return false;
  const sep = value.lastIndexOf("1");
  if (sep < 2) return false;
  const hrp = value.slice(0, sep);
  const data = value.slice(sep + 1);
  if (hrp !== "bc" || data.length < 6) return false;
  return [...data].every((ch) => BECH32_CHARSET.includes(ch));
}
function isLegacyBtcAddress(value) {
  if (value.length < 26 || value.length > 35) return false;
  if (value[0] !== "1" && value[0] !== "3") return false;
  return [...value].every((ch) => BASE58_CHARSET.includes(ch));
}

// src/lib/rate-limit.ts
var hits = /* @__PURE__ */ new Map();
function allow(key, limit = 20, windowMs = 6e4, now = Date.now()) {
  const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5e3) hits.clear();
  return true;
}
function clientIp(headers, fallback = "unknown") {
  const forwarded = headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (value && value.trim()) return value.split(",")[0].trim();
  const real = headers["x-real-ip"];
  const realValue = Array.isArray(real) ? real[0] : real;
  if (realValue && realValue.trim()) return realValue.trim();
  return fallback;
}

// src/lib/http.ts
var MAX_BODY_BYTES = 16384;
function methodOf(req) {
  return (req.method ?? "GET").toUpperCase();
}
function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}
function byteLength(value) {
  return new TextEncoder().encode(value).length;
}
function tooLarge(req, max = MAX_BODY_BYTES) {
  const length = header(req, "content-length");
  if (length && Number(length) > max) return true;
  if (typeof req.body === "string" && byteLength(req.body) > max) return true;
  return false;
}
function readJsonBody(req) {
  if (req.body == null || req.body === "") {
    return { ok: false, error: "Invalid JSON body." };
  }
  if (typeof req.body === "string") {
    try {
      return { ok: true, value: JSON.parse(req.body) };
    } catch {
      return { ok: false, error: "Invalid JSON body." };
    }
  }
  return { ok: true, value: req.body };
}
function cors(res) {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type");
}

// src/lib/types.ts
var COINBASE_ID = "coinbase";

// src/lib/format.ts
function shortAddress(value, size = 5) {
  if (value === COINBASE_ID) return "coinbase";
  if (value.startsWith("0x") && value.length >= 12) {
    return `${value.slice(0, 2 + size)}\u2026${value.slice(-size)}`;
  }
  if (value.length <= size * 2 + 1) return value;
  return `${value.slice(0, size)}\u2026${value.slice(-size)}`;
}
function formatAmount(amount, chain) {
  if (!Number.isFinite(amount)) return "unknown";
  const unit = chain === "btc" ? "BTC" : "ETH";
  if (amount === 0) return `0 ${unit}`;
  const abs = Math.abs(amount);
  const digits = abs >= 1e3 ? 2 : abs >= 1 ? 4 : abs >= 1e-4 ? 6 : 8;
  const text = amount.toFixed(digits).replace(/\.?0+$/, "");
  return `${text} ${unit}`;
}

// src/lib/graph.ts
function totalsFor(graph, address) {
  let received = 0;
  let sent = 0;
  const counterparties = /* @__PURE__ */ new Set();
  for (const edge of graph.edges) {
    if (edge.target === address) {
      received += edge.amount;
      counterparties.add(edge.source);
    }
    if (edge.source === address) {
      sent += edge.amount;
      counterparties.add(edge.target);
    }
  }
  return { received, sent, counterparties: counterparties.size };
}

// src/lib/summary.ts
var MAX_SUMMARY_CHARS = 8e3;
function summarizeGraph(graph, limit = 18) {
  const originId = graph.origin.kind === "address" ? graph.origin.value : void 0;
  const totals = originId ? totalsFor(graph, originId) : void 0;
  const ranked = [...graph.edges].sort((a, b) => b.amount - a.amount).slice(0, limit);
  const used = /* @__PURE__ */ new Set();
  if (originId) used.add(originId);
  for (const edge of ranked) {
    used.add(edge.source);
    used.add(edge.target);
  }
  const nodes = graph.nodes.filter((node) => used.has(node.id)).map((node) => ({
    id: node.id,
    short: shortAddress(node.id),
    role: node.role,
    isContract: node.isContract,
    label: node.label,
    depth: node.depth
  }));
  return {
    chain: graph.chain,
    origin: graph.origin,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    transactionCount: graph.transactionCount,
    truncated: graph.truncated,
    warnings: graph.warnings,
    originTotals: totals ? {
      received: formatAmount(totals.received, graph.chain),
      sent: formatAmount(totals.sent, graph.chain),
      counterparties: totals.counterparties
    } : void 0,
    nodes,
    topFlows: ranked.map((edge) => ({
      from: shortAddress(edge.source),
      to: shortAddress(edge.target),
      amount: formatAmount(edge.amount, graph.chain),
      txCount: edge.txids.length
    }))
  };
}
function serializeSummary(graph) {
  return JSON.stringify(summarizeGraph(graph));
}

// src/lib/explain.ts
var EXPLAIN_LIMIT = 6;
var EXPLAIN_WINDOW_MS = 6e4;
var MAX_GRAPH_CHARS = MAX_SUMMARY_CHARS;
var DEFAULT_MODEL = "gemini-3.5-flash-lite";
var SYSTEM = `You explain a read-only cryptocurrency fund-flow graph in clear English.
Rules:
- This is not financial advice. Do not tell the reader to buy, sell, hold, or trade.
- Do not invent entity names (exchanges, people, services, companies, mixers, or other labels). If a label field is present in the data, you may use that label; otherwise refer only to addresses or shortened addresses.
- If you are not sure about a role, destination, or identity, say so clearly.
- Never claim that an address belongs to an exchange, a person, or a service unless that label is in the supplied data.
- Be concise: 2\u20134 short paragraphs. Mention concentrations when the numbers are in the data (for example, "this address received from 3 wallets and sent most of the funds to one address").
- Mention the chain and any limits in the data (recent transactions only, a minimum amount, a depth limit, or a truncated graph).
- Do not invent amounts, counterparties, or transactions that are not in the data.`;
function getGeminiApiKey(env = process.env) {
  const key = env.GEMINI_API_KEY ?? env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!key || !key.trim()) return void 0;
  return key.trim();
}
function getModelId(env = process.env) {
  return env.GOOGLE_MODEL?.trim() || DEFAULT_MODEL;
}
function isFlowGraph(value) {
  if (!value || typeof value !== "object") return false;
  const graph = value;
  return Boolean(graph.origin && Array.isArray(graph.nodes) && Array.isArray(graph.edges));
}
function prepareExplainPayload(input) {
  const graph = input.graph;
  if (!isFlowGraph(graph)) {
    return { ok: false, status: 400, error: "A flow graph is required." };
  }
  const detected = detectQuery(graph.origin?.value ?? "");
  if (!detected.ok || detected.query.chain !== graph.origin.chain) {
    return { ok: false, status: 400, error: "The graph origin is invalid." };
  }
  if (graph.nodes.length === 0) {
    return { ok: false, status: 400, error: "The graph has no nodes to explain." };
  }
  const serialized = serializeSummary(graph);
  if (serialized.length > MAX_GRAPH_CHARS) {
    return { ok: false, status: 413, error: "The graph is too large to explain." };
  }
  return { ok: true, serialized };
}
async function callGemini(serialized, model, apiKey, fetchFn = fetch) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: `Explain this fund-flow graph:
${serialized}` }] }],
      generationConfig: { maxOutputTokens: 500, temperature: 0.2 }
    })
  });
  if (!response.ok) {
    throw new Error("The explanation service is unavailable right now.");
  }
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("The explanation service returned an empty response.");
  return text;
}
async function handleExplainHttp(req, res, deps = {}) {
  cors(res);
  if (methodOf(req) === "OPTIONS") {
    res.status(204).json(null);
    return;
  }
  if (methodOf(req) !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (tooLarge(req, MAX_GRAPH_CHARS + 2048)) {
    res.status(413).json({ error: "Request body is too large." });
    return;
  }
  const env = deps.env ?? process.env;
  const ip = clientIp(req.headers ?? {}, req.socket?.remoteAddress ?? "unknown");
  if (!allow(`explain:${ip}`, EXPLAIN_LIMIT, EXPLAIN_WINDOW_MS, deps.now ?? Date.now())) {
    res.status(429).json({ error: "Too many explanation requests. Please wait a minute and try again." });
    return;
  }
  const key = getGeminiApiKey(env);
  if (!key) {
    res.status(503).json({ error: "The optional AI explanation is not configured on this deployment." });
    return;
  }
  const body = readJsonBody(req);
  if (!body.ok) {
    res.status(400).json({ error: body.error });
    return;
  }
  const prepared = prepareExplainPayload(body.value ?? {});
  if (!prepared.ok) {
    res.status(prepared.status).json({ error: prepared.error });
    return;
  }
  try {
    const generate = deps.generate ?? callGemini;
    const text = await generate(prepared.serialized, getModelId(env), key);
    res.status(200).json({ explanation: text, model: getModelId(env) });
  } catch {
    res.status(502).json({ error: "The explanation could not be generated. Please try again in a moment." });
  }
}

// server/explain.ts
var maxDuration = 30;
async function handler(req, res) {
  await handleExplainHttp(req, res);
}
export {
  handler as default,
  maxDuration
};
