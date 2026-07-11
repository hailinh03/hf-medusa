import { createWorkflow, WorkflowResponse } from '@medusajs/framework/workflows-sdk'
import type { CategoryComplementInput, CategoryComplementUpdateInput } from './types'
import { createCategoryComplementStep } from './steps/create-category-complement'
import { updateCategoryComplementStep } from './steps/update-category-complement'
import { deleteCategoryComplementStep } from './steps/delete-category-complement'

export const createCategoryComplementWorkflow = createWorkflow('create-category-complement', (input: CategoryComplementInput) => new WorkflowResponse(createCategoryComplementStep(input)))
export const updateCategoryComplementWorkflow = createWorkflow('update-category-complement', (input: CategoryComplementUpdateInput) => new WorkflowResponse(updateCategoryComplementStep(input)))
export const deleteCategoryComplementWorkflow = createWorkflow('delete-category-complement', (input: { id: string }) => new WorkflowResponse(deleteCategoryComplementStep(input)))
