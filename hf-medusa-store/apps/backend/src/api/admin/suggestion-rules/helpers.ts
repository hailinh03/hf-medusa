import { MedusaContainer } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { invalidateProductSuggestions } from '../../../lib/suggestion-cache'
import { SUGGESTIVE_SELLING_MODULE } from '../../../modules/suggestive-selling'

type SourceProduct = {
  id: string
  title?: string
}

type SuggestionRule = Record<string, unknown> & {
  id: string
}

const linkDefinition = (ruleId: string, productId: string) => ({
  [SUGGESTIVE_SELLING_MODULE]: {
    suggestion_rule_id: ruleId,
  },
  [Modules.PRODUCT]: {
    product_id: productId,
  },
})

export async function withSourceProducts<T extends SuggestionRule>(
  scope: MedusaContainer,
  rules: T[]
): Promise<Array<T & { source_products: SourceProduct[]; source_product_ids: string[] }>> {
  if (!rules.length) {
    return []
  }

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: 'suggestion_rule',
    fields: ['id', 'products.id', 'products.title'],
    filters: {
      id: rules.map((rule) => rule.id),
    },
  })

  const productsByRuleId = new Map<string, SourceProduct[]>(
    data.map((rule: any) => [rule.id, rule.products ?? []])
  )

  return rules.map((rule) => {
    const sourceProducts = productsByRuleId.get(rule.id) ?? []

    return {
      ...rule,
      source_products: sourceProducts,
      source_product_ids: sourceProducts.map((product) => product.id),
    }
  })
}

export async function getSourceProductIds(
  scope: MedusaContainer,
  ruleId: string
): Promise<string[]> {
  const [rule] = await withSourceProducts(scope, [{ id: ruleId }])
  return rule?.source_product_ids ?? []
}

export async function replaceSourceProductLinks(
  scope: MedusaContainer,
  ruleId: string,
  productIds: string[]
): Promise<string[]> {
  const link = scope.resolve(ContainerRegistrationKeys.LINK)
  const currentIds = await getSourceProductIds(scope, ruleId)
  const nextIds = [...new Set(productIds)]
  const current = new Set(currentIds)
  const next = new Set(nextIds)

  const linksToDismiss = currentIds
    .filter((productId) => !next.has(productId))
    .map((productId) => linkDefinition(ruleId, productId))
  const linksToCreate = nextIds
    .filter((productId) => !current.has(productId))
    .map((productId) => linkDefinition(ruleId, productId))

  if (linksToDismiss.length) {
    await link.dismiss(linksToDismiss)
  }
  if (linksToCreate.length) {
    await link.create(linksToCreate)
  }

  return nextIds
}

export async function findPriorityConflict(
  scope: MedusaContainer,
  service: any,
  type: string,
  tier: string,
  priority: number,
  sourceProductIds: string[],
  excludeId?: string
): Promise<{ id: string; name: string } | null> {
  const candidates = await service.findPriorityConflicts(type, tier, priority, excludeId)
  if (!candidates.length) {
    return null
  }

  // Cart rules have no source-product scope, so priority remains global.
  if (type !== 'product') {
    return candidates[0]
  }

  const sourceIds = new Set(sourceProductIds)
  if (!sourceIds.size) {
    return null
  }

  const candidatesWithProducts = await withSourceProducts(scope, candidates)
  const conflict = candidatesWithProducts.find((rule) =>
    rule.source_product_ids.some((productId) => sourceIds.has(productId))
  )

  return conflict ? { id: conflict.id, name: conflict.name as string } : null
}
export async function invalidateSuggestionCache(
  scope: MedusaContainer,
  productIds: string[]
): Promise<void> {
  const uniqueIds = [...new Set(productIds)]
  await Promise.all(uniqueIds.map((productId) => invalidateProductSuggestions(scope, productId)))
}
