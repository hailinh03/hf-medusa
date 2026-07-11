import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { addSuggestedItemWorkflow } from "../../../../../workflows/add-suggested-item";
import { SUGGESTIVE_SELLING_MODULE } from "../../../../../modules/suggestive-selling";
import { SuggestionErrors } from "../../../../../lib/errors";


/**
 * POST /store/carts/:id/suggested-items Ã¢â‚¬â€ SF-03 / SUGG-003 (API_CONTRACT Ã‚Â§1.1).
 * One-tap add of a suggested item with attribution. Order of operations:
 *   validate attribution (SEC-01) Ã¢â€ â€™ resolve variant (SUGG-104) Ã¢â€ â€™
 *   authoritative stock re-check (EC-07) Ã¢â€ â€™ idempotency (EC-03) Ã¢â€ â€™
 *   add line item + attribution metadata Ã¢â€ â€™ emit add_to_cart (SF-08) Ã¢â€ â€™
 *   invalidate cart cache (SUGG-005).
 *
 * Body: { variant_id?, product_id?, quantity=1, attribution:{rule_id, source_context, source_product_id} }
 * Header: Idempotency-Key
 */

const AVAIL_FIELDS = [
  "id",
  "title",
  "manage_inventory",
  "product.id",
  "product.title",
  "product.status",
  "product.variants.id",
  "product.variants.title",
  "inventory_items.inventory.location_levels.stocked_quantity",
  "inventory_items.inventory.location_levels.reserved_quantity",
];

function available(v: any): boolean {
  if (v?.manage_inventory === false) return true;
  const levels: any[] = (v?.inventory_items ?? []).flatMap(
    (ii: any) => ii?.inventory?.location_levels ?? [],
  );
  return (
    levels.reduce(
      (s, l) => s + ((l?.stocked_quantity ?? 0) - (l?.reserved_quantity ?? 0)),
      0,
    ) > 0
  );
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const cartId = req.params.id;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const service: any = req.scope.resolve(SUGGESTIVE_SELLING_MODULE);

  const body = (req.body ?? {}) as any;
  const attribution = body.attribution ?? {};
  const quantity = Number(body.quantity ?? 1) || 1;
  const idempotencyKey =
    (req.headers["idempotency-key"] as string) ??
    (req.headers["Idempotency-Key"] as string) ??
    null;

  // 1) Validate attribution rule (SEC-01) Ã¢â‚¬â€ forged/unknown rule Ã¢â€¡â€™ reject, add nothing.
  let tier: string | null = null;
  if (attribution.rule_id) {
    const rule = await service
      .retrieveSuggestionRule(attribution.rule_id)
      .catch(() => null);
    if (!rule) throw SuggestionErrors.invalidAttribution(attribution.rule_id);
    tier = rule.tier ?? null;
  }

  // 2) Resolve variant (SUGG-104): explicit variant_id, else single variant, else selection required.
  let variantId: string | null = body.variant_id ?? null;
  if (!variantId) {
    const productId = body.product_id;
    if (!productId)
      throw SuggestionErrors.invalidAttribution(attribution.rule_id);
    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "status", "variants.id", "variants.title"],
      filters: { id: productId },
    });
    const product = data?.[0];
    if (!product || product.status !== "published")
      throw SuggestionErrors.productInactive();
    const variants = product.variants ?? [];
    if (variants.length === 1) variantId = variants[0].id;
    else throw SuggestionErrors.variantSelectionRequired(variants);
  }

  // 3) Authoritative stock re-check (bypass advisory cache Ã¢â‚¬â€ EC-07).
  const { data: vRows } = await query.graph({
    entity: "variant",
    fields: AVAIL_FIELDS,
    filters: { id: variantId },
  });
  const variant = vRows?.[0];
  if (!variant || variant.product?.status !== "published")
    throw SuggestionErrors.productInactive();
  if (!available(variant)) {
    throw SuggestionErrors.stockConflict(
      variant.product?.title ?? "SÃ¡ÂºÂ£n phÃ¡ÂºÂ©m",
      variant.product?.id,
    );
  }

  // 4) Idempotency (EC-03): replay of same key Ã¢â€¡â€™ return existing line, no double-add.
  const cartFields = [
    "id",
    "total",
    "item_total",
    "items.id",
    "items.variant_id",
    "items.quantity",
    "items.metadata",
  ];
  const { data: preRows } = await query.graph({
    entity: "cart",
    fields: cartFields,
    filters: { id: cartId },
  });
  const preCart = preRows?.[0];
  if (idempotencyKey) {
    const existing = (preCart?.items ?? []).find(
      (li: any) => li?.metadata?.idempotency_key === idempotencyKey,
    );
    if (existing) {
      return res.json({
        line_item: existing,
        updated_cart_total: preCart.total ?? preCart.item_total,
        is_idempotent_replay: true,
      });
    }
  }

  // 5) Add line item + attribution metadata (compensable via workflow).
  const metadata: Record<string, any> = {
    suggestion_rule_id: attribution.rule_id ?? null,
    source_context: attribution.source_context ?? null,
    source_product_id: attribution.source_product_id ?? null,
    tier,
  };
  if (idempotencyKey) metadata.idempotency_key = idempotencyKey;

  try {
    await addSuggestedItemWorkflow(req.scope).run({
      input: {
        cart_id: cartId,
        variant_id: variantId,
        quantity,
        metadata,
        event: {
          rule_id: attribution.rule_id ?? null,
          source_context: attribution.source_context ?? "product_view",
          source_product_id: attribution.source_product_id ?? null,
          suggested_product_id: variant.product?.id,
          customer_id: (req as any).auth_context?.actor_type === "customer" ? (req as any).auth_context.actor_id : null,
          session_id: (req.headers["x-session-id"] as string) ?? null,
          action: "add_to_cart",
          tier,
          slot: typeof body.slot === "number" ? body.slot : null,
        },
      },
    });
  } catch (e: any) {
    // Inventory shortfall surfaced by the workflow Ã¢â€¡â€™ stock conflict (EC-07).
    const msg = String(e?.message ?? "");
    if (/inventor|stock|not enough|availab/i.test(msg)) {
      throw SuggestionErrors.stockConflict(
        variant.product?.title ?? "SÃ¡ÂºÂ£n phÃ¡ÂºÂ©m",
        variant.product?.id,
      );
    }
    throw e;
  }

  const { data: postRows } = await query.graph({
    entity: "cart",
    fields: cartFields,
    filters: { id: cartId },
  });
  const postCart = postRows?.[0];
  const lineItem = (postCart?.items ?? []).find(
    (li: any) =>
      li.variant_id === variantId &&
      (!idempotencyKey || li?.metadata?.idempotency_key === idempotencyKey),
  );

  res.json({
    line_item: lineItem ?? null,
    updated_cart_total: postCart?.total ?? postCart?.item_total,
    is_idempotent_replay: false,
  });
};
