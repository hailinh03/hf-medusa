"use server"

import { sdk } from "@lib/config"
import { revalidateTag } from "next/cache"
import { cookies as nextCookies } from "next/headers"
import {
  AddSuggestedResult,
  CartSuggestionsResponse,
  ProductSuggestionsResponse,
  SuggestionAttribution,
} from "@modules/suggestions/types"
import { getAuthHeaders, getCacheTag, getCartId } from "./cookies"
import { getOrSetCart } from "./cart"

/**
 * SuggestiveSelling data layer (SRS §6 / API_CONTRACT §1.1). Server-only; the
 * single shared `sdk` calls the custom store endpoints. Suggestions are
 * personalized (cart/dismissal) → never client-cached (`no-store`); the backend
 * owns the 5-min result cache (BR-06).
 */

const SID_COOKIE = "_sugg_sid"

/** Read the session-scope id (guest dismissal/analytics — D6). */
async function getSessionId(): Promise<string | null> {
  try {
    const cookies = await nextCookies()
    return cookies.get(SID_COOKIE)?.value ?? null
  } catch {
    return null
  }
}

/** Persist a client-generated session id (called from the client rail on mount). */
export async function syncSuggestionSession(sessionId: string): Promise<void> {
  if (!sessionId) return
  try {
    const cookies = await nextCookies()
    if (cookies.get(SID_COOKIE)?.value === sessionId) return
    cookies.set(SID_COOKIE, sessionId, {
      maxAge: 60 * 60 * 24, // ≤24h (D6)
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
    })
  } catch {
    // setting cookies outside an action/route is a no-op — ignore
  }
}

async function sessionHeaders(): Promise<Record<string, string>> {
  const auth = await getAuthHeaders()
  const sid = await getSessionId()
  return { ...auth, ...(sid ? { "x-session-id": sid } : {}) }
}

/** GET product-level suggestions ("Complete Your Setup" — SUGG-001). */
export async function getProductSuggestions({
  productId,
  cartId,
  limit = 5,
}: {
  productId: string
  cartId?: string
  limit?: number
}): Promise<ProductSuggestionsResponse> {
  try {
    return await sdk.client.fetch<ProductSuggestionsResponse>(
      `/store/products/${productId}/suggestions`,
      {
        method: "GET",
        query: { limit, ...(cartId ? { cart_id: cartId } : {}) },
        headers: await sessionHeaders(),
        cache: "no-store",
      },
    )
  } catch {
    return { suggestions: [], count: 0 } // BR-10: degrade to hidden section
  }
}

/** GET cart-level suggestions ("You Might Also Need" — SUGG-004). */
export async function getCartSuggestions({
  cartId,
  limit = 3,
}: {
  cartId: string
  limit?: number
}): Promise<CartSuggestionsResponse> {
  try {
    return await sdk.client.fetch<CartSuggestionsResponse>(
      `/store/carts/${cartId}/suggestions`,
      {
        method: "GET",
        query: { limit },
        headers: await sessionHeaders(),
        cache: "no-store",
      },
    )
  } catch {
    return { suggestions: [], count: 0, threshold_info: null }
  }
}

/** One-tap add of a suggested item with attribution (SF-03 / SUGG-003). */
export async function addSuggestedItem({
  variantId,
  productId,
  attribution,
  countryCode,
}: {
  variantId: string
  productId?: string
  attribution: SuggestionAttribution
  countryCode: string
}): Promise<AddSuggestedResult> {
  try {
    const cart = await getOrSetCart(countryCode) // ensures a cart exists
    const idempotencyKey =
      globalThis.crypto?.randomUUID?.() ??
      `${cart.id}:${variantId}:${Date.now()}`

    const resp = await sdk.client.fetch<{
      line_item: { id: string } | null
      updated_cart_total: number | null
    }>(`/store/carts/${cart.id}/suggested-items`, {
      method: "POST",
      headers: {
        ...(await sessionHeaders()),
        "idempotency-key": idempotencyKey,
      },
      body: {
        variant_id: variantId,
        product_id: productId,
        quantity: 1,
        attribution,
      },
    })

    revalidateTag(await getCacheTag("carts"))
    revalidateTag(await getCacheTag("fulfillment"))

    return {
      ok: true,
      line_item_id: resp.line_item?.id ?? null,
      updated_cart_total: resp.updated_cart_total ?? null,
    }
  } catch (e: any) {
    // Backend envelope: { code, customer_message } (API_CONTRACT §3).
    const body = e?.response?.data ?? e?.body ?? {}
    return {
      ok: false,
      code: body.code ?? "ADD_FAILED",
      message:
        body.customer_message ??
        "Không thêm được sản phẩm này. Bạn thử lại nhé!",
    }
  }
}

/** Undo a suggested add within the 3s window (SF-04) — plain line-item delete. */
export async function undoSuggestedAdd(lineItemId: string): Promise<void> {
  const cartId = await getCartId()
  if (!cartId || !lineItemId) return
  try {
    await sdk.client.fetch(`/store/carts/${cartId}/line-items/${lineItemId}`, {
      method: "DELETE",
      headers: await sessionHeaders(),
    })
    revalidateTag(await getCacheTag("carts"))
    revalidateTag(await getCacheTag("fulfillment"))
  } catch {
    // undo is best-effort; expired/gone handled by the UI
  }
}

/** Dismiss a suggestion for the session (SF-05 / SUGG-105). */
export async function dismissSuggestion({
  sourceContext,
  productId,
  ruleId,
  tier,
  slot,
  sourceProductId,
}: {
  sourceContext: "product_view" | "cart"
  productId: string
  ruleId?: string | null
  tier?: string | null
  slot?: number | null
  sourceProductId?: string | null
}): Promise<void> {
  try {
    await sdk.client.fetch(`/store/suggestion-dismissals`, {
      method: "POST",
      headers: await sessionHeaders(),
      body: {
        source_context: sourceContext,
        suggested_product_id: productId,
        rule_id: ruleId ?? null,
        tier: tier ?? null,
        slot: slot ?? null,
        source_product_id: sourceProductId ?? null,
      },
    })
  } catch {
    // fire-and-forget
  }
}

type TrackEvent = {
  action: "impression" | "tap" | "add_to_cart" | "dismiss"
  source_context: "product_view" | "cart"
  suggested_product_id: string
  source_product_id?: string | null
  rule_id?: string | null
  tier?: string | null
  slot?: number | null
}

/** Batch interaction tracking (SF-08 / SUGG-006), fire-and-forget. */
export async function trackSuggestionEvents(
  events: TrackEvent[],
): Promise<void> {
  if (!events?.length) return
  const sid = await getSessionId()
  try {
    await sdk.client.fetch(`/store/suggestion-events`, {
      method: "POST",
      headers: await sessionHeaders(),
      body: {
        events: events.slice(0, 10).map((e) => ({ ...e, session_id: sid })),
      },
    })
  } catch {
    // analytics loss is acceptable; UX never blocked (EC-12)
  }
}
