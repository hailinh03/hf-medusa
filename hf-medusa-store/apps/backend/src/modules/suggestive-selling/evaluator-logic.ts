/**
 * Pure evaluation logic — SPEC A.4–A.6. No I/O, deterministic → unit-testable
 * without a DB (the same philosophy as the Voucher StackingEngine). The
 * EvaluationEngine (evaluator.ts) wires these to Query/Cache; tests exercise
 * them directly with fixtures (T-SUGG-03/04/05 filters, ranking, CR-02 band).
 */
import {
  CR02_PRICE_BAND_MULT,
  CR02_THRESHOLD_PCT,
  PRODUCT_LIMIT,
  CART_LIMIT,
} from "./constants";

export type EnrichedProduct = {
  product_id: string;
  handle: string | null;
  variant_id: string | null;
  name: string;
  image_url: string | null;
  price: number | null;
  discount_price: number | null;
  in_stock: boolean;
  requires_variant_selection: boolean;
  status: string;
  category_names: string[];
  brand: string | null;
};

export type ProductSuggestion = EnrichedProduct & {
  tier: string;
  rule_id: string | null;
  label: string | null;
  display_order: number;
};

export type CartSuggestion = EnrichedProduct & {
  tier: "cart";
  rule_id: string | null;
  rule_code: string;
  badge_text: string | null;
};

/** A variant is purchasable if untracked, or available (stocked−reserved) > 0 (BR-02b). */
export function variantAvailable(v: any): boolean {
  if (v?.manage_inventory === false) return true;
  const levels: any[] = (v?.inventory_items ?? []).flatMap(
    (ii: any) => ii?.inventory?.location_levels ?? [],
  );
  const available = levels.reduce(
    (sum, l) =>
      sum + ((l?.stocked_quantity ?? 0) - (l?.reserved_quantity ?? 0)),
    0,
  );
  return available > 0;
}

/** Shape a raw product graph node into an EnrichedProduct (price/stock/variant). */
export function enrichOne(p: any): EnrichedProduct {
  const variants: any[] = p?.variants ?? [];
  const purchasable = variants.filter(variantAvailable);
  const priceSource = (purchasable.length ? purchasable : variants)
    .slice()
    .sort(
      (a, b) =>
        (a?.calculated_price?.calculated_amount ?? Infinity) -
        (b?.calculated_price?.calculated_amount ?? Infinity),
    )[0];
  const original = priceSource?.calculated_price?.original_amount ?? null;
  const calculated = priceSource?.calculated_price?.calculated_amount ?? null;
  const requiresVariant = variants.length > 1; // no "default variant" in Medusa (SUGG-104)
  return {
    product_id: p.id,
    handle: p.handle ?? null,
    variant_id: requiresVariant ? null : (variants[0]?.id ?? null),
    name: p.title,
    image_url: p.thumbnail ?? null,
    price: original,
    discount_price:
      calculated != null && original != null && calculated < original
        ? calculated
        : null,
    in_stock: purchasable.length > 0,
    requires_variant_selection: requiresVariant,
    status: p.status,
    category_names: (p?.categories ?? []).map((c: any) => c.name),
    brand: (p?.metadata as any)?.brand ?? null,
  };
}

export function dedupeByProduct<T extends { product_id: string }>(
  list: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of list) {
    if (seen.has(x.product_id)) continue;
    seen.add(x.product_id);
    out.push(x);
  }
  return out;
}

/**
 * BR-02 personal filters applied at request time (a in-cart, b out-of-stock,
 * c dismissed, d purchased-30d-durable). Self (e) and inactive (f) are removed
 * upstream (baked into the shared cache). Deterministic.
 */
export function applyPersonalFilters<T extends EnrichedProduct>(
  candidates: T[],
  opts: {
    cartProductIds?: Iterable<string>;
    dismissed?: Iterable<string>;
    purchasedDurable?: Iterable<string>;
  },
): T[] {
  const cart = new Set(opts.cartProductIds ?? []);
  const dismissed = new Set(opts.dismissed ?? []);
  const purchased = new Set(opts.purchasedDurable ?? []);
  return candidates.filter((c) => {
    if (cart.has(c.product_id)) return false; // (a)
    if (!c.in_stock) return false; // (b)
    if (dismissed.has(c.product_id)) return false; // (c)
    if (purchased.has(c.product_id)) return false; // (d)
    return true;
  });
}

const TIER_RANK: Record<string, number> = {
  manual: 1,
  category: 2,
  behavioral: 3,
};

/** Rank product suggestions: tier asc → display_order asc; cap PRODUCT_LIMIT (BR-01). */
export function rankProductSuggestions(
  list: ProductSuggestion[],
  limit = PRODUCT_LIMIT,
): ProductSuggestion[] {
  return list
    .slice()
    .sort(
      (a, b) =>
        (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) ||
        a.display_order - b.display_order,
    )
    .slice(0, limit);
}

/** CR-02 fires when subtotal is within 15% BELOW the threshold (D5). */
export function cr02Fires(
  subtotal: number,
  threshold: number,
  pct = CR02_THRESHOLD_PCT,
): boolean {
  return subtotal >= threshold * (1 - pct) && subtotal < threshold;
}

/** CR-02 candidate price band [remaining, remaining × mult] (D4). */
export function cr02Band(
  remaining: number,
  mult = CR02_PRICE_BAND_MULT,
): { min: number; max: number } {
  return { min: remaining, max: remaining * mult };
}

/**
 * Merge fired cart-rule candidates in CR order → dedupe by product, first rule
 * wins the badge (BR-04) → cap CART_LIMIT.
 */
export function mergeDedupeCart(
  collected: { e: EnrichedProduct; code: string; badge: string | null }[],
  limit = CART_LIMIT,
): CartSuggestion[] {
  const seen = new Set<string>();
  const out: CartSuggestion[] = [];
  for (const raw of collected) {
    if (seen.has(raw.e.product_id)) continue;
    seen.add(raw.e.product_id);
    out.push({
      ...raw.e,
      tier: "cart",
      rule_id: null,
      rule_code: raw.code,
      badge_text: raw.badge,
    });
    if (out.length >= limit) break;
  }
  return out;
}
