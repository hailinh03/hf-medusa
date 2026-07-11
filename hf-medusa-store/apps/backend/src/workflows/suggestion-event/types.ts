export type SuggestionEventInput = {
  rule_id?: string | null
  source_context: 'product_view' | 'cart'
  source_product_id?: string | null
  suggested_product_id: string
  customer_id?: string | null
  session_id?: string | null
  action: 'impression' | 'tap' | 'add_to_cart' | 'dismiss'
  tier?: string | null
  slot?: number | null
}
