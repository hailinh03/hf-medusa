import { matchesCartCondition, matchesCartRule, type CartRuleContext } from '../cart-rule-logic'

const context: CartRuleContext = { subtotal: 6_700_000, categoryIds: ['rackets'], brands: ['Yonex'], lines: [{ quantity: 1, categoryIds: ['shuttlecocks'], categoryNames: ['Shuttlecocks'] }] }

describe('cart rule conditions', () => {
  it('uses AND semantics', () => expect(matchesCartRule([
    { condition_type: 'threshold_near', condition_params: { percentage: 0.15 } },
    { condition_type: 'brand_match', condition_params: { accessory_category_ids: [] } },
  ], context)).toBe(true))
  it('rejects an empty rule', () => expect(matchesCartRule([], context)).toBe(false))
  it('matches missing configured categories', () => expect(matchesCartCondition({ condition_type: 'category_missing', condition_params: { source_category_ids: ['rackets'] } }, context)).toBe(true))
  it('does not match malformed threshold params', () => expect(matchesCartCondition({ condition_type: 'threshold_near', condition_params: { percentage: 2 } }, context)).toBe(false))
  it('matches a configured brand', () => expect(matchesCartCondition({ condition_type: 'brand_match', condition_params: { accessory_category_ids: [] } }, context)).toBe(true))
  it('matches a consumable line at the maximum quantity', () => expect(matchesCartCondition({ condition_type: 'consumable_upsell', condition_params: { max_quantity: 1 } }, context)).toBe(true))
})
