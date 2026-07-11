import {
  ContainerRegistrationKeys,
  Modules,
  QueryContext,
} from "@medusajs/framework/utils";
import { SUGGESTIVE_SELLING_MODULE } from "./index";
import { matchesCartRule } from "./cart-rule-logic";
import { getCartRuleVersion } from "../../lib/suggestion-cache";
import {
  PRODUCT_LIMIT,
  CART_LIMIT,
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
 * EvaluationEngine - SPEC A.4-A.6 (SF-01/SF-02, SUGG-001/002/004).
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
  private container: any;
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

  /** Fallback top sellers when 30-day sales data is unavailable: newest first. */
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
    const candidates = data.map(enrichOne).filter((e: EnrichedProduct) => !excludeIds.has(e.product_id));
    return this.rankByRecentSales(candidates);
  }

  private async rankByRecentSales(products: EnrichedProduct[]): Promise<EnrichedProduct[]> {
    if (products.length < 2) return products;
    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const { data: orders } = await this.query.graph({
        entity: "order",
        fields: ["id", "items.product_id", "items.quantity"],
        filters: { created_at: { $gte: since } },
      });
      const sold = new Map<string, number>();
      for (const order of orders ?? []) {
        for (const item of order.items ?? []) {
          if (item.product_id) sold.set(item.product_id, (sold.get(item.product_id) ?? 0) + (item.quantity ?? 0));
        }
      }
      return products.slice().sort((a, b) => (sold.get(b.product_id) ?? 0) - (sold.get(a.product_id) ?? 0) || a.product_id.localeCompare(b.product_id));
    } catch {
      return products;
    }
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

  // Product-level suggestions (SF-01)

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

    // Tier 1: manual curations in admin display order.
    const { data: linkedRules } = await this.query.graph({
      entity: "suggestion_rule",
      fields: [
        "id",
        "tier",
        "priority",
        "valid_from",
        "valid_to",
        "items.id",
        "items.suggested_product_id",
        "items.display_order",
        "items.custom_label",
        "products.id",
      ],
      filters: {
        type: "product",
        is_active: true,
      },
    });
    const now = new Date();
    const tierRank: Record<string, number> = {
      manual: 1,
      category: 2,
      behavioral: 3,
    };
    const rules = (linkedRules ?? [])
      .filter((rule: any) =>
        (rule.products ?? []).some((product: any) => product.id === productId),
      )
      .filter((rule: any) => rule.tier === "manual")
      .filter((rule: any) => {
        const from = rule.valid_from ? new Date(rule.valid_from) : null;
        const to = rule.valid_to ? new Date(rule.valid_to) : null;
        return (!from || from <= now) && (!to || to >= now);
      })
      .sort(
        (a: any, b: any) =>
          (tierRank[a.tier] ?? 9) - (tierRank[b.tier] ?? 9) ||
          (a.priority ?? 0) - (b.priority ?? 0),
      );
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

    // Tier 2 candidate pool. Per-request filters run before ranking, so eligible
    // Tier 1 stays first and Tier 2 fills the remaining slots up to 5.
    if (sourceCategoryIds.length) {
      const exclude = new Set<string>([
        productId,
        ...result.map((candidate) => candidate.product_id),
      ]);
      const seenComplementCategories = new Set<string>();
      let categoryOrder = 0;

      for (const sourceCategoryId of sourceCategoryIds) {
        const mappings = await this.service.listComplements(sourceCategoryId);
        for (const mapping of mappings) {
          const complementCategoryId = mapping.complement_category_id;
          if (seenComplementCategories.has(complementCategoryId)) continue;
          seenComplementCategories.add(complementCategoryId);

          const candidates = await this.fetchByCategories(
            [complementCategoryId],
            PRODUCT_LIMIT,
            exclude,
          );
          candidates.slice(0, PRODUCT_LIMIT).forEach((candidate, index) => {
            if (candidate.status !== "published") return;
            if (exclude.has(candidate.product_id)) return;
            exclude.add(candidate.product_id);
            result.push({
              ...candidate,
              tier: "category",
              rule_id: null,
              label: null,
              display_order: 1000 + categoryOrder * 100 + index,
            });
          });
          categoryOrder++;
        }
      }
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

  // Cart-level suggestions (SF-02)

  async computeCartRaw(
    cartId: string,
  ): Promise<{ candidates: CartSuggestion[]; threshold_info: any | null }> {
    const key = cartCacheKey(cartId, await getCartRuleVersion(this.container));
    if (this.cache) {
      const hit = await this.cache.get(key);
      if (hit) return hit as any;
    }

    const { data: cartRows } = await this.query.graph({
      entity: "cart",
      fields: ["id", "currency_code", "item_total", "items.product_id", "items.quantity", "items.unit_price", "items.product.categories.id", "items.product.categories.name", "items.product.metadata"],
      filters: { id: cartId },
    });
    const cart = cartRows?.[0];
    const empty = { candidates: [] as CartSuggestion[], threshold_info: null };
    if (!cart || !(cart.items ?? []).length) {
      if (this.cache) await this.cache.set(key, empty, SUGGESTION_CACHE_TTL);
      return empty;
    }

    const lines: any[] = cart.items ?? [];
    const cartProductIds = new Set<string>(lines.map((line) => line.product_id));
    const cartCategoryIds = new Set<string>(lines.flatMap((line) => (line.product?.categories ?? []).map((category: any) => category.id)));
    const subtotal = cart.item_total ?? lines.reduce((sum, line) => sum + (line.unit_price ?? 0) * (line.quantity ?? 0), 0);
    const brands = [...new Set<string>(lines.map((line) => (line.product?.metadata as any)?.brand).filter(Boolean))];
    const context = {
      subtotal,
      categoryIds: [...cartCategoryIds],
      brands,
      lines: lines.map((line) => ({ quantity: line.quantity ?? 0, categoryIds: (line.product?.categories ?? []).map((category: any) => category.id), categoryNames: (line.product?.categories ?? []).map((category: any) => category.name) })),
    };
    const exclude = new Set<string>(cartProductIds);
    const candidates: CartSuggestion[] = [];
    let thresholdInfo: any | null = null;

    const append = (products: EnrichedProduct[], rule: any, code: string, badge: string | null) => {
      for (const product of products) {
        if (exclude.has(product.product_id) || !product.in_stock || product.status !== "published") continue;
        exclude.add(product.product_id);
        candidates.push({ ...product, tier: "cart", rule_id: rule.id, rule_code: code, badge_text: badge });
      }
    };
    const complementsOf = async (sourceIds: string[]) => {
      const ids: string[] = [];
      for (const sourceId of sourceIds) {
        const mappings = await this.service.listComplements(sourceId);
        ids.push(...mappings.map((mapping: any) => mapping.complement_category_id));
      }
      return [...new Set(ids)];
    };

    const rules = await this.service.listActiveCartRules();
    for (const rule of rules) {
      const conditions = rule.conditions ?? [];
      if (!matchesCartRule(conditions, context)) continue;

      for (const condition of conditions) {
        const params = condition.condition_params ?? {};
        if (condition.condition_type === "category_missing") {
          const sources: string[] = params.source_category_ids ?? [];
          const activeSources = sources.filter((id) => cartCategoryIds.has(id));
          const complementIds = (await complementsOf(activeSources)).filter((id) => !cartCategoryIds.has(id));
          append(await this.fetchByCategories(complementIds, CART_LIMIT, exclude), rule, "CR-01", null);
        } else if (condition.condition_type === "threshold_near") {
          const pct = Number(params.percentage ?? 0.15);
          if (!cr02Fires(subtotal, FREE_SHIPPING_THRESHOLD, pct)) continue;
          const remaining = FREE_SHIPPING_THRESHOLD - subtotal;
          thresholdInfo = { target: FREE_SHIPPING_THRESHOLD, current: subtotal, remaining };
          const products = await this.fetchByCategories(await complementsOf([...cartCategoryIds]), CART_LIMIT, exclude);
          append(products.filter((product) => product.price != null && product.price >= remaining && product.price <= remaining * 2), rule, "CR-02", params.badge_text ?? CR02_DEFAULT_BADGE);
        } else if (condition.condition_type === "brand_match") {
          if (brands.length !== 1) continue;
          const configured: string[] = params.accessory_category_ids ?? [];
          const categoryIds = configured.length ? configured : await complementsOf([...cartCategoryIds]);
          append((await this.fetchByCategories(categoryIds, CART_LIMIT, exclude)).filter((product) => product.brand === brands[0]), rule, "CR-03", null);
        } else if (condition.condition_type === "consumable_upsell") {
          const configured: string[] = params.consumable_category_ids ?? [];
          const maxQuantity = Number(params.max_quantity ?? 1);
          const sourceIds = lines.filter((line) => line.quantity <= maxQuantity && (!configured.length || (line.product?.categories ?? []).some((category: any) => configured.includes(category.id)))).map((line) => line.product_id);
          if (!sourceIds.length) continue;
          const mappings = await this.service.listProductBulkMappings({ source_product_id: sourceIds, is_active: true }, { order: { priority: "ASC" } });
          const enriched = await this.enrich(mappings.map((mapping: any) => mapping.bulk_product_id));
          append(mappings.map((mapping: any) => enriched.get(mapping.bulk_product_id)).filter(Boolean) as EnrichedProduct[], rule, "CR-04", null);
        }
      }
    }

    const out = { candidates: candidates.slice(0, CART_LIMIT), threshold_info: thresholdInfo };
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
