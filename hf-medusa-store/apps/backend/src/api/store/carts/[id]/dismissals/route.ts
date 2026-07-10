import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { SUGGESTIVE_SELLING_MODULE } from "../../../../../modules/suggestive-selling";
import {
  addDismissal,
  dismissalScope,
} from "../../../../../lib/suggestion-cache";

/**
 * POST /store/carts/:id/dismissals — SF-05 / SUGG-105 (API_CONTRACT §1.1).
 * Records a session-scoped dismissal of (source_context × product), server-side
 * (D6). Also emits a `dismiss` analytics event (SF-08).
 *
 * Body: { source_context: 'product_view'|'cart', suggested_product_id }
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as any;
  const context = body.source_context;
  const productId = body.suggested_product_id;
  if (!["product_view", "cart"].includes(context) || !productId) {
    return res.status(422).json({
      type: "invalid_data",
      code: "VALIDATION_ERROR",
      message: "source_context and suggested_product_id are required",
      customer_message: "Yêu cầu không hợp lệ.",
    });
  }

  const customerId =
    (req as any).auth_context?.actor_type === "customer"
      ? (req as any).auth_context.actor_id
      : null;
  const sessionId = (req.headers["x-session-id"] as string) ?? null;
  const scope = dismissalScope(customerId, sessionId);

  await addDismissal(req.scope, scope, context, productId);

  // dismiss analytics event (fire-and-forget)
  const service: any = req.scope.resolve(SUGGESTIVE_SELLING_MODULE);
  await service.recordEvents([
    {
      rule_id: body.rule_id ?? null,
      source_context: context,
      source_product_id: body.source_product_id ?? null,
      suggested_product_id: productId,
      customer_id: customerId,
      session_id: sessionId,
      action: "dismiss",
      tier: body.tier ?? null,
      slot: typeof body.slot === "number" ? body.slot : null,
    },
  ]);

  res.json({ dismissed: true });
};
