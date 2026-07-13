import {
  DEFAULT_GLOBAL_CAP_BPS,
  LineValue,
  calculateEligiblePostPromotionSubtotal,
  calculateItemPromotionDiscount,
  calculateOriginalSubtotal,
  calculateVoucherDiscount,
  formatVnd,
  postPromotionLineValue,
  resolveEligibleItems,
} from "../calculate-discount";

// Reproduces SRS §4.1 VOUCH-003 worked examples and SPEC §10.4/10.5/10.6 exactly.
// (T-VOUCH-07, T-VOUCH-08, T-VOUCH-09, EC-03)

const GLOBAL_CAP_BPS = 5000; // 50% (SRS §5.2 DiscountCapConfig default)

describe("voucher-engine lib/calculate-discount", () => {
  describe("calculateOriginalSubtotal", () => {
    it("sums unit_price * quantity across lines", () => {
      const lines: LineValue[] = [
        {
          line_id: "a",
          unit_price: 4_500_000,
          quantity: 1,
          item_promotion_discount: 0,
          is_eligible: true,
        },
        {
          line_id: "b",
          unit_price: 200_000,
          quantity: 1,
          item_promotion_discount: 0,
          is_eligible: true,
        },
      ];
      expect(calculateOriginalSubtotal(lines)).toBe(4_700_000);
    });
  });

  describe("calculateItemPromotionDiscount", () => {
    it("sums per-line item-promotion discounts (voucher's own adjustment already excluded upstream)", () => {
      const lines: LineValue[] = [
        {
          line_id: "a",
          unit_price: 4_500_000,
          quantity: 1,
          item_promotion_discount: 900_000,
          is_eligible: true,
        },
        {
          line_id: "b",
          unit_price: 200_000,
          quantity: 1,
          item_promotion_discount: 0,
          is_eligible: true,
        },
      ];
      expect(calculateItemPromotionDiscount(lines)).toBe(900_000);
    });
  });

  describe("calculateEligiblePostPromotionSubtotal", () => {
    it("only sums eligible lines, net of their item promotion discount", () => {
      const lines: LineValue[] = [
        {
          line_id: "a",
          unit_price: 4_500_000,
          quantity: 1,
          item_promotion_discount: 900_000,
          is_eligible: true,
        },
        {
          line_id: "b",
          unit_price: 200_000,
          quantity: 1,
          item_promotion_discount: 0,
          is_eligible: false,
        },
      ];
      expect(calculateEligiblePostPromotionSubtotal(lines)).toBe(3_600_000);
    });

    it("clamps a line to 0 when its promotion discount exceeds its original total", () => {
      const lines: LineValue[] = [
        {
          line_id: "a",
          unit_price: 100,
          quantity: 1,
          item_promotion_discount: 150,
          is_eligible: true,
        },
      ];
      expect(calculateEligiblePostPromotionSubtotal(lines)).toBe(0);
    });
  });

  describe("calculateVoucherDiscount — SPEC §10.4 worked example (under global cap)", () => {
    // original_subtotal=4,700,000; item_promotion_discount=900,000;
    // post_promotion_subtotal=3,800,000; voucher 10% on whole (eligible) cart.
    const lines: LineValue[] = [
      {
        line_id: "racket",
        unit_price: 4_500_000,
        quantity: 1,
        item_promotion_discount: 900_000,
        is_eligible: true,
      },
      {
        line_id: "string",
        unit_price: 200_000,
        quantity: 1,
        item_promotion_discount: 0,
        is_eligible: true,
      },
    ];

    it("reproduces 380,000 discount / 3,420,000 final total (T-VOUCH-07)", () => {
      const result = calculateVoucherDiscount({
        lines,
        discount_type: "percentage",
        discount_value: 1000, // 10%
        max_discount_amount: null,
        global_cap_bps: GLOBAL_CAP_BPS,
      });

      expect(result.original_subtotal).toBe(4_700_000);
      expect(result.item_promotion_discount).toBe(900_000);
      expect(result.post_promotion_subtotal).toBe(3_800_000);
      expect(result.eligible_post_promotion_subtotal).toBe(3_800_000);
      expect(result.raw_voucher_discount).toBe(380_000);
      expect(result.voucher_discount_after_voucher_cap).toBe(380_000);
      expect(result.maximum_combined_discount).toBe(2_350_000);
      expect(result.final_voucher_discount).toBe(380_000);
      expect(result.discount_capped).toBe(false);
      expect(result.expected_final_cart_total).toBe(3_420_000);
      // task 3.3.9: realized combined discount = item promo + final voucher discount.
      expect(result.combined_discount).toBe(1_280_000);
      // task 3.3.13: no cap explanation when the global cap did not bind.
      expect(result.cap_explanation).toBeNull();
    });
  });

  describe("calculateVoucherDiscount — SPEC §10.5 worked example (global cap exceeded)", () => {
    // original_subtotal=4,700,000; item_promotion_discount=1,860,000;
    // eligible post-promo=2,840,000; voucher 20% -> raw 568,000.
    const lines: LineValue[] = [
      {
        line_id: "racket",
        unit_price: 4_500_000,
        quantity: 1,
        item_promotion_discount: 1_800_000,
        is_eligible: true,
      },
      {
        line_id: "string",
        unit_price: 200_000,
        quantity: 1,
        item_promotion_discount: 60_000,
        is_eligible: true,
      },
    ];

    it("reproduces 490,000 final discount (capped from 568,000) / 2,350,000 final total (T-VOUCH-08)", () => {
      const result = calculateVoucherDiscount({
        lines,
        discount_type: "percentage",
        discount_value: 2000, // 20%
        max_discount_amount: null,
        global_cap_bps: GLOBAL_CAP_BPS,
      });

      expect(result.original_subtotal).toBe(4_700_000);
      expect(result.item_promotion_discount).toBe(1_860_000);
      expect(result.eligible_post_promotion_subtotal).toBe(2_840_000);
      expect(result.raw_voucher_discount).toBe(568_000);
      expect(result.voucher_discount_after_voucher_cap).toBe(568_000);
      expect(result.maximum_combined_discount).toBe(2_350_000);
      expect(result.final_voucher_discount).toBe(490_000);
      expect(result.discount_capped).toBe(true);
      expect(result.expected_final_cart_total).toBe(2_350_000);
      // task 3.3.9: when capped, the realized combined discount equals the cap threshold exactly.
      expect(result.combined_discount).toBe(2_350_000);
      expect(result.combined_discount).toBe(result.maximum_combined_discount);
      // task 3.3.13: Vietnamese cap explanation, SPEC §8.4 VOUCHER_DISCOUNT_CAPPED template.
      expect(result.cap_explanation).toEqual({
        code: "VOUCHER_DISCOUNT_CAPPED",
        message_vi:
          "Ưu đãi từ mã giảm giá đã được điều chỉnh từ 568.000₫ xuống 490.000₫ theo chính sách giảm giá tối đa",
        message_params: { original_amount: 568_000, final_amount: 490_000 },
      });
    });
  });

  describe("calculateVoucherDiscount — SPEC §10.6 / EC-03 (would-be negative total)", () => {
    it("clamps final_voucher_discount to 0 when item promo alone already consumes the global cap (T-VOUCH-09)", () => {
      // Voucher 50% + item promo 50% would combine to 100% of subtotal.
      // Global cap 50% forces final_voucher_discount = max(0, cap - item_promotion_discount).
      const lines: LineValue[] = [
        {
          line_id: "item",
          unit_price: 4_700_000,
          quantity: 1,
          item_promotion_discount: 2_350_000,
          is_eligible: true,
        },
      ];

      const result = calculateVoucherDiscount({
        lines,
        discount_type: "percentage",
        discount_value: 5000, // 50%
        max_discount_amount: null,
        global_cap_bps: GLOBAL_CAP_BPS,
      });

      expect(result.item_promotion_discount).toBe(2_350_000);
      expect(result.maximum_combined_discount).toBe(2_350_000);
      expect(result.final_voucher_discount).toBe(0);
      expect(result.discount_capped).toBe(true);
      // Not clamped to a minimum of 1 VND here (SPEC §10.2 policy `[NEEDS_VERIFICATION #13]`
      // is deliberately NOT applied in this pure layer — see calculate-discount.ts comment).
      expect(result.expected_final_cart_total).toBe(
        result.original_subtotal -
          result.item_promotion_discount -
          result.final_voucher_discount,
      );
    });

    it("item promotion consuming the entire cap alone (no voucher headroom) -> final voucher discount is 0", () => {
      const lines: LineValue[] = [
        {
          line_id: "item",
          unit_price: 1_000_000,
          quantity: 1,
          item_promotion_discount: 500_000,
          is_eligible: true,
        },
      ];

      const result = calculateVoucherDiscount({
        lines,
        discount_type: "percentage",
        discount_value: 1000,
        max_discount_amount: null,
        global_cap_bps: GLOBAL_CAP_BPS, // 50% of 1,000,000 = 500,000, fully consumed by item promo
      });

      expect(result.maximum_combined_discount).toBe(500_000);
      expect(result.final_voucher_discount).toBe(0);
    });
  });

  describe("calculateVoucherDiscount — fixed-amount voucher (SRS §22.2)", () => {
    it("does not exceed the eligible post-promotion subtotal", () => {
      const lines: LineValue[] = [
        {
          line_id: "item",
          unit_price: 50_000,
          quantity: 1,
          item_promotion_discount: 0,
          is_eligible: true,
        },
      ];

      const result = calculateVoucherDiscount({
        lines,
        discount_type: "fixed_amount",
        discount_value: 100_000, // exceeds eligible subtotal of 50,000
        max_discount_amount: null,
        // 100% global cap here so this test isolates the fixed-amount-vs-eligible-subtotal
        // rule (SRS §22.2) from the separate global-cap rule (Rule 9/10, covered above).
        global_cap_bps: 10000,
      });

      expect(result.eligible_post_promotion_subtotal).toBe(50_000);
      expect(result.raw_voucher_discount).toBe(50_000);
      expect(result.final_voucher_discount).toBe(50_000);
    });
  });

  describe("calculateVoucherDiscount — voucher-specific max_discount_amount (Rule 8)", () => {
    it("caps the voucher discount before the global cap is applied", () => {
      const lines: LineValue[] = [
        {
          line_id: "item",
          unit_price: 1_000_000,
          quantity: 1,
          item_promotion_discount: 0,
          is_eligible: true,
        },
      ];

      const result = calculateVoucherDiscount({
        lines,
        discount_type: "percentage",
        discount_value: 3000, // 30% of 1,000,000 = 300,000 raw
        max_discount_amount: 100_000, // voucher-level cap applies first
        global_cap_bps: GLOBAL_CAP_BPS, // 50% of 1,000,000 = 500,000 (not the binding constraint)
      });

      expect(result.raw_voucher_discount).toBe(300_000);
      expect(result.voucher_discount_after_voucher_cap).toBe(100_000);
      expect(result.final_voucher_discount).toBe(100_000);
      expect(result.discount_capped).toBe(false); // reduced by the voucher's own cap, not the global cap
      expect(result.cap_explanation).toBeNull();
    });
  });

  // task 3.3.12: discount_capped must be true iff the GLOBAL cap is the
  // constraint that bound final_voucher_discount — not the voucher's own
  // max_discount_amount, and not simply "any reduction happened".
  describe("calculateVoucherDiscount — discount_capped semantics matrix (task 3.3.12)", () => {
    const line = (item_promotion_discount: number): LineValue[] => [
      {
        line_id: "item",
        unit_price: 1_000_000,
        quantity: 1,
        item_promotion_discount,
        is_eligible: true,
      },
    ];

    it("false when neither cap binds", () => {
      const result = calculateVoucherDiscount({
        lines: line(0),
        discount_type: "percentage",
        discount_value: 1000, // 10% -> raw 100,000
        max_discount_amount: null,
        global_cap_bps: GLOBAL_CAP_BPS, // 50% of 1,000,000 = 500,000, well above raw
      });
      expect(result.discount_capped).toBe(false);
      expect(result.cap_explanation).toBeNull();
    });

    it("false when only the voucher's own max_discount_amount binds", () => {
      const result = calculateVoucherDiscount({
        lines: line(0),
        discount_type: "percentage",
        discount_value: 5000, // 50% -> raw 500,000
        max_discount_amount: 300_000,
        global_cap_bps: GLOBAL_CAP_BPS, // 500,000 cap, not the binding constraint
      });
      expect(result.voucher_discount_after_voucher_cap).toBe(300_000);
      expect(result.final_voucher_discount).toBe(300_000);
      expect(result.discount_capped).toBe(false);
      expect(result.cap_explanation).toBeNull();
    });

    it("true when only the global cap binds", () => {
      const result = calculateVoucherDiscount({
        lines: line(0),
        discount_type: "percentage",
        discount_value: 2000, // 20% -> raw 200,000
        max_discount_amount: null,
        global_cap_bps: 1000, // 10% of 1,000,000 = 100,000
      });
      expect(result.voucher_discount_after_voucher_cap).toBe(200_000);
      expect(result.final_voucher_discount).toBe(100_000);
      expect(result.discount_capped).toBe(true);
      expect(result.cap_explanation).toEqual({
        code: "VOUCHER_DISCOUNT_CAPPED",
        message_vi:
          "Ưu đãi từ mã giảm giá đã được điều chỉnh từ 200.000₫ xuống 100.000₫ theo chính sách giảm giá tối đa",
        message_params: { original_amount: 200_000, final_amount: 100_000 },
      });
    });

    it("true when the voucher cap binds first but the global cap binds tighter", () => {
      const result = calculateVoucherDiscount({
        lines: line(0),
        discount_type: "percentage",
        discount_value: 5000, // 50% -> raw 500,000
        max_discount_amount: 300_000, // voucher cap reduces to 300,000 first
        global_cap_bps: 1000, // 10% of 1,000,000 = 100,000 -> tighter than 300,000
      });
      expect(result.voucher_discount_after_voucher_cap).toBe(300_000);
      expect(result.final_voucher_discount).toBe(100_000);
      expect(result.discount_capped).toBe(true);
    });
  });

  describe("postPromotionLineValue (task 3.3.4)", () => {
    it("returns unit_price * quantity minus the line's item promotion discount", () => {
      const line: LineValue = {
        line_id: "a",
        unit_price: 200_000,
        quantity: 2,
        item_promotion_discount: 50_000,
        is_eligible: true,
      };
      expect(postPromotionLineValue(line)).toBe(350_000);
    });

    it("floors at 0 when the discount exceeds the line's original total", () => {
      const line: LineValue = {
        line_id: "a",
        unit_price: 100,
        quantity: 1,
        item_promotion_discount: 150,
        is_eligible: true,
      };
      expect(postPromotionLineValue(line)).toBe(0);
    });
  });

  describe("resolveEligibleItems (task 3.3.5)", () => {
    const lines: LineValue[] = [
      {
        line_id: "racket",
        unit_price: 4_500_000,
        quantity: 1,
        item_promotion_discount: 0,
        is_eligible: false,
        product_id: "prod_racket",
        category_ids: ["cat_rackets"],
      },
      {
        line_id: "string",
        unit_price: 200_000,
        quantity: 1,
        item_promotion_discount: 0,
        is_eligible: false,
        product_id: "prod_string",
        category_ids: ["cat_accessories"],
      },
    ];

    it("marks every line eligible when the voucher is unscoped", () => {
      const result = resolveEligibleItems(lines, {
        product_ids: [],
        category_ids: [],
      });
      expect(result.map((l) => l.is_eligible)).toEqual([true, true]);
    });

    it("marks only the matching line eligible for a product-scoped voucher", () => {
      const result = resolveEligibleItems(lines, {
        product_ids: ["prod_string"],
        category_ids: [],
      });
      expect(result.map((l) => l.is_eligible)).toEqual([false, true]);
    });

    it("marks only the matching line eligible for a category-scoped voucher", () => {
      const result = resolveEligibleItems(lines, {
        product_ids: [],
        category_ids: ["cat_rackets"],
      });
      expect(result.map((l) => l.is_eligible)).toEqual([true, false]);
    });

    it("combines product and category scope with OR", () => {
      const result = resolveEligibleItems(lines, {
        product_ids: ["prod_racket"],
        category_ids: ["cat_accessories"],
      });
      expect(result.map((l) => l.is_eligible)).toEqual([true, true]);
    });

    it("leaves a line ineligible when it has no product_id/category_ids and the voucher is scoped", () => {
      const result = resolveEligibleItems(
        [
          {
            line_id: "no-product",
            unit_price: 10_000,
            quantity: 1,
            item_promotion_discount: 0,
            is_eligible: false,
          },
        ],
        { product_ids: ["prod_racket"], category_ids: [] },
      );
      expect(result[0].is_eligible).toBe(false);
    });

    it("does not mutate the input lines", () => {
      const before = lines.map((l) => l.is_eligible);
      resolveEligibleItems(lines, { product_ids: [], category_ids: [] });
      expect(lines.map((l) => l.is_eligible)).toEqual(before);
    });
  });

  describe("formatVnd (task 3.3.13)", () => {
    it("formats with dot thousands separators and a ₫ suffix, no space, no decimals", () => {
      expect(formatVnd(30_000)).toBe("30.000₫");
      expect(formatVnd(568_000)).toBe("568.000₫");
      expect(formatVnd(0)).toBe("0₫");
    });
  });

  describe("DEFAULT_GLOBAL_CAP_BPS (task 3.3.10)", () => {
    it("defaults to 50% (5000 bps), matching SRS §5.2 DiscountCapConfig default", () => {
      expect(DEFAULT_GLOBAL_CAP_BPS).toBe(5000);
    });
  });
});
