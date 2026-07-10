import { MedusaService } from "@medusajs/framework/utils";
import SuggestionRule from "./models/suggestion-rule";
import SuggestionRuleItem from "./models/suggestion-rule-item";
import CartSuggestionCondition from "./models/cart-suggestion-condition";
import SuggestionEvent from "./models/suggestion-event";
import CategoryComplementMapping from "./models/category-complement-mapping";

/**
 * SuggestiveSellingService - SRS section 2.1.
 * MedusaService auto-generates CRUD (list/retrieve/create/update/delete +
 * soft-delete) for every model below. This class adds thin data-access helpers
 * (SPEC A.3); cross-module reads (Product/Inventory/Order) live in evaluator.ts.
 */

/** A rule is active within its configured time window (SF-01 step 4). */
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
  async findPriorityConflicts(
    type: string,
    tier: string,
    priority: number,
    excludeId?: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const rows = await this.listSuggestionRules(
      { type, tier, priority },
      { select: ["id", "name"] },
    );
    return rows
      .filter((rule: any) => rule.id !== excludeId)
      .map((rule: any) => ({ id: rule.id, name: rule.name }));
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
