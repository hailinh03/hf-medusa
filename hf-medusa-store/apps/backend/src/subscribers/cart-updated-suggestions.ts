import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { invalidateCartSuggestions } from "../lib/suggestion-cache";

/**
 * cart.updated → invalidate cart suggestion cache (SUGG-005 / SF-06 / KN-02).
 * Suggestion side ONLY: synchronously drop the cart's cached result so the next
 * GET re-evaluates fresh. Does NOT touch voucher (that revalidation runs sync in
 * the mutation request, not here). Failure-isolated + idempotent.
 */
export default async function cartUpdatedSuggestionsHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const cartId = event.data?.id;
  if (!cartId) return;
  try {
    await invalidateCartSuggestions(container, cartId);
  } catch (e: any) {
    container
      .resolve("logger")
      .warn(
        `[suggest] cart.updated invalidate failed (${cartId}): ${e?.message}`,
      );
  }
}

export const config: SubscriberConfig = {
  event: "cart.updated",
};
