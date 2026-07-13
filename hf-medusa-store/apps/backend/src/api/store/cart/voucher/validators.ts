import { z } from "@medusajs/framework/zod";

/**
 * Zod validators for the store voucher API — SPEC §23.5 (tasks 3.8.3, 3.8.4).
 *
 * `validateAndTransformBody` (see src/api/middlewares.ts) parses the request
 * body with these schemas and populates `req.validatedBody`.
 *
 * `.strict()` is the enforcement mechanism for "server-side-only discount
 * calculation" (SEC-01): any pricing, identity, or eligibility field the
 * client attempts to submit (e.g. `discount_amount`, `final_voucher_discount`,
 * any `*_total`, `promotion_id`, `voucher_id`, `customer_id`, `usage_count`,
 * `eligible_item_ids`, `min_order_value`, ...) is REJECTED at the validation
 * boundary — zod's `.strict()` throws on unrecognized keys instead of
 * silently stripping them, per the client field policy in SPEC §23.5 point 9.
 *
 * `code` normalization (trim + uppercase, Rule 2) happens in the workflow's
 * `normalizeCodeStep` (§11.1), NOT here — this schema only validates shape.
 */

export const ApplyVoucherSchema = z
  .object({
    code: z
      .string()
      .min(6, "Voucher code must be at least 6 characters") // SEC-03
      .regex(/^[A-Za-z0-9]+$/, "Voucher code must be alphanumeric"), // SEC-03
    cart_id: z.string().min(1, "cart_id is required"),
    confirm_replace: z.boolean().optional(),
  })
  .strict();

export type ApplyVoucherBody = z.infer<typeof ApplyVoucherSchema>;

/**
 * DELETE /store/cart/voucher — remove the active voucher. The client supplies
 * only the cart identifier; the active-voucher lookup, its Promotion, and the
 * resulting totals are all server-side (§23.5).
 */
export const RemoveVoucherSchema = z
  .object({
    cart_id: z.string().min(1, "cart_id is required"),
  })
  .strict();

export type RemoveVoucherBody = z.infer<typeof RemoveVoucherSchema>;
