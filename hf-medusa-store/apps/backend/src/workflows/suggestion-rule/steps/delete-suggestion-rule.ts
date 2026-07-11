import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk'
import { SUGGESTIVE_SELLING_MODULE } from '../../../modules/suggestive-selling'
import { bumpCartRuleVersion } from '../../../lib/suggestion-cache'
import { getSourceProductIds, invalidateSuggestionCache, replaceSourceProductLinks } from '../../../api/admin/suggestion-rules/helpers'

export const deleteSuggestionRuleStep = createStep('delete-suggestion-rule', async ({ id }: { id: string }, { container }) => {
  const service: any = container.resolve(SUGGESTIVE_SELLING_MODULE)
  const previous = await service.retrieveSuggestionRule(id)
  const sourceProductIds = await getSourceProductIds(container, id)
  await replaceSourceProductLinks(container, id, [])
  await service.softDeleteSuggestionRules(id)
  await invalidateSuggestionCache(container, sourceProductIds)
  if (previous.type === 'cart') await bumpCartRuleVersion(container)
  return new StepResponse({ id, object: 'suggestion_rule', deleted: true }, { id, sourceProductIds, type: previous.type })
}, async (data, { container }) => {
  if (!data) return
  const service: any = container.resolve(SUGGESTIVE_SELLING_MODULE)
  await service.restoreSuggestionRules(data.id)
  await replaceSourceProductLinks(container, data.id, data.sourceProductIds)
  await invalidateSuggestionCache(container, data.sourceProductIds)
  if (data.type === 'cart') await bumpCartRuleVersion(container)
})
