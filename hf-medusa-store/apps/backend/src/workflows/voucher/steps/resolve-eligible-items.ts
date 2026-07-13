/**
 * resolveEligibleItemsStep — voucher-scope eligibility resolution (SPEC §11.10
 * step-contract table; task 3.3.5).
 *
 * Thin wrapper around the pure `resolveEligibleItems()` in
 * `lib/calculate-discount.ts` — no I/O, no Medusa calls of its own; it only
 * decorates the already-loaded `CartContext.lines` (from loadCartContextStep)
 * with `is_eligible`, given the voucher's scope.
 *
 * PARTIAL / typecheck-only this session: not wired into a live workflow (no
 * `applyVoucherWorkflow` exists yet) and not exercised against a real Cart —
 * see .claude/progress/voucher-engine-progress.md. The eligibility LOGIC
 * itself is fully implemented and unit-tested via `resolveEligibleItems`
 * directly (lib/__tests__/calculate-discount.unit.spec.ts).
 *
 * Deliberate divergence from SPEC §11.10's literal `{ scopes, line_items } ->
 * { eligible: EligibleItemDTO[] }` shape: that shape returns only eligible
 * item ids, which a caller would then have to re-filter back against
 * `CartContext.lines` before calculating — a second pass over the same data.
 * This step instead returns the full `LineValue[]` with `is_eligible` already
 * set, so `calculateVoucherDiscount` consumes it directly with no duplicate
 * filtering step (per "reuse existing code, no duplicate calculation paths").
 * The `VoucherScope` model (SPEC §5.4) itself is out of scope this session —
 * `scope` is accepted as the plain `{ product_ids, category_ids }` shape a
 * future caller would supply after reading `VoucherScope` rows.
 */

import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  LineValue,
  VoucherScope,
  resolveEligibleItems,
} from "../../../modules/voucher-engine/lib/calculate-discount";

export const resolveEligibleItemsStepId = "resolve-eligible-items";

export interface ResolveEligibleItemsInput {
  lines: LineValue[];
  scope: VoucherScope;
}

export interface ResolveEligibleItemsOutput {
  lines: LineValue[];
}

export const resolveEligibleItemsStep = createStep(
  resolveEligibleItemsStepId,
  async (input: ResolveEligibleItemsInput) => {
    const lines = resolveEligibleItems(input.lines, input.scope);
    const output: ResolveEligibleItemsOutput = { lines };
    return new StepResponse(output);
  },
  // Pure/deterministic — no compensation needed.
);
