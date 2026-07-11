import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk'
import { SUGGESTIVE_SELLING_MODULE } from '../../../modules/suggestive-selling'
import { invalidateCategorySuggestions } from '../../../lib/suggestion-cache'

export const deleteCategoryComplementStep = createStep('delete-category-complement', async ({ id }: { id: string }, { container }) => {
  const service: any = container.resolve(SUGGESTIVE_SELLING_MODULE)
  const previous = await service.retrieveCategoryComplementMapping(id)
  await service.deleteCategoryComplementMappings(id)
  await invalidateCategorySuggestions(container, previous.source_category_id)
  return new StepResponse({ id, object: 'category_complement', deleted: true }, previous)
}, async (previous, { container }) => {
  if (!previous) return
  const service: any = container.resolve(SUGGESTIVE_SELLING_MODULE)
  await service.createCategoryComplementMappings(previous)
  await invalidateCategorySuggestions(container, previous.source_category_id)
})
