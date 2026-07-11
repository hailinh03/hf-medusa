import { createWorkflow, WorkflowResponse } from '@medusajs/framework/workflows-sdk'
import type { CreateSuggestionRuleBody } from '../../api/admin/suggestion-rules/validators'
import type { RuleUpdateInput } from './types'
import { createSuggestionRuleStep } from './steps/create-suggestion-rule'
import { updateSuggestionRuleStep } from './steps/update-suggestion-rule'
import { deleteSuggestionRuleStep } from './steps/delete-suggestion-rule'

export const createSuggestionRuleWorkflow = createWorkflow('create-suggestion-rule', (input: CreateSuggestionRuleBody) => new WorkflowResponse(createSuggestionRuleStep(input)))
export const updateSuggestionRuleWorkflow = createWorkflow('update-suggestion-rule', (input: RuleUpdateInput) => new WorkflowResponse(updateSuggestionRuleStep(input)))
export const deleteSuggestionRuleWorkflow = createWorkflow('delete-suggestion-rule', (input: { id: string }) => new WorkflowResponse(deleteSuggestionRuleStep(input)))
