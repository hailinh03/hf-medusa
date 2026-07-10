import { MedusaContainer } from "@medusajs/framework/types";
import { SUGGESTIVE_SELLING_MODULE } from "../../../modules/suggestive-selling";
import { invalidateProductSuggestions } from "../../../lib/suggestion-cache";

/**
 * Cache-invalidation hook for suggestion rules (SF-07 sub-flow 7a-4 / KN-05).
 *
 * A product-rule change must delete the cached result of every source product it
 * references, so a warm cache never serves a stale rule beyond the operation
 * (product cache is store-agnostic in Phase-1 → single key per source product).
 * Best-effort: cache is optional (D11) and invalidation must never fail the write.
 */
export async function invalidateSuggestionCache(
  scope: MedusaContainer,
  ruleId: string,
): Promise<void> {
  const logger = scope.resolve("logger");
  try {
    const service: any = scope.resolve(SUGGESTIVE_SELLING_MODULE);
    const rule = await service.retrieveSuggestionRule(ruleId).catch(() => null);
    const sourceProductId: string | undefined = rule?.source_product_id;
    if (sourceProductId) {
      await invalidateProductSuggestions(scope, sourceProductId);
      logger.debug(
        `[suggestive] invalidated product cache for ${sourceProductId} (rule ${ruleId})`,
      );
    }
  } catch (e: any) {
    logger.warn(
      `[suggestive] cache invalidation failed for rule ${ruleId}: ${e?.message}`,
    );
  }
}
