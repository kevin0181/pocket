import type { PriceResult } from "@/lib/types";

const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; result: PriceResult }>();

export function getCachedResult(query: string) {
  const item = cache.get(query);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(query);
    return null;
  }
  return { ...item.result, cached: true };
}

export function setCachedResult(query: string, result: PriceResult) {
  cache.set(query, {
    expiresAt: Date.now() + TTL_MS,
    result: { ...result, cached: false },
  });
}
