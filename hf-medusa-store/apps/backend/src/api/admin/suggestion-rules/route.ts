import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { SUGGESTIVE_SELLING_MODULE } from '../../../modules/suggestive-selling'
import { CreateSuggestionRuleBody } from './validators'
import { withSourceProducts } from './helpers'
import { createSuggestionRuleWorkflow } from '../../../workflows/suggestion-rule'

/**
 * GET /admin/suggestion-rules --- list rules (SRS --6.1).
 * Query: type, is_active, limit, offset. Returns rules with items + conditions.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(SUGGESTIVE_SELLING_MODULE)

  const { type, tier, is_active, limit = '50', offset = '0' } = req.query as Record<string, string>
  const filters: Record<string, unknown> = {}
  if (type) filters.type = type
  if (tier) filters.tier = tier
  if (is_active !== undefined) filters.is_active = is_active === 'true'

  const [rules, count] = await service.listAndCountSuggestionRules(filters, {
    relations: ['items', 'conditions'],
    take: Number(limit),
    skip: Number(offset),
    order: { priority: 'ASC' },
  })
  const suggestion_rules = await withSourceProducts(req.scope, rules)

  res.json({ suggestion_rules, count, limit: Number(limit), offset: Number(offset) })
}

/**
 * POST /admin/suggestion-rules --- create a rule with nested items + conditions.
 */
export const POST = async (
  req: MedusaRequest<CreateSuggestionRuleBody>,
  res: MedusaResponse
) => {
  const { result: suggestion_rule } = await createSuggestionRuleWorkflow(req.scope).run({
    input: req.validatedBody,
  })
  res.status(201).json({ suggestion_rule })
}