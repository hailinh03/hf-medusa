import {
  variantAvailable,
  enrichOne,
  applyPersonalFilters,
  rankProductSuggestions,
  cr02Fires,
  cr02Band,
  mergeDedupeCart,
  EnrichedProduct,
  ProductSuggestion,
} from "../evaluator-logic";

/** Minimal EnrichedProduct fixture. */
function mk(id: string, over: Partial<EnrichedProduct> = {}): EnrichedProduct {
  return {
    product_id: id,
    handle: id,
    variant_id: `var_${id}`,
    name: id,
    image_url: null,
    price: 100000,
    discount_price: null,
    in_stock: true,
    requires_variant_selection: false,
    status: "published",
    category_names: [],
    brand: null,
    ...over,
  };
}
function ps(
  id: string,
  over: Partial<ProductSuggestion> = {},
): ProductSuggestion {
  return {
    ...mk(id),
    tier: "manual",
    rule_id: "r",
    label: null,
    display_order: 0,
    ...over,
  };
}

describe("SuggestiveSelling — pure evaluation logic (SPEC A.4–A.6)", () => {
  describe("variantAvailable (BR-02b)", () => {
    it("untracked inventory is always sellable", () => {
      expect(variantAvailable({ manage_inventory: false })).toBe(true);
    });
    it("sums stocked − reserved across location levels", () => {
      const v = {
        manage_inventory: true,
        inventory_items: [
          {
            inventory: {
              location_levels: [{ stocked_quantity: 5, reserved_quantity: 5 }],
            },
          },
          {
            inventory: {
              location_levels: [{ stocked_quantity: 3, reserved_quantity: 0 }],
            },
          },
        ],
      };
      expect(variantAvailable(v)).toBe(true); // 0 + 3 > 0
    });
    it("is false when nothing available", () => {
      const v = {
        manage_inventory: true,
        inventory_items: [
          {
            inventory: {
              location_levels: [{ stocked_quantity: 2, reserved_quantity: 2 }],
            },
          },
        ],
      };
      expect(variantAvailable(v)).toBe(false);
    });
  });

  describe("enrichOne", () => {
    const graph = {
      id: "p1",
      title: "BG65",
      status: "published",
      thumbnail: "x.png",
      metadata: { brand: "Yonex" },
      categories: [{ name: "Strings" }],
      variants: [
        {
          id: "v1",
          manage_inventory: false,
          calculated_price: {
            original_amount: 150000,
            calculated_amount: 105000,
          },
        },
      ],
    };
    it("maps price (original) + discount_price (calculated when lower)", () => {
      const e = enrichOne(graph);
      expect(e.price).toBe(150000);
      expect(e.discount_price).toBe(105000);
      expect(e.in_stock).toBe(true);
      expect(e.brand).toBe("Yonex");
      expect(e.category_names).toEqual(["Strings"]);
      expect(e.requires_variant_selection).toBe(false);
      expect(e.variant_id).toBe("v1");
    });
    it("flags requires_variant_selection for multi-variant, no variant_id (SUGG-104)", () => {
      const e = enrichOne({
        ...graph,
        variants: [
          {
            id: "v1",
            manage_inventory: false,
            calculated_price: {
              original_amount: 150000,
              calculated_amount: 150000,
            },
          },
          {
            id: "v2",
            manage_inventory: false,
            calculated_price: {
              original_amount: 160000,
              calculated_amount: 160000,
            },
          },
        ],
      });
      expect(e.requires_variant_selection).toBe(true);
      expect(e.variant_id).toBeNull();
      expect(e.discount_price).toBeNull(); // calculated == original
      expect(e.price).toBe(150000); // cheapest
    });
  });

  describe("applyPersonalFilters — BR-02 (T-SUGG-03/04/05)", () => {
    const cands = [mk("a"), mk("b", { in_stock: false }), mk("c"), mk("d")];
    it("(a) removes items already in cart — T-SUGG-03", () => {
      const out = applyPersonalFilters(cands, { cartProductIds: ["a"] }).map(
        (x) => x.product_id,
      );
      expect(out).not.toContain("a");
    });
    it("(b) removes out-of-stock — T-SUGG-04", () => {
      const out = applyPersonalFilters(cands, {}).map((x) => x.product_id);
      expect(out).not.toContain("b");
    });
    it("(c) removes dismissed — T-SUGG-05", () => {
      const out = applyPersonalFilters(cands, { dismissed: ["c"] }).map(
        (x) => x.product_id,
      );
      expect(out).not.toContain("c");
    });
    it("(d) removes purchased-30d-durable", () => {
      const out = applyPersonalFilters(cands, { purchasedDurable: ["d"] }).map(
        (x) => x.product_id,
      );
      expect(out).not.toContain("d");
    });
    it("keeps eligible items", () => {
      expect(
        applyPersonalFilters([mk("ok")], {}).map((x) => x.product_id),
      ).toEqual(["ok"]);
    });
  });

  describe("rankProductSuggestions (BR-01)", () => {
    it("orders tier then display_order and caps at 5", () => {
      const list = [
        ps("cat2", { tier: "category", display_order: 1001 }),
        ps("m2", { tier: "manual", display_order: 2 }),
        ps("m1", { tier: "manual", display_order: 1 }),
        ps("cat1", { tier: "category", display_order: 1000 }),
        ps("m3", { tier: "manual", display_order: 3 }),
        ps("m4", { tier: "manual", display_order: 4 }),
      ];
      const out = rankProductSuggestions(list).map((x) => x.product_id);
      expect(out).toEqual(["m1", "m2", "m3", "m4", "cat1"]); // manual first by order, cap 5
      expect(out).toHaveLength(5);
    });
  });

  describe("CR-02 threshold math (D4/D5 — T-SUGG-08)", () => {
    it("fires within 15% below threshold, not at/over it", () => {
      expect(cr02Fires(6_700_000, 7_000_000)).toBe(true); // 4.3% below
      expect(cr02Fires(5_950_000, 7_000_000)).toBe(true); // exactly 15% below (boundary)
      expect(cr02Fires(5_949_999, 7_000_000)).toBe(false); // >15% below
      expect(cr02Fires(7_000_000, 7_000_000)).toBe(false); // at threshold
      expect(cr02Fires(7_100_000, 7_000_000)).toBe(false); // over threshold
    });
    it("price band = [remaining, remaining×2] (SRS worked example)", () => {
      // threshold 7,000,000 − subtotal 6,700,000 = 300,000 → band [300k, 600k]
      expect(cr02Band(300_000)).toEqual({ min: 300_000, max: 600_000 });
    });
  });

  describe("mergeDedupeCart — dedupe + first-rule badge (BR-04)", () => {
    it("first (highest-priority) rule owns the badge; product appears once; caps at 3", () => {
      const collected = [
        { e: mk("x"), code: "CR-01", badge: null },
        { e: mk("x"), code: "CR-02", badge: "FREE ship" }, // duplicate — CR-01 already claimed x
        { e: mk("y"), code: "CR-02", badge: "FREE ship" },
        { e: mk("z"), code: "CR-03", badge: null },
        { e: mk("w"), code: "CR-04", badge: null }, // 4th unique — capped out
      ];
      const out = mergeDedupeCart(collected);
      expect(out).toHaveLength(3);
      expect(out.map((s) => s.product_id)).toEqual(["x", "y", "z"]);
      expect(out[0].rule_code).toBe("CR-01"); // x owned by CR-01, no badge
      expect(out[0].badge_text).toBeNull();
      expect(out[1].badge_text).toBe("FREE ship"); // y from CR-02 keeps badge
    });
  });
});
