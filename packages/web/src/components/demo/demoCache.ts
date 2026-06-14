import { DemoBundle } from "../../contracts/demoBundle";

/**
 * Module-level (page-lifetime) cache of built demo bundles, keyed by
 * sessionId + updatedAt. Survives DemoView unmount/remount so re-opening the
 * same session's demo is instant and re-issues no requests. The updatedAt in
 * the key auto-invalidates a stale bundle when the conversation has advanced.
 *
 * Bundles embed file bytes (base64), so an LRU cap bounds memory.
 */

const MAX_CACHED = 6;
const cache = new Map<string, DemoBundle>();

function keyFor(sessionId: string, updatedAt?: string): string {
  return updatedAt ? `${sessionId}::${updatedAt}` : sessionId;
}

export function getCachedBundle(sessionId: string, updatedAt?: string): DemoBundle | null {
  const key = keyFor(sessionId, updatedAt);
  const hit = cache.get(key);
  if (!hit) {
    return null;
  }
  // Mark as most-recently-used (Map preserves insertion order).
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

export function setCachedBundle(sessionId: string, updatedAt: string | undefined, bundle: DemoBundle): void {
  const key = keyFor(sessionId, updatedAt);
  cache.delete(key);
  cache.set(key, bundle);
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
}
