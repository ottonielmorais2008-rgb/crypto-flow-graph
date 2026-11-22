import { detectQuery } from "./detect.js";
import { clientIp, allow } from "./rate-limit.js";
import { cors, methodOf, readJsonBody, tooLarge, type HttpRequest, type HttpResponse } from "./http.js";
import { serializeSummary, MAX_SUMMARY_CHARS } from "./summary.js";
import type { FlowGraph } from "./types.js";

export type EnvMap = Record<string, string | undefined>;

export const EXPLAIN_LIMIT = 6;
export const EXPLAIN_WINDOW_MS = 60_000;
export const MAX_GRAPH_CHARS = MAX_SUMMARY_CHARS;
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export const SYSTEM = `You explain a read-only cryptocurrency fund-flow graph in clear English.
Rules:
- This is not financial advice. Do not tell the reader to buy, sell, hold, or trade.
- Do not invent entity names (exchanges, people, services, companies, mixers, or other labels). If a label field is present in the data, you may use that label; otherwise refer only to addresses or shortened addresses.
- If you are not sure about a role, destination, or identity, say so clearly.
- Never claim that an address belongs to an exchange, a person, or a service unless that label is in the supplied data.
- Be concise: 2–4 short paragraphs. Mention concentrations when the numbers are in the data (for example, "this address received from 3 wallets and sent most of the funds to one address").
- Mention the chain and any limits in the data (recent transactions only, a minimum amount, a depth limit, or a truncated graph).
- Do not invent amounts, counterparties, or transactions that are not in the data.`;

export interface ExplainInput {
  graph?: unknown;
  summary?: unknown;
}

export function getGeminiApiKey(env: EnvMap = process.env): string | undefined {
  const key = env.GEMINI_API_KEY ?? env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!key || !key.trim()) return undefined;
  return key.trim();
}

export function getModelId(env: EnvMap = process.env): string {
  return env.GOOGLE_MODEL?.trim() || DEFAULT_MODEL;
}

function isFlowGraph(value: unknown): value is FlowGraph {
  if (!value || typeof value !== "object") return false;
  const graph = value as FlowGraph;
  return Boolean(graph.origin && Array.isArray(graph.nodes) && Array.isArray(graph.edges));
}

export function prepareExplainPayload(
  input: ExplainInput,
): { ok: true; serialized: string } | { ok: false; status: number; error: string } {
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

export async function callGemini(
  serialized: string,
  model: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: `Explain this fund-flow graph:\n${serialized}` }] }],
      generationConfig: { maxOutputTokens: 500, temperature: 0.2 },
    }),
  });
  if (!response.ok) {
    throw new Error("The explanation service is unavailable right now.");
  }
  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("The explanation service returned an empty response.");
  return text;
}

export async function handleExplainHttp(
  req: HttpRequest,
  res: HttpResponse,
  deps: { env?: EnvMap; generate?: typeof callGemini; now?: number } = {},
): Promise<void> {
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
  const prepared = prepareExplainPayload((body.value ?? {}) as ExplainInput);
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
