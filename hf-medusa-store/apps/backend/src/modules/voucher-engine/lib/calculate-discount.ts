/**
 * Pure discount-resolution calculation — SPEC §10 / §23.2 (SRS VOUCH-003, §9.3).
 *
 * Deterministic function of plain integers: original Cart subtotal (task 3.3.2),
 * the voucher discount with both caps, and the expected final Cart total used
 * later only as a verification oracle (task 3.3.14, SPEC §23.4). No I/O, no
 * Medusa imports — the Cart/Promotion adapter lives in
 * `workflows/voucher/steps/load-cart-context.ts`.
 */

import { assertSafeInt, bps, clampMin, sumInts } from "./money";

/** One Cart line, already mapped from Medusa's authoritative fields (§10.7). */
export interface LineValue {
  line_id: string;
  unit_price: number;
  quantity: number;
  /** Sum of item-level promotion adjustments on this line, EXCLUDING VoucherEngine's own adjustment (Rule 11). */
  item_promotion_discount: number;
  /** Whether this line matches the voucher's scope (V6) — set by `resolveEligibleItems`/`resolveEligibleItemsStep`. */
  is_eligible: boolean;
  /**
   * Product id for scope matching (V6, task 3.3.5). Optional so existing
   * fixtures/tests that set `is_eligible` directly (without going through
   * `resolveEligibleItems`) keep compiling — eligibility resolution and
   * discount calculation stay decoupled concerns.
   */
  product_id?: string | null;
  /** Category ids for scope matching (V6, task 3.3.5). Same optionality rationale as `product_id`. */
  category_ids?: string[];
}

/**
 * A voucher's eligibility scope (SRS §5.2 `applicable_product_ids`/`applicable_category_ids`,
 * SPEC §5.4 `VoucherScope` — the DB-backed scope model itself is out of scope this
 * session; this is the plain-data shape a future caller/step would supply after
 * reading `VoucherScope` rows, matching the existing pattern of passing
 * `discount_type`/`discount_value`/`global_cap_bps` as plain inputs rather than
 * looking them up here).
 *
 * Both arrays empty = unscoped (applies to the whole cart, Rule 7 note in §5.4).
 */
export interface VoucherScope {
  product_ids: string[];
  category_ids: string[];
}

/** Vietnamese-first cap explanation (task 3.3.13), matching the SPEC §8.4 `VOUCHER_DISCOUNT_CAPPED` message envelope shape. */
export interface CapExplanation {
  code: "VOUCHER_DISCOUNT_CAPPED";
  message_vi: string;
  message_params: {
    original_amount: number;
    final_amount: number;
  };
}

export interface VoucherDiscountInput {
  lines: LineValue[];
  discount_type: "percentage" | "fixed_amount";
  /** Integer basis points (percentage) or integer VND amount (fixed_amount). */
  discount_value: number;
  /** Voucher-specific maximum discount amount (Rule 8), null when unset. */
  max_discount_amount: number | null;
  /** Global discount-cap percentage in basis points (Rule 9/10). */
  global_cap_bps: number;
}

export interface VoucherDiscountResult {
  original_subtotal: number;
  item_promotion_discount: number;
  post_promotion_subtotal: number;
  eligible_post_promotion_subtotal: number;
  raw_voucher_discount: number;
  voucher_discount_after_voucher_cap: number;
  /** Global-cap THRESHOLD in money — the maximum the combined discount is allowed to reach (task 3.3.10/3.3.11), not the realized total. */
  maximum_combined_discount: number;
  final_voucher_discount: number;
  discount_capped: boolean;
  /** REALIZED total discount actually applied — item_promotion_discount + final_voucher_discount (task 3.3.9). Distinct from `maximum_combined_discount` above; the two coincide only when discount_capped is true. */
  combined_discount: number;
  /** Vietnamese explanation of the global-cap reduction (task 3.3.13), null unless `discount_capped` is true. */
  cap_explanation: CapExplanation | null;
  /** Verification-only oracle for §23.4 `verifyCartTotalsStep` — never persisted/returned as a pricing truth (Rule 18, INT-03). */
  expected_final_cart_total: number;
}

/**
 * Default global discount-cap percentage (50.00%, SRS §5.2 `DiscountCapConfig`
 * default) — used by callers as the fallback when no persisted
 * `DiscountCapConfig` override exists (task 3.3.10). The `DiscountCapConfig`
 * model itself is out of scope this session (see progress log); this constant
 * is deliberately NOT wired as a hidden default inside `calculateVoucherDiscount`
 * — `global_cap_bps` stays a required, explicit input there so the pure
 * calculation never silently assumes a cap value.
 */
export const DEFAULT_GLOBAL_CAP_BPS = 5000;

/**
 * §10 post-promotion value of a single line — the line's original total minus
 * its own item-promotion discount, floored at 0 (task 3.3.4). Shared by
 * `calculateEligiblePostPromotionSubtotal` so the per-line and cart-level
 * values are computed by the same code path.
 */
export function postPromotionLineValue(line: LineValue): number {
  const lineOriginalTotal = line.unit_price * line.quantity;
  return clampMin(lineOriginalTotal - line.item_promotion_discount);
}

/**
 * §10 eligible-item resolution (V6, task 3.3.5) — decides which lines a
 * voucher's discount is allowed to apply to:
 *  - unscoped (both arrays empty): every line is eligible;
 *  - product-scoped: a line is eligible if its `product_id` is in `scope.product_ids`;
 *  - category-scoped: a line is eligible if any of its `category_ids` is in `scope.category_ids`;
 *  - product- and category-scoping combine with OR (either match is sufficient).
 *
 * Pure and side-effect-free; returns new LineValue objects rather than mutating
 * the input, matching the rest of this module.
 */
export function resolveEligibleItems(
  lines: LineValue[],
  scope: VoucherScope,
): LineValue[] {
  const unscoped =
    scope.product_ids.length === 0 && scope.category_ids.length === 0;
  if (unscoped) {
    return lines.map((line) => ({ ...line, is_eligible: true }));
  }

  const productIds = new Set(scope.product_ids);
  const categoryIds = new Set(scope.category_ids);

  return lines.map((line) => {
    const matchesProduct =
      line.product_id != null && productIds.has(line.product_id);
    const matchesCategory = (line.category_ids ?? []).some((categoryId) =>
      categoryIds.has(categoryId),
    );
    return { ...line, is_eligible: matchesProduct || matchesCategory };
  });
}

/**
 * Vietnamese integer-VND display formatting (task 3.3.13) — dot thousands
 * separator, `₫` suffix, NO space, no decimals (matching SPEC §8/§10 worked
 * examples, e.g. "30.000₫"). Presentation only: never used in monetary
 * calculation or comparison. `Intl.NumberFormat('vi-VN', { style: 'currency',
 * currency: 'VND' })` was verified NOT to match this convention — it inserts
 * a space before the symbol ("568.000 ₫") — so the symbol is appended manually.
 */
export function formatVnd(amount: number): string {
  assertSafeInt(amount, "formatVnd.amount");
  return `${new Intl.NumberFormat("vi-VN").format(amount)}₫`;
}

/** Builds the task 3.3.13 cap explanation from the pre-cap and post-cap voucher discount amounts. */
function buildCapExplanation(
  originalAmount: number,
  finalAmount: number,
): CapExplanation {
  return {
    code: "VOUCHER_DISCOUNT_CAPPED",
    message_vi: `Ưu đãi từ mã giảm giá đã được điều chỉnh từ ${formatVnd(originalAmount)} xuống ${formatVnd(finalAmount)} theo chính sách giảm giá tối đa`,
    message_params: {
      original_amount: originalAmount,
      final_amount: finalAmount,
    },
  };
}

/** §10 `original_subtotal` — sum of original (pre-any-discount) line totals (task 3.3.2). */
export function calculateOriginalSubtotal(lines: LineValue[]): number {
  return sumInts(
    lines.map((line) => {
      assertSafeInt(line.unit_price, `line[${line.line_id}].unit_price`);
      assertSafeInt(line.quantity, `line[${line.line_id}].quantity`);
      const lineTotal = line.unit_price * line.quantity;
      assertSafeInt(lineTotal, `line[${line.line_id}].original_total`);
      return lineTotal;
    }),
    "original_subtotal",
  );
}

/** §10 `item_promotion_discount` — total item-level promotion discount across all lines (Rule 5, excludes voucher's own adjustment). */
export function calculateItemPromotionDiscount(lines: LineValue[]): number {
  return sumInts(
    lines.map((line) => line.item_promotion_discount),
    "item_promotion_discount",
  );
}

/** §10 `eligible_post_promotion_subtotal` — post-promotion value of voucher-eligible lines only (Rule 6/7). */
export function calculateEligiblePostPromotionSubtotal(
  lines: LineValue[],
): number {
  return sumInts(
    lines.filter((line) => line.is_eligible).map(postPromotionLineValue),
    "eligible_post_promotion_subtotal",
  );
}

/**
 * Full §10.1 / Solution Flow §9.1 discount-resolution pipeline, in the fixed
 * calculation order (task 3.3.14):
 *
 *  1. original Cart subtotal
 *  2. item-level promotion discount
 *  3. post-promotion subtotal
 *  4. eligible post-promotion subtotal
 *  5. raw voucher discount
 *  6. voucher-specific maximum discount cap
 *  7. maximum combined discount (global cap)
 *  8. remaining global-cap capacity
 *  9. final voucher discount
 * 10. expected final Cart total
 */
export function calculateVoucherDiscount(
  input: VoucherDiscountInput,
): VoucherDiscountResult {
  const {
    lines,
    discount_type,
    discount_value,
    max_discount_amount,
    global_cap_bps,
  } = input;

  // 1. original Cart subtotal
  const original_subtotal = calculateOriginalSubtotal(lines);

  // 2. item-level promotion discount (total)
  const item_promotion_discount = calculateItemPromotionDiscount(lines);

  // 3. post-promotion subtotal (Rule 11: item promo discount is never reduced here)
  const post_promotion_subtotal = clampMin(
    original_subtotal - item_promotion_discount,
  );

  // 4. eligible post-promotion subtotal (Rule 6/7)
  const eligible_post_promotion_subtotal =
    calculateEligiblePostPromotionSubtotal(lines);

  // 5. raw voucher discount
  let raw_voucher_discount: number;
  if (discount_type === "percentage") {
    raw_voucher_discount = bps(
      eligible_post_promotion_subtotal,
      discount_value,
    );
  } else {
    assertSafeInt(discount_value, "discount_value");
    // Fixed voucher can never exceed the eligible subtotal (SPEC §10.2, SRS §22.2).
    raw_voucher_discount = Math.min(
      discount_value,
      eligible_post_promotion_subtotal,
    );
  }

  // 6. voucher-specific maximum discount cap (Rule 8)
  const voucher_discount_after_voucher_cap =
    max_discount_amount == null
      ? raw_voucher_discount
      : Math.min(raw_voucher_discount, max_discount_amount);

  // 7. maximum combined discount — global cap applies to the ORIGINAL subtotal (Rule 9)
  const maximum_combined_discount = bps(original_subtotal, global_cap_bps);

  // 8. remaining global-cap capacity — item-level promotion discount is never reduced (Rule 10/11)
  const remaining_cap_capacity = clampMin(
    maximum_combined_discount - item_promotion_discount,
  );

  // 9. final voucher discount — never negative (Rule guard §10.2)
  const final_voucher_discount = clampMin(
    Math.min(voucher_discount_after_voucher_cap, remaining_cap_capacity),
  );

  // discount_capped is true iff the GLOBAL cap (not the voucher's own
  // max_discount_amount) reduced the discount — remaining_cap_capacity only
  // binds final_voucher_discount below voucher_discount_after_voucher_cap
  // when the global cap is the tighter constraint (task 3.3.12).
  const discount_capped =
    final_voucher_discount < voucher_discount_after_voucher_cap;

  // combined discount actually realized: item promotions + final voucher
  // discount (task 3.3.9). Distinct from `maximum_combined_discount` (the
  // cap threshold) — they coincide exactly when discount_capped is true.
  const combined_discount = sumInts(
    [item_promotion_discount, final_voucher_discount],
    "combined_discount",
  );

  const cap_explanation = discount_capped
    ? buildCapExplanation(
        voucher_discount_after_voucher_cap,
        final_voucher_discount,
      )
    : null;

  // 10. expected final Cart total — internal verification oracle ONLY (§23.4); the
  // Cart Module's own recomputed `cart.total` remains the single pricing truth.
  const expected_final_cart_total = clampMin(
    original_subtotal - item_promotion_discount - final_voucher_discount,
  );

  return {
    original_subtotal,
    item_promotion_discount,
    post_promotion_subtotal,
    eligible_post_promotion_subtotal,
    raw_voucher_discount,
    voucher_discount_after_voucher_cap,
    maximum_combined_discount,
    final_voucher_discount,
    discount_capped,
    combined_discount,
    cap_explanation,
    expected_final_cart_total,
  };
}
