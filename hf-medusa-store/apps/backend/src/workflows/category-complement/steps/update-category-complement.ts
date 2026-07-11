import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk'
import { SUGGESTIVE_SELLING_MODULE } from '../../../modules/suggestive-selling'
import { invalidateCategorySuggestions } from '../../../lib/suggestion-cache'
import { assertCategoryComplementUnique } from '../utils'
import type { CategoryComplementUpdateInput } from '../types'

export const updateCategoryComplementStep = createStep('update-category-complement', async (input: CategoryComplementUpdateInput, { container }) => {
  const service: any = container.resolve(SUGGESTIVE_SELLING_MODULE)
  const previous = await service.retrieveCategoryComplementMapping(input.id)
  const next = { id: input.id, source_category_id: input.source_category_id ?? previous.source_category_id, complement_category_id: input.complement_category_id ?? previous.complement_category_id, display_order: Number(input.display_order ?? previous.display_order), is_active: input.is_active ?? previous.is_active }
  await assertCategoryComplementUnique(service, next, input.id)
  const result = await service.updateCategoryComplementMappings(next)
  await invalidateCategorySuggestions(container, previous.source_category_id)
  if (next.source_category_id !== previous.source_category_id) await invalidateCategorySuggestions(container, next.source_category_id)
  return new StepResponse(result, previous)
}, async (previous, { container }) => {
  if (!previous) return
  const service: any = container.resolve(SUGGESTIVE_SELLING_MODULE)
  await service.updateCategoryComplementMappings(previous)
  await invalidateCategorySuggestions(container, previous.source_category_id)
})
