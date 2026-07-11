# Cart Rule Contract

Cart-level suggestions are generated only by active database cart rules. There is no independent hard-coded CR fallback and cart rules never use fixed `suggestion_rule_item` rows.

Rules are evaluated by ascending priority. All conditions within a rule use AND semantics. Each matching condition executes its SRS strategy:

- CR-01 `category_missing`: cart contains a configured source category; resolve missing complement categories through `category_complement_mapping`, then rank eligible category products by 30-day sales.
- CR-02 `threshold_near`: use the free-shipping/promotion threshold and configured percentage, then find eligible complement products in the remaining-price band.
- CR-03 `brand_match`: require one distinct cart brand and find same-brand products in configured accessory categories (or category complements).
- CR-04 `consumable_upsell`: for configured consumable categories and quantity limit, resolve explicit `product_bulk_mapping` rows.

Every candidate must be published, in stock, and absent from the cart. Results retain `rule_id`, use `CR-01` through `CR-04` as `rule_code`, are deduplicated in rule-priority order, and are capped at three.