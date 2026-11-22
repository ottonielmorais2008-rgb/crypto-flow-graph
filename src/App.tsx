import { useEffect, useMemo, useState, type FormEvent } from "react";
import { GraphView, ROLE_COLOR, type Selected } from "./components/GraphView";
import { detectQuery } from "./lib/detect";
import { defaultExample, EXAMPLES } from "./lib/examples";
import { expandAddress, loadGraph, LookupError } from "./lib/fetch-data";
import { explorerAddressUrl, explorerTxUrl, formatAmount, shortAddress, unitLabel } from "./lib/format";
import { filterGraph, totalsFor } from "./lib/graph";
import { emptyGraphMessage, loadMessage } from "./lib/ui-state";
import type { DetectedQuery, FlowGraph, GraphFilters } from "./lib/types";

const DISCLAIMER =
  "This is a read-only view of public blockchain data. It is not financial advice, a compliance tool, or a guarantee of who owns an address. Labels appear only when an explorer provides them. No wallet is connected and nothing is signed.";

export function App() {
  const initial = defaultExample();
  const [input, setInput] = useState(initial.query.value);
  const [loading, setLoading] = useState(true);
  const [expanding, setExpanding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<FlowGraph | null>(null);
  const [filters, setFilters] = useState<GraphFilters>({ minAmount: 0, maxDepth: 3 });
  const [selected, setSelected] = useState<Selected>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  const visible = useMemo(() => (graph ? filterGraph(graph, filters) : null), [graph, filters]);

  useEffect(() => {
    void runLookup(initial.query);
  }, []);

  async function runLookup(query: DetectedQuery, alsoTry?: DetectedQuery) {
    setLoading(true);
    setError(null);
    setExplanation(null);
    setExplainError(null);
    setSelected(null);
    try {
      const next = await loadGraph(query, {}, alsoTry);
      setGraph(next);
      if (query.kind === "address") setSelected({ type: "node", id: query.value });
    } catch (caught) {
      setGraph(null);
      setError(caught instanceof LookupError ? caught.message : "The lookup failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const detected = detectQuery(input);
    if (!detected.ok) {
      setError(detected.error);
      return;
    }
    void runLookup(detected.query, detected.alsoTry);
  }

  function useExample(value: string) {
    const detected = detectQuery(value);
    if (!detected.ok) {
      setError(detected.error);
      return;
    }
    setInput(detected.query.value);
    void runLookup(detected.query, detected.alsoTry);
  }

  async function onSelectNode(id: string) {
    setSelected({ type: "node", id });
    if (!graph) return;
    const node = graph.nodes.find((item) => item.id === id);
    if (!node || node.expanded || id === "coinbase") return;
    setExpanding(true);
    setError(null);
    try {
      const next = await expandAddress(graph, id);
      setGraph(next);
    } catch (caught) {
      setError(caught instanceof LookupError ? caught.message : "Could not load more transactions for that address.");
    } finally {
      setExpanding(false);
    }
  }

  function onSelectEdge(id: string) {
    setSelected({ type: "edge", id });
    const edge = graph?.edges.find((item) => item.id === id);
    const txid = edge?.txids[0];
    if (txid && graph) {
      window.open(explorerTxUrl(graph.chain, txid), "_blank", "noopener,noreferrer");
    }
  }

  async function explain() {
    if (!visible) return;
    setExplaining(true);
    setExplainError(null);
    try {
      const response = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graph: visible }),
      });
      const payload = (await response.json()) as { explanation?: string; error?: string };
      if (!response.ok) {
        setExplainError(payload.error ?? "The explanation could not be generated.");
        return;
      }
      setExplanation(payload.explanation ?? "");
    } catch {
      setExplainError("The explanation request failed. Please try again.");
    } finally {
      setExplaining(false);
    }
  }

  const selectedNode = visible && selected?.type === "node" ? visible.nodes.find((node) => node.id === selected.id) : null;
  const selectedEdge = visible && selected?.type === "edge" ? visible.edges.find((edge) => edge.id === selected.id) : null;
  const originTotals =
    visible && visible.origin.kind === "address" ? totalsFor(visible, visible.origin.value) : null;
  const emptyMessage = visible ? emptyGraphMessage(visible.nodes.length, visible.edges.length) : null;

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <p className="eyebrow">Read-only · no wallet</p>
            <h1>Crypto Flow Graph</h1>
          </div>
        </div>
        <p className="top-note">Bitcoin via mempool.space · Ethereum via Blockscout and public RPC</p>
      </header>

      <p className="lede">
        Paste a Bitcoin or Ethereum address or transaction hash. The app detects the chain, draws how funds move between
        addresses, and can explain the flow in plain English. Nothing is signed and no wallet is connected.
      </p>

      <form className="search" onSubmit={onSubmit}>
        <label htmlFor="query">Address or transaction hash</label>
        <div className="search-row">
          <input
            id="query"
            name="query"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Paste a BTC or ETH address or transaction hash"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
          />
          <button type="submit" disabled={loading}>
            {loading ? "Loading…" : "Trace"}
          </button>
        </div>
        <div className="examples">
          <span>Examples</span>
          {EXAMPLES.map((example) => (
            <button
              key={example.id}
              type="button"
              className="chip"
              onClick={() => useExample(example.query.value)}
              title={example.note}
            >
              {example.label}
            </button>
          ))}
        </div>
      </form>

      <aside className="disclaimer" role="note">
        {DISCLAIMER}
      </aside>

      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}

      <section className="stage">
        <div className="stage-main">
          <div className="graph-frame">
            <div className="crop tl" />
            <div className="crop tr" />
            <div className="crop bl" />
            <div className="crop br" />
            {visible && <GraphView graph={visible} selected={selected} onSelectNode={onSelectNode} onSelectEdge={onSelectEdge} />}
            {loading && <p className="graph-overlay">{loadMessage("loading")}</p>}
            {!loading && emptyMessage && <p className="graph-overlay">{emptyMessage}</p>}
            {expanding && <p className="graph-overlay subtle">Loading more transactions for this address…</p>}
          </div>
          <Legend />
        </div>

        <aside className="side">
          {visible && (
            <section>
              <p className="eyebrow">
                {visible.chain === "btc" ? "Bitcoin" : "Ethereum"} · {visible.origin.kind}
              </p>
              <h2>{shortAddress(visible.origin.value, 8)}</h2>
              <p className="mono full-mint">{visible.origin.value}</p>
              <dl className="facts">
                <div>
                  <dt>Addresses</dt>
                  <dd>{visible.nodes.length}</dd>
                </div>
                <div>
                  <dt>Flows</dt>
                  <dd>{visible.edges.length}</dd>
                </div>
                <div>
                  <dt>Transactions</dt>
                  <dd>{visible.transactionCount}</dd>
                </div>
              </dl>
              {originTotals && (
                <p className="muted">
                  Received {formatAmount(originTotals.received, visible.chain)} from the graph, sent{" "}
                  {formatAmount(originTotals.sent, visible.chain)}, across {originTotals.counterparties} counterparties in
                  this view.
                </p>
              )}
            </section>
          )}

          <section className="filters">
            <h3>Filters</h3>
            <label>
              Minimum amount ({graph ? unitLabel(graph.chain) : "native"})
              <input
                type="number"
                min={0}
                step="any"
                value={filters.minAmount}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, minAmount: Math.max(0, Number(event.target.value) || 0) }))
                }
              />
            </label>
            <label>
              Depth limit
              <input
                type="number"
                min={0}
                max={6}
                step={1}
                value={filters.maxDepth}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    maxDepth: Math.max(0, Math.min(6, Number(event.target.value) || 0)),
                  }))
                }
              />
            </label>
          </section>

          {visible?.warnings.map((warning) => (
            <p key={warning} className="banner warn">
              {warning}
            </p>
          ))}

          {selectedNode && visible && (
            <section className="detail">
              <h3>Selected address</h3>
              <p className="mono">{selectedNode.label ?? selectedNode.id}</p>
              <p className="muted">
                Role: {selectedNode.role}
                {selectedNode.isContract ? " · contract" : ""} · depth {selectedNode.depth}
                {selectedNode.expanded ? " · expanded" : ""}
              </p>
              <p className="muted">
                In this view: received {formatAmount(totalsFor(visible, selectedNode.id).received, visible.chain)}, sent{" "}
                {formatAmount(totalsFor(visible, selectedNode.id).sent, visible.chain)}.
              </p>
              <p>
                <a href={explorerAddressUrl(visible.chain, selectedNode.id)} target="_blank" rel="noreferrer">
                  Open in {visible.chain === "btc" ? "mempool.space" : "Etherscan"}
                </a>
              </p>
              <p className="muted">Click an address in the graph to load its recent transactions.</p>
            </section>
          )}

          {selectedEdge && visible && (
            <section className="detail">
              <h3>Selected flow</h3>
              <p>
                {shortAddress(selectedEdge.source)} → {shortAddress(selectedEdge.target)}
              </p>
              <p className="muted">
                {formatAmount(selectedEdge.amount, visible.chain)} across {selectedEdge.txids.length} transaction
                {selectedEdge.txids.length === 1 ? "" : "s"}.
              </p>
              <ul className="tx-list">
                {selectedEdge.txids.slice(0, 8).map((txid) => (
                  <li key={txid}>
                    <a href={explorerTxUrl(visible.chain, txid)} target="_blank" rel="noreferrer">
                      {shortAddress(txid, 8)}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {visible && (
            <section className="explain">
              <div className="explain-head">
                <h2>Explain this flow</h2>
                <button type="button" className="ghost" onClick={() => void explain()} disabled={explaining}>
                  {explaining ? "Writing…" : explanation ? "Regenerate" : "Explain this flow"}
                </button>
              </div>
              <p className="muted">
                Sends a compact summary of the visible graph to a free Gemini model. The model is told not to invent
                entity names and to say when it is unsure.
              </p>
              {explainError && (
                <p className="banner error" role="alert">
                  {explainError}
                </p>
              )}
              {explanation && <pre className="explanation">{explanation}</pre>}
            </section>
          )}
        </aside>
      </section>

      <footer className="foot">
        <p>No wallet connection. No signing. No real-money transfers. Public APIs only.</p>
        <p>
          <a href="https://github.com/ottonielmorais2008-rgb/crypto-flow-graph">Source on GitHub</a>
        </p>
      </footer>
    </div>
  );
}

function Legend() {
  const items = [
    ["searched", "Searched"],
    ["input", "Sender"],
    ["output", "Recipient"],
    ["both", "Both"],
    ["contract", "Contract"],
  ] as const;
  return (
    <ul className="legend">
      {items.map(([role, label]) => (
        <li key={role}>
          <span className="swatch" style={{ background: ROLE_COLOR[role] }} />
          {label}
        </li>
      ))}
    </ul>
  );
}
