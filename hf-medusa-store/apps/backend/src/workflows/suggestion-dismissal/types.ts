import type { SuggestionEventInput } from '../suggestion-event/types'

export type DismissSuggestionInput = {
  scope: string
  context: 'product_view' | 'cart'
  product_id: string
  event: SuggestionEventInput
}
