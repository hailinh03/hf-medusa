import { createWorkflow, WorkflowResponse } from '@medusajs/framework/workflows-sdk'
import { addSuggestionDismissalStep } from './steps/add-suggestion-dismissal'
import { createSuggestionEventsStep } from '../suggestion-event/steps/create-suggestion-events'
import type { DismissSuggestionInput } from './types'

export const dismissSuggestionWorkflow = createWorkflow('dismiss-suggestion', (input: DismissSuggestionInput) => {
  addSuggestionDismissalStep(input)
  createSuggestionEventsStep({ events: [input.event], best_effort: true })
  return new WorkflowResponse({ dismissed: true })
})
