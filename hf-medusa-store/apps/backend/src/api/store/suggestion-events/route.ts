import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { SUGGESTIVE_SELLING_MODULE } from "../../../modules/suggestive-selling";

/**
 * POST /store/suggestion-events — SF-08 / SUGG-006 (API_CONTRACT §1.1, KN-11).
 * Batch interaction tracking (≤10), enum+id only (SEC-04, no free-text),
 * fire-and-forget → 202. Malformed events are dropped individually (never fail
 * the whole batch). `add_to_cart` is emitted server-side by the add route.
 */

const ACTIONS = new Set(["impression", "tap", "add_to_cart", "dismiss"]);
const CONTEXTS = new Set(["product_view", "cart"]);
const MAX_BATCH = 10;

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(SUGGESTIVE_SELLING_MODULE);
  const body = (req.body ?? {}) as any;
  const events: any[] = Array.isArray(body.events)
    ? body.events.slice(0, MAX_BATCH)
    : [];

  const customerId =
    (req as any).auth_context?.actor_type === "customer"
      ? (req as any).auth_context.actor_id
      : null;
  const sessionHeader = (req.headers["x-session-id"] as string) ?? null;

  const valid: any[] = [];
  let rejected = 0;
  for (const e of events) {
    if (
      !ACTIONS.has(e?.action) ||
      !CONTEXTS.has(e?.source_context) ||
      !e?.suggested_product_id
    ) {
      rejected++;
      continue;
    }
    valid.push({
      rule_id: e.rule_id ?? null,
      source_context: e.source_context,
      source_product_id: e.source_product_id ?? null,
      suggested_product_id: e.suggested_product_id,
      customer_id: customerId,
      session_id: e.session_id ?? sessionHeader,
      action: e.action,
      tier: e.tier ?? null,
      slot: typeof e.slot === "number" ? e.slot : null,
    });
  }

  const accepted = await service.recordEvents(valid);
  res.status(202).json({ accepted, rejected });
};
