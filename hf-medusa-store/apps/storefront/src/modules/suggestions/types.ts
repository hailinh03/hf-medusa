// Storefront types for the SuggestiveSelling feature (mirrors backend
// API_CONTRACT §1.1 responses). Kept out of the "use server" data file because
// server files may only export async functions.

export type SuggestionAttribution = {
  rule_id: string | null
  source_context: "product_view" | "cart"
  source_product_id: string | null
}

export type Suggestion = {
  product_id: string
  handle?: string | null
  variant_id: string | null
  name: string
  image_url: string | null
  price: number | null
  discount_price: number | null
  in_stock: boolean
  requires_variant_selection: boolean
  tier: string
  rule_id: string | null
  label?: string | null
  display_order?: number
  // cart-level only
  rule_code?: string
  badge_text?: string | null
}

export type ThresholdInfo = {
  target: number
  current: number
  remaining: number
}

export type ProductSuggestionsResponse = {
  suggestions: Suggestion[]
  count: number
}

export type CartSuggestionsResponse = {
  suggestions: Suggestion[]
  count: number
  threshold_info: ThresholdInfo | null
}

export type AddSuggestedResult =
  | { ok: true; line_item_id: string | null; updated_cart_total: number | null }
  | { ok: false; code: string; message: string }
