/**
 * SuggestiveSelling constants - SPEC.md section A.2.
 * Central tuning knobs; SRS/Decision ids cited inline.
 */

export const SUGGESTION_CACHE_TTL = 300; // 5 min (BR-06 / SUGG-005)
export const STOCK_SNAPSHOT_TTL = 60; // advisory (BR-06)

export const PRODUCT_LIMIT = 5; // BR-01: product-level max slots
export const CART_LIMIT = 3; // BR-01: cart-level max slots
export const TIER1_MIN_SURVIVORS = 3; // BR-01: backfill Tier-2 when Tier-1 survivors < 3

// BR-02(d): consumables are EXEMPT from the 30-day purchase exclusion.
// TODO: Confirm the final list with the client (OI-03 / SPEC D.3).
export const CONSUMABLE_CATEGORIES = [
  "Strings",
  "Shuttlecocks",
  "Grips",
  "Socks",
  "Tubes",
];

// CR-02 (SUGG-004 / SPEC A.6): threshold-near nudge.
export const CR02_PRICE_BAND_MULT = 2; // D4: remaining <= price <= remaining x 2
export const CR02_THRESHOLD_PCT = 0.15; // D5: within 15% below threshold

// CR-02 default badge; an admin promotion label can override it (C-04).
export const CR02_DEFAULT_BADGE = "Add more for FREE shipping!";

// D5/C-04: free-shipping threshold source. SRS says read from Promotion subsystem;
// Phase-1 fallback constant until that wiring lands (OI-04 / SPEC D.3).
export const FREE_SHIPPING_THRESHOLD = 7_000_000; // VND

// Cache key builders (BR-06). Phase 1 uses a single store, so no store segment.
export const productCacheKey = (productId: string) =>
  `suggest:product:v3:${productId}`;
export const CART_RULE_VERSION_KEY = "suggest:cart-rules:version";
export const cartCacheKey = (cartId: string, version = 0) => `suggest:cart:v${version}:${cartId}`;
export const dismissKey = (scope: string, context: string) =>
  `suggest:dismiss:${scope}:${context}`;
