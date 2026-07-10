import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { EvaluationEngine } from "../../../../../modules/suggestive-selling/evaluator";
import { PRODUCT_LIMIT } from "../../../../../modules/suggestive-selling/constants";
import {
  dismissalScope,
  getDismissed,
} from "../../../../../lib/suggestion-cache";

/**
 * GET /store/products/:id/suggestions — SF-01 / SUGG-001 (API_CONTRACT §1.1).
 * Lazy "Complete Your Setup". Personal filters (in-cart, dismissed, purchased)
 * run at request over a shared cached candidate list. BR-10: any failure →
 * 200 empty (never surface an error to the customer).
 *
 * Query: cart_id? (for in-cart filter, EC-01), limit? (≤5).
 * Header: x-session-id (dismissal/analytics scope).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const productId = req.params.id;
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const engine = new EvaluationEngine(req.scope);

    const customerId =
      (req as any).auth_context?.actor_type === "customer"
        ? (req as any).auth_context.actor_id
        : null;
    const sessionId = (req.headers["x-session-id"] as string) ?? null;
    const cartId = (req.query.cart_id as string) ?? null;
    const limit = Math.min(
      Number(req.query.limit ?? PRODUCT_LIMIT),
      PRODUCT_LIMIT,
    );

    let cartProductIds: string[] = [];
    if (cartId) {
      const { data } = await query.graph({
        entity: "cart",
        fields: ["items.product_id"],
        filters: { id: cartId },
      });
      cartProductIds = (data?.[0]?.items ?? []).map((i: any) => i.product_id);
    }

    const dismissed = await getDismissed(
      req.scope,
      dismissalScope(customerId, sessionId),
      "product_view",
    );

    const suggestions = await engine.evaluateProduct(productId, {
      cartProductIds,
      dismissedProductIds: dismissed,
      customerId,
    });

    res.json({
      suggestions: suggestions.slice(0, limit),
      count: Math.min(suggestions.length, limit),
    });
  } catch (e: any) {
    // BR-10 / INT-03: degrade to hidden section, never an error.
    req.scope
      .resolve("logger")
      .error(`[suggest] product ${productId} eval failed: ${e?.message}`);
    res.json({ suggestions: [], count: 0 });
  }
};
