import { createWorkflow, WorkflowResponse } from '@medusajs/framework/workflows-sdk'
import { createSuggestionEventsStep } from './steps/create-suggestion-events'
import type { SuggestionEventInput } from './types'

export type CreateSuggestionEventsWorkflowInput = { events: SuggestionEventInput[]; best_effort?: boolean }

export const createSuggestionEventsWorkflow = createWorkflow('create-suggestion-events', (input: CreateSuggestionEventsWorkflowInput) => new WorkflowResponse(createSuggestionEventsStep(input)))
