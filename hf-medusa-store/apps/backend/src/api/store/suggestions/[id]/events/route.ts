import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { CreateSuggestionEventBody } from '../../validators'
import { createSuggestionEventsWorkflow } from '../../../../../workflows/suggestion-event'

export const POST = async (req: MedusaRequest<CreateSuggestionEventBody>, res: MedusaResponse) => {
  const { action, source_context, source_product_id, session_id, rule_id } = req.validatedBody
  const customer_id = (req as any).auth_context?.actor_id ?? null
  const { result } = await createSuggestionEventsWorkflow(req.scope).run({
    input: { events: [{ suggested_product_id: req.params.id, action, source_context, source_product_id: source_product_id ?? null, session_id: session_id ?? null, rule_id: rule_id ?? null, customer_id }] },
  })
  res.status(201).json({ event: result.events[0] })
}