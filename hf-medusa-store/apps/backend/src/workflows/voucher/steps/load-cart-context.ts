/**
 * loadCartContextStep — authoritative Cart read + line mapping (SPEC §23.3;
 * tasks 3.3.2, 3.8.3, 3.8.4).
 *
 * Reads the LATEST Cart from Medusa via `query.graph` and maps it to the pure
 * calculator's `LineValue[]` (lib/calculate-discount.ts), excluding
 * VoucherEngine's own Promotion adjustment from item-level promotion discount
 * (Rule 11). This is the ONLY adapter between Medusa's money/adjustment shapes
 * and the pure calculation layer — no monetary arithmetic happens here beyond
 * summation via `lib/money.ts`.
 *
 * Framework bindings used (verified against installed @medusajs/framework +
 * @medusajs/utils 2.16.0 — see SPEC §19.2 / session verification log):
 *  - `createStep` / `StepResponse` from `@medusajs/framework/workflows-sdk`
 *    (@medusajs/workflows-sdk `dist/utils/composer/create-step.d.ts`).
 *  - `ContainerRegistrationKeys.QUERY` from `@medusajs/framework/utils`
 *    (@medusajs/utils `dist/common/container.d.ts`: QUERY = "query").
 *  - `query.graph({ entity, filters, fields })` -> `{ data: any[] }` (verified
 *    pattern: `@medusajs/medusa/dist/api/store/carts/[id]/complete/route.js`).
 *  - Authoritative cart/line fields read here are exactly the verified fields
 *    from `@medusajs/medusa/dist/api/store/carts/query-config.js` (SPEC §10.7).
 *
 * `query.graph`'s `data` element type for entity "cart" is untyped (`any[]`)
 * in `@medusajs/types` (RemoteQueryEntryPoints has no "cart" entry) — the
 * `RawCart`/`RawCartLineItem` interfaces below are VoucherEngine-owned,
 * hand-specified from the verified field list, not a Medusa export.
 */

import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils";
import { sumInts, toInt } from "../../../modules/voucher-engine/lib/money";
import {
  LineValue,
  calculateItemPromotionDiscount,
  calculateOriginalSubtotal,
} from "../../../modules/voucher-engine/lib/calculate-discount";

export const loadCartContextStepId = "load-cart-context";

export interface LoadCartContextInput {
  cart_id: string;
  /**
   * The backing Promotion id for the voucher being applied/revalidated, when
   * known. Adjustments carrying this `promotion_id` are VoucherEngine's OWN
   * discount and are excluded from `item_promotion_discount` (Rule 11).
   * Optional because a first-apply has no promotion yet to exclude.
   */
  voucher_promotion_id?: string;
}

/** Authoritative Cart context, mapped to the pure calculator's plain-integer shape. */
export interface CartContext {
  cart_id: string;
  currency_code: string;
  lines: LineValue[];
  original_subtotal: number;
  item_promotion_discount: number;
  post_promotion_subtotal: number;
  /** Optimistic-concurrency marker (§14.2-C). `[NEEDS_VERIFICATION #3a]` — exact field (`updated_at` used here). */
  concurrency_marker: string;
}

/** VoucherEngine-owned shape for the subset of cart fields read (§10.7); NOT a Medusa export. */
interface RawCartAdjustment {
  id?: string;
  amount: unknown;
  promotion_id?: string | null;
  code?: string | null;
}

interface RawCartLineItem {
  id: string;
  unit_price: unknown;
  quantity: unknown;
  product_id?: string | null;
  product?: { categories?: { id: string }[] } | null;
  adjustments?: RawCartAdjustment[] | null;
}

interface RawCart {
  id: string;
  currency_code: string;
  updated_at: string;
  items?: RawCartLineItem[] | null;
}

const CART_CONTEXT_FIELDS = [
  "id",
  "currency_code",
  "updated_at",
  "items.id",
  "items.unit_price",
  "items.quantity",
  "items.product_id",
  "items.product.categories.id",
  "items.adjustments.id",
  "items.adjustments.amount",
  "items.adjustments.promotion_id",
  "items.adjustments.code",
];

export const loadCartContextStep = createStep(
  loadCartContextStepId,
  async (input: LoadCartContextInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);

    const { data } = await query.graph({
      entity: "cart",
      filters: { id: input.cart_id },
      fields: CART_CONTEXT_FIELDS,
    });

    const rawCart = data?.[0] as RawCart | undefined;
    if (!rawCart) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Cart '${input.cart_id}' not found`,
      );
    }

    const lines: LineValue[] = (rawCart.items ?? []).map((item) => {
      const unit_price = toInt(item.unit_price, `item[${item.id}].unit_price`);
      const quantity = toInt(item.quantity, `item[${item.id}].quantity`);

      // Rule 11 / SPEC §10.7: exclude VoucherEngine's own adjustment, identified
      // by `promotion_id`, from the item-level promotion discount.
      const nonVoucherAdjustments = (item.adjustments ?? []).filter(
        (adjustment) => adjustment.promotion_id !== input.voucher_promotion_id,
      );
      const item_promotion_discount = sumInts(
        nonVoucherAdjustments.map((adjustment) =>
          toInt(adjustment.amount, `item[${item.id}].adjustment.amount`),
        ),
        `item[${item.id}].item_promotion_discount`,
      );

      return {
        line_id: item.id,
        unit_price,
        quantity,
        item_promotion_discount,
        product_id: item.product_id ?? null,
        category_ids: (item.product?.categories ?? []).map(
          (category) => category.id,
        ),
        // Scope matching (V6) is a separate step — resolveEligibleItemsStep
        // (workflows/voucher/steps/resolve-eligible-items.ts) calls
        // resolveEligibleItems() on these lines using the voucher's scope.
        // This step only maps raw Cart fields; default false here.
        is_eligible: false,
      };
    });

    const original_subtotal = calculateOriginalSubtotal(lines);
    const item_promotion_discount = calculateItemPromotionDiscount(lines);
    const post_promotion_subtotal = Math.max(
      0,
      original_subtotal - item_promotion_discount,
    );

    const cartContext: CartContext = {
      cart_id: rawCart.id,
      currency_code: rawCart.currency_code,
      lines,
      original_subtotal,
      item_promotion_discount,
      post_promotion_subtotal,
      concurrency_marker: rawCart.updated_at,
    };

    return new StepResponse(cartContext);
  },
  // Read-only step — no compensation function (nothing to roll back).
);
