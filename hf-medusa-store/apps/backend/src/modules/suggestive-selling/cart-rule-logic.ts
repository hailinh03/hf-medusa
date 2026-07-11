import { CONSUMABLE_CATEGORIES, CR02_THRESHOLD_PCT } from './constants'
import { cr02Fires } from './evaluator-logic'

export type CartRuleContext = {
  subtotal: number
  categoryIds: string[]
  brands: string[]
  lines: Array<{ quantity: number; categoryIds: string[]; categoryNames: string[] }>
}

export type CartRuleCondition = {
  condition_type: 'category_missing' | 'threshold_near' | 'brand_match' | 'consumable_upsell'
  condition_params?: Record<string, unknown> | null
}

export function matchesCartCondition(condition: CartRuleCondition, context: CartRuleContext): boolean {
  const params = condition.condition_params ?? {}
  switch (condition.condition_type) {
    case 'category_missing': {
      const ids = Array.isArray(params.source_category_ids) ? params.source_category_ids.filter((id): id is string => typeof id === 'string') : []
      return ids.length > 0 && ids.some((id) => context.categoryIds.includes(id))
    }
    case 'threshold_near': {
      const percentage = params.percentage == null ? CR02_THRESHOLD_PCT : Number(params.percentage)
      return Number.isFinite(percentage) && percentage >= 0 && percentage <= 1 && cr02Fires(context.subtotal, 7_000_000, percentage)
    }
    case 'brand_match': {
      return [...new Set(context.brands.filter(Boolean))].length === 1
    }
    case 'consumable_upsell': {
      const configured = Array.isArray(params.consumable_category_ids) ? params.consumable_category_ids.filter((id): id is string => typeof id === 'string') : []
      const maxQuantity = params.max_quantity == null ? 1 : Number(params.max_quantity)
      if (!Number.isFinite(maxQuantity) || maxQuantity < 0) return false
      return context.lines.some((line) => line.quantity <= maxQuantity && (!configured.length || line.categoryIds.some((id) => configured.includes(id))))
    }
  }
}

/** All conditions in a rule use AND semantics. Empty rules never fire. */
export function matchesCartRule(conditions: CartRuleCondition[], context: CartRuleContext): boolean {
  return conditions.length > 0 && conditions.every((condition) => matchesCartCondition(condition, context))
}
