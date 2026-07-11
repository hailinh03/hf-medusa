import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk'
import { SUGGESTIVE_SELLING_MODULE } from '../../../modules/suggestive-selling'
import { bumpCartRuleVersion } from '../../../lib/suggestion-cache'
import { AdminErrors } from '../../../lib/errors'
import { findPriorityConflict, invalidateSuggestionCache, replaceSourceProductLinks, withSourceProducts } from '../../../api/admin/suggestion-rules/helpers'
import type { CreateSuggestionRuleBody } from '../../../api/admin/suggestion-rules/validators'

export const createSuggestionRuleStep = createStep('create-suggestion-rule', async (input: CreateSuggestionRuleBody, { container }) => {
  const service: any = container.resolve(SUGGESTIVE_SELLING_MODULE)
  const { items, conditions, source_product_ids, ...ruleData } = input
  const conflict = await findPriorityConflict(container, service, ruleData.type, ruleData.tier, ruleData.priority, source_product_ids)
  if (conflict) throw AdminErrors.rulePriorityConflict(conflict)
  const rule = await service.createSuggestionRules({ ...ruleData, items, conditions })
  await replaceSourceProductLinks(container, rule.id, source_product_ids)
  await invalidateSuggestionCache(container, source_product_ids)
  if (ruleData.type === 'cart') await bumpCartRuleVersion(container)
  const [result] = await withSourceProducts(container, [rule])
  return new StepResponse(result, { id: rule.id, source_product_ids })
}, async (data, { container }) => {
  if (!data) return
  await replaceSourceProductLinks(container, data.id, [])
  const service: any = container.resolve(SUGGESTIVE_SELLING_MODULE)
  await service.deleteSuggestionRules(data.id)
  await invalidateSuggestionCache(container, data.source_product_ids)
  await bumpCartRuleVersion(container)
})
