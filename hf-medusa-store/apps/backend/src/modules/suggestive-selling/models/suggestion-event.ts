import { model } from "@medusajs/framework/utils";

/**
 * SuggestionEvent — SRS §5.1 (SUGG-006 analytics).
 * Write-heavy, append-only. Deliberately decoupled: rule_id and the *_id fields
 * are plain text (no FK relations) so an analytics write never fails on rule/
 * product integrity, and rows survive rule soft-deletes. Indexed on created_at
 * for time-range analytics queries.
 */
const SuggestionEvent = model
  .define("suggestion_event", {
    id: model.id().primaryKey(),
    rule_id: model.text().nullable(),
    source_context: model.enum(["product_view", "cart"]),
    source_product_id: model.text().nullable(),
    suggested_product_id: model.text(),
    customer_id: model.text().nullable(),
    session_id: model.text().nullable(),
    action: model.enum(["impression", "tap", "add_to_cart", "dismiss"]),
    // SF-08 reporting: tier of the proposing rule + slot position of the card.
    tier: model.text().nullable(),
    slot: model.number().nullable(),
  })
  .indexes([{ on: ["created_at"] }]);

export default SuggestionEvent;
