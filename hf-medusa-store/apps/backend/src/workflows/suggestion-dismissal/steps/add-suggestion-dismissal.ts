import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk'
import { addDismissal, removeDismissal } from '../../../lib/suggestion-cache'
import type { DismissSuggestionInput } from '../types'

export const addSuggestionDismissalStep = createStep('add-suggestion-dismissal', async (input: DismissSuggestionInput, { container }) => {
  await addDismissal(container, input.scope, input.context, input.product_id)
  return new StepResponse(undefined, input)
}, async (input, { container }) => {
  if (!input) return
  await removeDismissal(container, input.scope, input.context, input.product_id)
})
