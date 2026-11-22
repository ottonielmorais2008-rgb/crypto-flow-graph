export type LoadStatus = "idle" | "loading" | "ready" | "error";
export type ExplainStatus = "idle" | "loading" | "ready" | "error";

export function loadMessage(status: LoadStatus, error?: string | null): string | null {
  if (status === "loading") return "Loading the flow from a public explorer API…";
  if (status === "error") return error || "The flow could not be loaded.";
  return null;
}

export function expandMessage(busy: boolean): string | null {
  return busy ? "Loading more transactions for this address…" : null;
}

export function emptyGraphMessage(nodeCount: number, edgeCount: number): string | null {
  if (nodeCount === 0 || edgeCount === 0) {
    return "No fund flows matched the current filters. Try a lower minimum amount or a higher depth.";
  }
  return null;
}

export function truncatedMessage(truncated: boolean): string | null {
  return truncated ? "The graph was limited to the largest flows so it stays readable." : null;
}
