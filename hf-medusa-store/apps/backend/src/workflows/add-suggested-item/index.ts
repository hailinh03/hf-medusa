import { createWorkflow, WorkflowResponse } from '@medusajs/framework/workflows-sdk'
import { addToCartWorkflow } from '@medusajs/medusa/core-flows'
import { createSuggestionEventsStep } from '../suggestion-event/steps/create-suggestion-events'
import { invalidateCartSuggestionsStep } from './steps/invalidate-cart-suggestions'
import type { SuggestionEventInput } from '../suggestion-event/types'

type AddSuggestedItemInput = {
  cart_id: string
  variant_id: string
  quantity: number
  metadata: Record<string, unknown>
  event: SuggestionEventInput
}

export const addSuggestedItemWorkflow = createWorkflow('add-suggested-item', (input: AddSuggestedItemInput) => {
  addToCartWorkflow.runAsStep({ input: { cart_id: input.cart_id, items: [{ variant_id: input.variant_id, quantity: input.quantity, metadata: input.metadata }] } })
  createSuggestionEventsStep({ events: [input.event], best_effort: true })
  invalidateCartSuggestionsStep({ cart_id: input.cart_id })
  return new WorkflowResponse({ added: true })
})
