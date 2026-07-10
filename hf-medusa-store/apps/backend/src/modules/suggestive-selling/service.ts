import { MedusaService } from "@medusajs/framework/utils";
import SuggestionRule from "./models/suggestion-rule";
import SuggestionRuleItem from "./models/suggestion-rule-item";
import CartSuggestionCondition from "./models/cart-suggestion-condition";
import SuggestionEvent from "./models/suggestion-event";
import CategoryComplementMapping from "./models/category-complement-mapping";

/**
 * SuggestiveSellingService — SRS §2.1.
 * MedusaService auto-generates CRUD (list/retrieve/create/update/delete +
 * soft-delete) for every model below. This class adds thin data-access helpers
 * (SPEC A.3); cross-module reads (Product/Inventory/Order) live in evaluator.ts.
 */

/** A rule is active-in-window at `at` (null bounds = always) — SF-01 step 4. */
function inWindow(rule: any, at: Date): boolean {
  const from = rule.valid_from ? new Date(rule.valid_from) : null;
  const to = rule.valid_to ? new Date(rule.valid_to) : null;
  if (from && from > at) return false;
  if (to && to < at) return false;
  return true;
}

class SuggestiveSellingService extends MedusaService({
  SuggestionRule,
  SuggestionRuleItem,
  CartSuggestionCondition,
  SuggestionEvent,
  CategoryComplementMapping,
}) {
  /**
   * Active product-level rules for a source product, ordered tier→priority asc
   * (SF-01 step 4 / BR-01). Window filtered in JS (null bounds = always).
   */
  async listActiveProductRules(sourceProductId: string, at: Date = new Date()) {
    const rules = await this.listSuggestionRules(
      { type: "product", is_active: true, source_product_id: sourceProductId },
      { relations: ["items"] },
    );
    const tierRank: Record<string, number> = {
      manual: 1,
      category: 2,
      behavioral: 3,
    };
    return rules
      .filter((r: any) => inWindow(r, at))
      .sort(
        (a: any, b: any) =>
          (tierRank[a.tier] ?? 9) - (tierRank[b.tier] ?? 9) ||
          (a.priority ?? 0) - (b.priority ?? 0),
      );
  }

  /** Active cart-level rules ordered by priority asc (SF-02 step 4 / BR-03). */
  async listActiveCartRules(at: Date = new Date()) {
    const rules = await this.listSuggestionRules(
      { type: "cart", is_active: true },
      { relations: ["conditions"] },
    );
    return rules
      .filter((r: any) => inWindow(r, at))
      .sort((a: any, b: any) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  /** Ranked complement categories for a source category (Tier-2 / CR-01). */
  async listComplements(sourceCategoryId: string) {
    return this.listCategoryComplementMappings(
      { source_category_id: sourceCategoryId, is_active: true },
      { order: { display_order: "ASC" } },
    );
  }

  /**
   * Detect a (type,tier,priority) conflict for admin writes (SF-07 / KN-05).
   * Returns the conflicting rule id, or null. `excludeId` skips the row being updated.
   */
  async findPriorityConflict(
    type: string,
    tier: string,
    priority: number,
    excludeId?: string,
  ): Promise<string | null> {
    const rows = await this.listSuggestionRules(
      { type, tier, priority },
      { select: ["id"] },
    );
    const hit = rows.find((r: any) => r.id !== excludeId);
    return hit ? hit.id : null;
  }

  /** Batch-insert analytics events; never throws (SF-08 fire-and-forget). */
  async recordEvents(events: any[]): Promise<number> {
    if (!events?.length) return 0;
    try {
      const created = await this.createSuggestionEvents(events);
      return Array.isArray(created) ? created.length : 1;
    } catch {
      return 0;
    }
  }
}

export default SuggestiveSellingService;
