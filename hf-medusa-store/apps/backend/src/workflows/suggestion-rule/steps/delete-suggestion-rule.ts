import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk'
import { SUGGESTIVE_SELLING_MODULE } from '../../../modules/suggestive-selling'
import { getSourceProductIds, invalidateSuggestionCache, replaceSourceProductLinks } from '../../../api/admin/suggestion-rules/helpers'

export const deleteSuggestionRuleStep = createStep('delete-suggestion-rule', async ({ id }: { id: string }, { container }) => {
  const service: any = container.resolve(SUGGESTIVE_SELLING_MODULE)
  const sourceProductIds = await getSourceProductIds(container, id)
  await replaceSourceProductLinks(container, id, [])
  await service.softDeleteSuggestionRules(id)
  await invalidateSuggestionCache(container, sourceProductIds)
  return new StepResponse({ id, object: 'suggestion_rule', deleted: true }, { id, sourceProductIds })
}, async (data, { container }) => {
  if (!data) return
  const service: any = container.resolve(SUGGESTIVE_SELLING_MODULE)
  await service.restoreSuggestionRules(data.id)
  await replaceSourceProductLinks(container, data.id, data.sourceProductIds)
  await invalidateSuggestionCache(container, data.sourceProductIds)
})
