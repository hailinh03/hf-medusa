import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk'
import { invalidateCartSuggestions } from '../../../lib/suggestion-cache'

export const invalidateCartSuggestionsStep = createStep('invalidate-cart-suggestions', async ({ cart_id }: { cart_id: string }, { container }) => {
  await invalidateCartSuggestions(container, cart_id)
  return new StepResponse(undefined)
})
