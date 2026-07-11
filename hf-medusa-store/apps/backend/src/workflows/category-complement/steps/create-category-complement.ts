import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk'
import { SUGGESTIVE_SELLING_MODULE } from '../../../modules/suggestive-selling'
import { invalidateCategorySuggestions } from '../../../lib/suggestion-cache'
import { assertCategoryComplementUnique } from '../utils'
import type { CategoryComplementInput } from '../types'

export const createCategoryComplementStep = createStep('create-category-complement', async (input: CategoryComplementInput, { container }) => {
  const service: any = container.resolve(SUGGESTIVE_SELLING_MODULE)
  const normalized = { ...input, display_order: Number(input.display_order ?? 0), is_active: input.is_active ?? true }
  await assertCategoryComplementUnique(service, normalized)
  const result = await service.createCategoryComplementMappings(normalized)
  await invalidateCategorySuggestions(container, result.source_category_id)
  return new StepResponse(result, { id: result.id, source_category_id: result.source_category_id })
}, async (data, { container }) => {
  if (!data) return
  const service: any = container.resolve(SUGGESTIVE_SELLING_MODULE)
  await service.deleteCategoryComplementMappings(data.id)
  await invalidateCategorySuggestions(container, data.source_category_id)
})
