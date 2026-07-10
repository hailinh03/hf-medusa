import {
  ContainerRegistrationKeys,
  Modules,
  QueryContext,
} from "@medusajs/framework/utils";
import { SUGGESTIVE_SELLING_MODULE } from "./index";
import {
  PRODUCT_LIMIT,
  CART_LIMIT,
  TIER1_MIN_SURVIVORS,
  CONSUMABLE_CATEGORIES,
  CR02_DEFAULT_BADGE,
  FREE_SHIPPING_THRESHOLD,
  SUGGESTION_CACHE_TTL,
  productCacheKey,
  cartCacheKey,
} from "./constants";
import {
  EnrichedProduct,
  ProductSuggestion,
  CartSuggestion,
  enrichOne,
  dedupeByProduct,
  applyPersonalFilters,
  rankProductSuggestions,
  cr02Fires,
  cr02Band,
  mergeDedupeCart,
} from "./evaluator-logic";

/**
 * EvaluationEngine — SPEC A.4–A.6 (SF-01/SF-02, SUGG-001/002/004).
 *
 * `computeProductRaw` / `computeCartRaw` produce SHARED cacheable candidate
 * lists (self/inactive removed, no per-session state); personal filters run at
 * request time so one cache entry serves every visitor yet stays personalized
 * (BR-06 / D6 / D7). Pure decisions live in evaluator-logic.ts.
 */

const CURRENCY = "vnd"; // single-currency store (D9); TODO multi-region
export type { EnrichedProduct, ProductSuggestion, CartSuggestion };

export type ProductEvalCtx = {
  cartProductIds?: string[];
  dismissedProductIds?: string[];
  customerId?: string | null;
};
export type CartEvalCtx = {
  dismissedProductIds?: string[];
  customerId?: string | null;
};

const PRODUCT_FIELDS = [
  "id",
  "handle",
  "title",
  "status",
  "thumbnail",
  "metadata",
  "categories.id",
  "categories.name",
  "variants.id",
  "variants.title",
  "variants.manage_inventory",
  "variants.calculated_price.calculated_amount",
  "variants.calculated_price.original_amount",
  "variants.inventory_items.inventory.location_levels.stocked_quantity",
  "variants.inventory_items.inventory.location_levels.reserved_quantity",
];

export class EvaluationEngine {
  private query: any;
  private service: any;
  private cache: any | null;

  constructor(container: any) {
    this.query = container.resolve(ContainerRegistrationKeys.QUERY);
    this.service = container.resolve(SUGGESTIVE_SELLING_MODULE);
    try {
      this.cache = container.resolve(Modules.CACHE);
    } catch {
      this.cache = null; // cache optional (D11)
    }
  }

  private async enrich(
    productIds: string[],
  ): Promise<Map<string, EnrichedProduct>> {
    const ids = [...new Set(productIds)].filter(Boolean);
    if (!ids.length) return new Map();
    const { data } = await this.query.graph({
      entity: "product",
      fields: PRODUCT_FIELDS,
      filters: { id: ids },
      context: {
        variants: {
          calculated_price: QueryContext({ currency_code: CURRENCY }),
        },
      },
    });
    return new Map(data.map((p: any) => [p.id, enrichOne(p)]));
  }

  /** Fallback top-sellers (no 30-day order data yet → newest first, SPEC A.6). */
  private async fetchByCategories(
    categoryIds: string[],
    take: number,
    excludeIds: Set<string>,
  ): Promise<EnrichedProduct[]> {
    const cats = [...new Set(categoryIds)].filter(Boolean);
    if (!cats.length) return [];
    const { data } = await this.query.graph({
      entity: "product",
      fields: PRODUCT_FIELDS,
      filters: { status: "published", categories: { id: cats } },
      context: {
        variants: {
          calculated_price: QueryContext({ currency_code: CURRENCY }),
        },
      },
      pagination: {
        take: Math.max(take * 3, 12),
        order: { created_at: "DESC" },
      },
    });
    return data
      .map(enrichOne)
      .filter((e: EnrichedProduct) => !excludeIds.has(e.product_id));
  }

  private async purchasedDurableProductIds(
    customerId?: string | null,
  ): Promise<Set<string>> {
    if (!customerId) return new Set(); // guest: not evaluable (BR-08)
    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const { data: orders } = await this.query.graph({
        entity: "order",
        fields: [
          "id",
          "created_at",
          "items.product_id",
          "items.product.categories.name",
        ],
        filters: { customer_id: customerId, created_at: { $gte: since } },
      });
      const ids = new Set<string>();
      for (const o of orders ?? []) {
        for (const it of o.items ?? []) {
          const cats: string[] = (it?.product?.categories ?? []).map(
            (c: any) => c.name,
          );
          const consumable = cats.some((n) =>
            CONSUMABLE_CATEGORIES.includes(n),
          );
          if (!consumable && it.product_id) ids.add(it.product_id);
        }
      }
      return ids;
    } catch {
      return new Set();
    }
  }

  // ═══════════════════════════ PRODUCT LEVEL (SF-01) ═══════════════════════════

  async computeProductRaw(productId: string): Promise<ProductSuggestion[]> {
    const key = productCacheKey(productId);
    if (this.cache) {
      const hit = await this.cache.get(key);
      if (hit) return hit as ProductSuggestion[];
    }

    const { data: srcRows } = await this.query.graph({
      entity: "product",
      fields: ["id", "categories.id"],
      filters: { id: productId },
    });
    const sourceCategoryIds: string[] = (srcRows?.[0]?.categories ?? []).map(
      (c: any) => c.id,
    );

    // Tier 1 — manual curations, admin display order.
    const rules = await this.service.listActiveProductRules(productId);
    const tier1Raw: {
      id: string;
      label: string | null;
      order: number;
      ruleId: string;
    }[] = [];
    for (const rule of rules) {
      const items = (rule.items ?? [])
        .slice()
        .sort((a: any, b: any) => a.display_order - b.display_order);
      for (const it of items) {
        tier1Raw.push({
          id: it.suggested_product_id,
          label: it.custom_label ?? null,
          order: it.display_order ?? 0,
          ruleId: rule.id,
        });
      }
    }
    const enriched = await this.enrich(tier1Raw.map((t) => t.id));
    const tier1 = dedupeByProduct(
      tier1Raw
        .map((t): ProductSuggestion | null => {
          const e = enriched.get(t.id);
          if (!e) return null;
          if (e.product_id === productId) return null; // (e) self
          if (e.status !== "published") return null; // (f) inactive
          return {
            ...e,
            tier: "manual",
            rule_id: t.ruleId,
            label: t.label,
            display_order: t.order,
          };
        })
        .filter(Boolean) as ProductSuggestion[],
    );

    const result = [...tier1];

    // Tier 2 — category-complement backfill when Tier-1 < 3 (BR-01).
    if (tier1.length < TIER1_MIN_SURVIVORS && sourceCategoryIds.length) {
      const complementCatIds: string[] = [];
      for (const catId of sourceCategoryIds) {
        const maps = await this.service.listComplements(catId);
        complementCatIds.push(
          ...maps.map((m: any) => m.complement_category_id),
        );
      }
      const exclude = new Set<string>([
        productId,
        ...result.map((r) => r.product_id),
      ]);
      const topSellers = await this.fetchByCategories(
        complementCatIds,
        PRODUCT_LIMIT,
        exclude,
      );
      topSellers.forEach((e, i) => {
        if (e.status !== "published") return;
        if (result.length >= PRODUCT_LIMIT) return;
        if (result.some((r) => r.product_id === e.product_id)) return;
        result.push({
          ...e,
          tier: "category",
          rule_id: null,
          label: null,
          display_order: 1000 + i,
        });
      });
    }

    if (this.cache) await this.cache.set(key, result, SUGGESTION_CACHE_TTL);
    return result;
  }

  async evaluateProduct(
    productId: string,
    ctx: ProductEvalCtx = {},
  ): Promise<ProductSuggestion[]> {
    const raw = await this.computeProductRaw(productId);
    const purchasedDurable = await this.purchasedDurableProductIds(
      ctx.customerId,
    );
    const filtered = applyPersonalFilters(raw, {
      cartProductIds: ctx.cartProductIds,
      dismissed: ctx.dismissedProductIds,
      purchasedDurable,
    });
    return rankProductSuggestions(filtered);
  }

  // ═══════════════════════════ CART LEVEL (SF-02) ═══════════════════════════

  async computeCartRaw(
    cartId: string,
  ): Promise<{ candidates: CartSuggestion[]; threshold_info: any | null }> {
    const key = cartCacheKey(cartId);
    if (this.cache) {
      const hit = await this.cache.get(key);
      if (hit) return hit as any;
    }

    const { data: cartRows } = await this.query.graph({
      entity: "cart",
      fields: [
        "id",
        "currency_code",
        "item_total",
        "items.product_id",
        "items.quantity",
        "items.unit_price",
        "items.product.categories.id",
        "items.product.categories.name",
        "items.product.metadata",
      ],
      filters: { id: cartId },
    });
    const cart = cartRows?.[0];
    const empty = { candidates: [] as CartSuggestion[], threshold_info: null };
    if (!cart || !(cart.items ?? []).length) {
      if (this.cache) await this.cache.set(key, empty, SUGGESTION_CACHE_TTL);
      return empty;
    }

    const lines: any[] = cart.items ?? [];
    const cartProductIds = new Set<string>(lines.map((l) => l.product_id));
    const cartCategoryIds = new Set<string>(
      lines.flatMap((l) => (l.product?.categories ?? []).map((c: any) => c.id)),
    );
    const subtotal =
      cart.item_total ??
      lines.reduce((s, l) => s + (l.unit_price ?? 0) * (l.quantity ?? 0), 0);

    const collected: {
      e: EnrichedProduct;
      code: string;
      badge: string | null;
    }[] = [];
    let thresholdInfo: any | null = null;
    const baseExclude = new Set<string>([...cartProductIds]);

    const push = async (
      catIds: string[],
      code: string,
      badge: string | null,
      band?: { min: number; max: number },
      brand?: string,
    ) => {
      let cands = await this.fetchByCategories(catIds, CART_LIMIT, baseExclude);
      cands = cands.filter((c) => c.in_stock && c.status === "published");
      if (band)
        cands = cands.filter(
          (c) => c.price != null && c.price >= band.min && c.price <= band.max,
        );
      if (brand) cands = cands.filter((c) => c.brand === brand);
      for (const e of cands) collected.push({ e, code, badge });
    };

    const complementsOf = async (): Promise<string[]> => {
      const out: string[] = [];
      for (const catId of cartCategoryIds) {
        const maps = await this.service.listComplements(catId);
        out.push(...maps.map((m: any) => m.complement_category_id));
      }
      return out;
    };

    // CR-01 — category gap.
    for (const catId of cartCategoryIds) {
      const maps = await this.service.listComplements(catId);
      for (const m of maps) {
        const compHasItem = lines.some((l) =>
          (l.product?.categories ?? []).some(
            (c: any) => c.id === m.complement_category_id,
          ),
        );
        if (!compHasItem) await push([m.complement_category_id], "CR-01", null);
      }
    }

    // CR-02 — threshold nudge (D4/D5).
    const threshold = FREE_SHIPPING_THRESHOLD;
    if (cr02Fires(subtotal, threshold)) {
      const remaining = threshold - subtotal;
      thresholdInfo = { target: threshold, current: subtotal, remaining };
      await push(
        await complementsOf(),
        "CR-02",
        CR02_DEFAULT_BADGE,
        cr02Band(remaining),
      );
    }

    // CR-03 — brand affinity.
    const brands = new Set<string>(
      lines.map((l) => (l.product?.metadata as any)?.brand).filter(Boolean),
    );
    if (brands.size === 1) {
      await push(
        await complementsOf(),
        "CR-03",
        null,
        undefined,
        [...brands][0],
      );
    }

    // CR-04 — consumable qty=1 → bulk (Phase-1 heuristic via complement category).
    for (const l of lines) {
      if ((l.quantity ?? 0) !== 1) continue;
      const consumable = (l.product?.categories ?? []).some((c: any) =>
        CONSUMABLE_CATEGORIES.includes(c.name),
      );
      if (!consumable) continue;
      const comp: string[] = [];
      for (const c of l.product?.categories ?? []) {
        const maps = await this.service.listComplements(c.id);
        comp.push(...maps.map((m: any) => m.complement_category_id));
      }
      await push(comp, "CR-04", null);
    }

    const candidates = mergeDedupeCart(collected, Number.MAX_SAFE_INTEGER); // dedupe now; cap at request
    const out = { candidates, threshold_info: thresholdInfo };
    if (this.cache) await this.cache.set(key, out, SUGGESTION_CACHE_TTL);
    return out;
  }

  async evaluateCart(
    cartId: string,
    ctx: CartEvalCtx = {},
  ): Promise<{ suggestions: CartSuggestion[]; threshold_info: any | null }> {
    const raw = await this.computeCartRaw(cartId);
    const dismissed = new Set(ctx.dismissedProductIds ?? []);
    const suggestions = raw.candidates
      .filter((c) => !dismissed.has(c.product_id))
      .slice(0, CART_LIMIT);
    return {
      suggestions,
      threshold_info: suggestions.length ? raw.threshold_info : null,
    };
  }
}
