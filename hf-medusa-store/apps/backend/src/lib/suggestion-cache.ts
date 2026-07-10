import { Modules } from "@medusajs/framework/utils";
import {
  SUGGESTION_CACHE_TTL,
  dismissKey,
  productCacheKey,
  cartCacheKey,
} from "../modules/suggestive-selling/constants";

/**
 * Cache + dismissal helpers — SPEC A.9 / D6 / BR-06.
 * Cache is optional (D11): if the CACHE module is absent, all ops no-op safely.
 * Dismissals are session-scoped server-side state (never in shared result cache).
 */

const DISMISS_TTL = 24 * 60 * 60; // ≤24h (D6)

function cache(container: any): any | null {
  try {
    return container.resolve(Modules.CACHE);
  } catch {
    return null;
  }
}

/** Scope = customer id if authenticated, else session id (BR-08 / SF-05). */
export function dismissalScope(
  customerId?: string | null,
  sessionId?: string | null,
): string {
  return customerId ? `cus:${customerId}` : `sess:${sessionId ?? "anon"}`;
}

export async function getDismissed(
  container: any,
  scope: string,
  context: string,
): Promise<string[]> {
  const c = cache(container);
  if (!c) return [];
  return ((await c.get(dismissKey(scope, context))) as string[]) ?? [];
}

export async function addDismissal(
  container: any,
  scope: string,
  context: string,
  productId: string,
): Promise<void> {
  const c = cache(container);
  if (!c) return;
  const key = dismissKey(scope, context);
  const set = new Set<string>(((await c.get(key)) as string[]) ?? []);
  set.add(productId);
  await c.set(key, [...set], DISMISS_TTL);
}

/** Invalidate the cart's cached suggestion result (SUGG-005, synchronous). */
export async function invalidateCartSuggestions(
  container: any,
  cartId: string,
): Promise<void> {
  const c = cache(container);
  if (!c) return;
  await c.invalidate(cartCacheKey(cartId));
}

/** Invalidate a product's cached suggestion result (rule change / stock-out). */
export async function invalidateProductSuggestions(
  container: any,
  productId: string,
): Promise<void> {
  const c = cache(container);
  if (!c) return;
  await c.invalidate(productCacheKey(productId));
}

export { SUGGESTION_CACHE_TTL };
