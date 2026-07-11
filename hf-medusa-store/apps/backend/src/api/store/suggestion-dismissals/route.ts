import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { dismissalScope } from "../../../lib/suggestion-cache";
import { dismissSuggestionWorkflow } from "../../../workflows/suggestion-dismissal";

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as any;
  const context = body.source_context;
  const productId = body.suggested_product_id;
  if (!["product_view", "cart"].includes(context) || !productId) {
    return res.status(422).json({ type: "invalid_data", code: "VALIDATION_ERROR", message: "source_context and suggested_product_id are required", customer_message: "Yêu cầu không hợp lệ." });
  }
  const customerId = (req as any).auth_context?.actor_type === "customer" ? (req as any).auth_context.actor_id : null;
  const sessionId = (req.headers["x-session-id"] as string) ?? null;
  const { result } = await dismissSuggestionWorkflow(req.scope).run({
    input: {
      scope: dismissalScope(customerId, sessionId),
      context,
      product_id: productId,
      event: { rule_id: body.rule_id ?? null, source_context: context, source_product_id: body.source_product_id ?? null, suggested_product_id: productId, customer_id: customerId, session_id: sessionId, action: "dismiss", tier: body.tier ?? null, slot: typeof body.slot === "number" ? body.slot : null },
    },
  });
  res.json(result);
};