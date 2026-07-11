import { z } from '@medusajs/framework/zod'

/**
 * Zod validators for admin suggestion-rule APIs (SRS Ã‚Â§6.1).
 * validateAndTransformBody (see src/api/middlewares.ts) parses the request body
 * with these and populates req.validatedBody.
 */

const RuleItemInput = z.object({
  suggested_product_id: z.string().min(1),
  display_order: z.number().int().default(0),
  custom_label: z.string().nullish(),
})

const CartConditionInput = z.discriminatedUnion('condition_type', [
  z.object({ condition_type: z.literal('category_missing'), condition_params: z.object({ source_category_ids: z.array(z.string().min(1)).min(1) }) }),
  z.object({ condition_type: z.literal('threshold_near'), condition_params: z.object({ percentage: z.number().min(0).max(1).default(0.15), badge_text: z.string().nullish() }) }),
  z.object({ condition_type: z.literal('brand_match'), condition_params: z.object({ accessory_category_ids: z.array(z.string().min(1)).default([]) }) }),
  z.object({ condition_type: z.literal('consumable_upsell'), condition_params: z.object({ consumable_category_ids: z.array(z.string().min(1)).default([]), max_quantity: z.number().int().nonnegative().default(1) }) }),
])

export const CreateSuggestionRuleSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['product', 'cart']),
  tier: z.enum(['manual', 'category', 'behavioral']).default('manual'),
  source_product_ids: z.array(z.string().min(1)).default([]),
  priority: z.number().int().default(0),
  is_active: z.boolean().default(true),
  valid_from: z.coerce.date().nullish(),
  valid_to: z.coerce.date().nullish(),
  items: z.array(RuleItemInput).default([]),
  conditions: z.array(CartConditionInput).default([]),
})

// All fields optional on update; items/conditions (if provided) replace existing.
export const UpdateSuggestionRuleSchema = CreateSuggestionRuleSchema.partial()

export type CreateSuggestionRuleBody = z.infer<typeof CreateSuggestionRuleSchema>
export type UpdateSuggestionRuleBody = z.infer<typeof UpdateSuggestionRuleSchema>
