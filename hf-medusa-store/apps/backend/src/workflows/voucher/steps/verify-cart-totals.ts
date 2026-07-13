/**
 * verifyCartTotalsStep — authoritative Cart-total verification (SPEC §23.4;
 * tasks 3.3.14, 3.8.4).
 *
 * Runs AFTER the voucher Promotion has been applied to the Cart (§11.1 step 9,
 * §14.2-A — out of scope this session, applyVoucherPromotionStep). Refetches
 * the Cart and proves the Cart Module's own recomputed totals match
 * VoucherEngine's internally calculated `final_voucher_discount` /
 * `expected_final_cart_total`.
 *
 * The internally calculated numbers are used ONLY as a verification oracle —
 * this step never writes a total. The refetched `cart` (specifically
 * `cart.total`) is the single pricing truth (Rule 18, INT-03, SEC-01) and is
 * exactly what flows on to the Store API response (§23.5). If verification
 * fails, the workflow's compensation chain removes the voucher Promotion via
 * `updateCartPromotionsWorkflow REMOVE` (applyVoucherPromotionStep's own
 * compensation, §14.2-A) so the Cart recomputes to its pre-voucher state —
 * this step performs no compensation of its own because it is read-only.
 *
 * Framework bindings verified (see load-cart-context.ts header for the shared
 * `createStep`/`StepResponse`/`ContainerRegistrationKeys.QUERY`/`query.graph`
 * bindings, all confirmed against installed @medusajs/framework 2.16.0).
 */

import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils";
import { sumInts, toInt } from "../../../modules/voucher-engine/lib/money";

export const verifyCartTotalsStepId = "verify-cart-totals";

export interface VerifyTotalsInput {
  cart_id: string;
  /** The voucher's backing Promotion id — used to find its adjustment(s) on the refetched cart. */
  promotion_id: string;
  /** VoucherEngine's internally calculated final voucher discount (lib/calculate-discount.ts). */
  final_voucher_discount: number;
  /** VoucherEngine's internally calculated expected final Cart total — verification oracle ONLY. */
  expected_final_cart_total: number;
}

export interface VerifyTotalsOutput {
  /** The refetched, authoritative Cart — the only Cart data the caller/route may return. */
  cart: RawVerifiedCart;
  verified: true;
}

/** VoucherEngine-owned shape for the subset of cart fields read here; NOT a Medusa export. */
interface RawCartAdjustment {
  amount: unknown;
  promotion_id?: string | null;
}
interface RawCartLineItem {
  id: string;
  adjustments?: RawCartAdjustment[] | null;
}
export interface RawVerifiedCart {
  id: string;
  total: unknown;
  discount_total: unknown;
  items?: RawCartLineItem[] | null;
  [key: string]: unknown;
}

const VERIFY_TOTALS_FIELDS = [
  "id",
  "total",
  "discount_total",
  "items.id",
  "items.adjustments.amount",
  "items.adjustments.promotion_id",
];

export const verifyCartTotalsStep = createStep(
  verifyCartTotalsStepId,
  async (input: VerifyTotalsInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);

    // 1. Refetch the LATEST cart — never trust the pre-apply snapshot.
    const { data } = await query.graph({
      entity: "cart",
      filters: { id: input.cart_id },
      fields: VERIFY_TOTALS_FIELDS,
    });

    const cart = data?.[0] as RawVerifiedCart | undefined;
    if (!cart) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Cart '${input.cart_id}' not found during verification`,
      );
    }

    // 2. Sum the adjustment(s) that belong to the voucher's backing Promotion.
    const appliedAdjustmentAmounts = (cart.items ?? [])
      .flatMap((item) => item.adjustments ?? [])
      .filter((adjustment) => adjustment.promotion_id === input.promotion_id)
      .map((adjustment) =>
        toInt(adjustment.amount, "verify-cart-totals.adjustment.amount"),
      );
    const applied_adjustment_total = sumInts(
      appliedAdjustmentAmounts,
      "verify-cart-totals.applied_adjustment_total",
    );

    const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

    // 3. Exact-equality check: the recorded voucher adjustment must equal what
    //    VoucherEngine computed (TOLERANCE = 0, no rounding slack).
    if (applied_adjustment_total !== input.final_voucher_discount) {
      // Internal mismatch detail is logged only — never exposed to the customer (§12.5, §18.6).
      logger.error(
        `[voucher-engine] verify-cart-totals: adjustment mismatch ${JSON.stringify(
          {
            cart_id: input.cart_id,
            promotion_id: input.promotion_id,
            expected: input.final_voucher_discount,
            actual: applied_adjustment_total,
          },
        )}`,
      );
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "VOUCHER_CALCULATION_FAILED",
      );
    }

    // 4. Exact-equality check: the Cart Module's own recomputed total must equal
    //    VoucherEngine's internal `expected_final_cart_total`.
    const authoritative_total = toInt(
      cart.total,
      "verify-cart-totals.cart.total",
    );
    if (authoritative_total !== input.expected_final_cart_total) {
      logger.error(
        `[voucher-engine] verify-cart-totals: total mismatch ${JSON.stringify({
          cart_id: input.cart_id,
          expected: input.expected_final_cart_total,
          actual: authoritative_total,
        })}`,
      );
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "VOUCHER_CALCULATION_FAILED",
      );
    }

    // 6. Success — return the REFETCHED cart. No custom total is constructed,
    //    persisted, or substituted here; `cart.total` remains the single
    //    pricing truth (task 3.8.4).
    const output: VerifyTotalsOutput = { cart, verified: true };
    return new StepResponse(output);
  },
  // Read-only step — no compensation of its own. On failure, the workflow's
  // earlier applyVoucherPromotionStep compensation (REMOVE the Promotion) runs
  // instead, so the Cart recomputes to its pre-voucher state (never a stale
  // write-back — Rule 18).
);
