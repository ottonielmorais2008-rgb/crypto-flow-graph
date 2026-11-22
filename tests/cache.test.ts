
import { describe, expect, it, vi } from "vitest";
import { cachedJson, cacheSize, resetCache } from "../src/lib/cache.js";

describe("cachedJson", () => {
  it("returns a cached value within the TTL and does not refetch", async () => {
    resetCache();
    const fetcher = vi.fn(async () => 42);
    const first = await cachedJson("k", fetcher, 1_000, 1_000);
    const second = await cachedJson("k", fetcher, 1_000, 1_500);
    expect(first).toBe(42);
    expect(second).toBe(42);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cacheSize()).toBe(1);
  });

  it("coalesces in-flight lookups for the same key", async () => {
    resetCache();
    let resolve!: (value: string) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<string>((next) => {
          resolve = next;
        }),
    );
    const first = cachedJson("same", fetcher);
    const second = cachedJson("same", fetcher);
    resolve("ok");
    expect(await first).toBe("ok");
    expect(await second).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches after the TTL expires", async () => {
    resetCache();
    const fetcher = vi.fn(async () => Date.now());
    await cachedJson("expire", fetcher, 100, 0);
    await cachedJson("expire", fetcher, 100, 150);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
