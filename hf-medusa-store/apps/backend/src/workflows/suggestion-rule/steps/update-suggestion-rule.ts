import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk'
import { SUGGESTIVE_SELLING_MODULE } from '../../../modules/suggestive-selling'
import { AdminErrors } from '../../../lib/errors'
import { findPriorityConflict, getSourceProductIds, invalidateSuggestionCache, replaceSourceProductLinks, withSourceProducts } from '../../../api/admin/suggestion-rules/helpers'
import type { RuleUpdateInput } from '../types'

export const updateSuggestionRuleStep = createStep('update-suggestion-rule', async (input: RuleUpdateInput, { container }) => {
  const service: any = container.resolve(SUGGESTIVE_SELLING_MODULE)
  const { id, items, conditions, source_product_ids, ...ruleData } = input
  const previous = await service.retrieveSuggestionRule(id, { relations: ['items', 'conditions'] })
  const previousSourceProductIds = await getSourceProductIds(container, id)
  const conflict = await findPriorityConflict(container, service, ruleData.type ?? previous.type, ruleData.tier ?? previous.tier, ruleData.priority ?? previous.priority, source_product_ids ?? previousSourceProductIds, id)
  if (conflict) throw AdminErrors.rulePriorityConflict(conflict)
  if (Object.keys(ruleData).length) await service.updateSuggestionRules({ id, ...ruleData })
  if (items !== undefined) {
    const existing = await service.listSuggestionRuleItems({ rule_id: id }, { select: ['id'] })
    if (existing.length) await service.deleteSuggestionRuleItems(existing.map((item: any) => item.id))
    if (items.length) await service.createSuggestionRuleItems(items.map((item) => ({ ...item, rule_id: id })))
  }
  if (conditions !== undefined) {
    const existing = await service.listCartSuggestionConditions({ rule_id: id }, { select: ['id'] })
    if (existing.length) await service.deleteCartSuggestionConditions(existing.map((item: any) => item.id))
    if (conditions.length) await service.createCartSuggestionConditions(conditions.map((item) => ({ ...item, rule_id: id })))
  }
  if (source_product_ids !== undefined) await replaceSourceProductLinks(container, id, source_product_ids)
  const updated = await service.retrieveSuggestionRule(id, { relations: ['items', 'conditions'] })
  const [result] = await withSourceProducts(container, [updated])
  await invalidateSuggestionCache(container, [...previousSourceProductIds, ...result.source_product_ids])
  return new StepResponse(result, { previous, previousSourceProductIds })
}, async (data, { container }) => {
  if (!data) return
  const service: any = container.resolve(SUGGESTIVE_SELLING_MODULE)
  const { items = [], conditions = [], ...rule } = data.previous as any
  await service.updateSuggestionRules(rule)
  const currentItems = await service.listSuggestionRuleItems({ rule_id: rule.id }, { select: ['id'] })
  if (currentItems.length) await service.deleteSuggestionRuleItems(currentItems.map((item: any) => item.id))
  if (items.length) await service.createSuggestionRuleItems(items.map(({ id: _id, ...item }: any) => ({ ...item, rule_id: rule.id })))
  const currentConditions = await service.listCartSuggestionConditions({ rule_id: rule.id }, { select: ['id'] })
  if (currentConditions.length) await service.deleteCartSuggestionConditions(currentConditions.map((item: any) => item.id))
  if (conditions.length) await service.createCartSuggestionConditions(conditions.map(({ id: _id, ...item }: any) => ({ ...item, rule_id: rule.id })))
  await replaceSourceProductLinks(container, rule.id, data.previousSourceProductIds)
  await invalidateSuggestionCache(container, data.previousSourceProductIds)
})
