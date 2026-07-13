import { ApplyVoucherSchema, RemoveVoucherSchema } from "../validators";

// SEC-01 / SPEC §23.5 (task 3.8.3) — the Store API must reject any
// client-supplied pricing, identity, or eligibility field.
describe("store cart voucher validators", () => {
  describe("ApplyVoucherSchema", () => {
    const validBody = { code: "SHUTTLE20", cart_id: "cart_01ABC" };

    it("accepts a minimal valid apply body", () => {
      const result = ApplyVoucherSchema.safeParse(validBody);
      expect(result.success).toBe(true);
    });

    it("accepts confirm_replace as an optional boolean", () => {
      const result = ApplyVoucherSchema.safeParse({
        ...validBody,
        confirm_replace: true,
      });
      expect(result.success).toBe(true);
    });

    it("rejects a code shorter than 6 characters (SEC-03)", () => {
      const result = ApplyVoucherSchema.safeParse({
        ...validBody,
        code: "AB1",
      });
      expect(result.success).toBe(false);
    });

    it("rejects a non-alphanumeric code (SEC-03)", () => {
      const result = ApplyVoucherSchema.safeParse({
        ...validBody,
        code: "SHUTTLE-20",
      });
      expect(result.success).toBe(false);
    });

    it("rejects a missing cart_id", () => {
      const result = ApplyVoucherSchema.safeParse({ code: "SHUTTLE20" });
      expect(result.success).toBe(false);
    });

    it.each([
      "discount_amount",
      "final_voucher_discount",
      "original_discount",
      "expected_final_cart_total",
      "cart_total",
      "eligible_post_promotion_subtotal",
      "post_promotion_subtotal",
      "item_promotion_discount",
      "promotion_id",
      "voucher_id",
      "eligible_item_ids",
      "customer_id",
      "usage_count",
      "min_order_value",
      "discount_capped",
    ])(
      "rejects a client-supplied pricing/identity/eligibility field: %s",
      (forbiddenField) => {
        const result = ApplyVoucherSchema.safeParse({
          ...validBody,
          [forbiddenField]: 1,
        });
        expect(result.success).toBe(false);
      },
    );
  });

  describe("RemoveVoucherSchema", () => {
    it("accepts a minimal valid remove body", () => {
      const result = RemoveVoucherSchema.safeParse({ cart_id: "cart_01ABC" });
      expect(result.success).toBe(true);
    });

    it("rejects a missing cart_id", () => {
      const result = RemoveVoucherSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects a client-supplied pricing field", () => {
      const result = RemoveVoucherSchema.safeParse({
        cart_id: "cart_01ABC",
        final_voucher_discount: 1,
      });
      expect(result.success).toBe(false);
    });
  });
});
