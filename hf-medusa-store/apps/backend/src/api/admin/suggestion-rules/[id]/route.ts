import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { SUGGESTIVE_SELLING_MODULE } from '../../../../modules/suggestive-selling'
import { UpdateSuggestionRuleBody } from '../validators'
import { withSourceProducts } from '../helpers'
import { deleteSuggestionRuleWorkflow, updateSuggestionRuleWorkflow } from '../../../../workflows/suggestion-rule'
/**
 * GET /admin/suggestion-rules/:id --- retrieve one rule with items + conditions.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(SUGGESTIVE_SELLING_MODULE)
  const rule = await service.retrieveSuggestionRule(req.params.id, {
    relations: ['items', 'conditions'],
  })
  const [suggestion_rule] = await withSourceProducts(req.scope, [rule])
  res.json({ suggestion_rule })
}

/** Update a suggestion rule through a compensating Medusa workflow. */
export const PUT = async (req: MedusaRequest<UpdateSuggestionRuleBody>, res: MedusaResponse) => {
  const { result: suggestion_rule } = await updateSuggestionRuleWorkflow(req.scope).run({
    input: { id: req.params.id, ...req.validatedBody },
  })
  res.json({ suggestion_rule })
}

/** Soft-delete a suggestion rule through a compensating Medusa workflow. */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await deleteSuggestionRuleWorkflow(req.scope).run({ input: { id: req.params.id } })
  res.json(result)
}