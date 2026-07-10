import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { EvaluationEngine } from "../../../../../modules/suggestive-selling/evaluator";
import { CART_LIMIT } from "../../../../../modules/suggestive-selling/constants";
import {
  dismissalScope,
  getDismissed,
} from "../../../../../lib/suggestion-cache";

/**
 * GET /store/carts/:id/suggestions — SF-02 / SUGG-004 (API_CONTRACT §1.1).
 * "You Might Also Need". Cached per cart (invalidated on cart.updated); dismissal
 * applied per-request. BR-10: any failure → 200 empty + threshold_info null.
 *
 * Query: limit? (≤3). Header: x-session-id.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const cartId = req.params.id;
  try {
    const engine = new EvaluationEngine(req.scope);
    const customerId =
      (req as any).auth_context?.actor_type === "customer"
        ? (req as any).auth_context.actor_id
        : null;
    const sessionId = (req.headers["x-session-id"] as string) ?? null;
    const limit = Math.min(Number(req.query.limit ?? CART_LIMIT), CART_LIMIT);

    const dismissed = await getDismissed(
      req.scope,
      dismissalScope(customerId, sessionId),
      "cart",
    );

    const { suggestions, threshold_info } = await engine.evaluateCart(cartId, {
      dismissedProductIds: dismissed,
      customerId,
    });

    res.json({
      suggestions: suggestions.slice(0, limit),
      count: Math.min(suggestions.length, limit),
      threshold_info: suggestions.length ? threshold_info : null,
    });
  } catch (e: any) {
    req.scope
      .resolve("logger")
      .error(`[suggest] cart ${cartId} eval failed: ${e?.message}`);
    res.json({ suggestions: [], count: 0, threshold_info: null });
  }
};
