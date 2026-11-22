interface Entry<T> {
  at: number;
  value: T;
}

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export const DEFAULT_TTL_MS = 60_000;
export const MAX_CACHE_ENTRIES = 200;

export function resetCache(): void {
  store.clear();
  inflight.clear();
}

export async function cachedJson<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl = DEFAULT_TTL_MS,
  now = Date.now(),
): Promise<T> {
  const hit = store.get(key);
  if (hit && now - hit.at < ttl) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fetcher()
    .then((value) => {
      store.set(key, { at: now, value });
      if (store.size > MAX_CACHE_ENTRIES) {
        const first = store.keys().next().value;
        if (first) store.delete(first);
      }
      inflight.delete(key);
      return value;
    })
    .catch((error) => {
      inflight.delete(key);
      throw error;
    });

  inflight.set(key, promise);
  return promise;
}

export function cacheSize(): number {
  return store.size;
}
