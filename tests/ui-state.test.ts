
import { describe, expect, it } from "vitest";
import { emptyGraphMessage, expandMessage, loadMessage, truncatedMessage } from "../src/lib/ui-state.js";

describe("UI status copy", () => {
  it("returns a loading message and surfaces errors", () => {
    expect(loadMessage("loading")).toMatch(/Loading/);
    expect(loadMessage("error", "Nope")).toBe("Nope");
    expect(loadMessage("error")).toMatch(/could not be loaded/);
    expect(loadMessage("ready")).toBeNull();
    expect(loadMessage("idle")).toBeNull();
  });

  it("describes expansion, empty graphs and truncation", () => {
    expect(expandMessage(true)).toMatch(/Loading more/);
    expect(expandMessage(false)).toBeNull();
    expect(emptyGraphMessage(0, 0)).toMatch(/No fund flows/);
    expect(emptyGraphMessage(3, 2)).toBeNull();
    expect(truncatedMessage(true)).toMatch(/largest flows/);
    expect(truncatedMessage(false)).toBeNull();
  });
});
