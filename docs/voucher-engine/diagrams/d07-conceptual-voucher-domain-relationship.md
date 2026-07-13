# D-07. Conceptual Voucher Domain Relationship Diagram

## Purpose

Show conceptual business relationships for VoucherEngine without defining database schema, ORM decorators, migrations, or exact implementation files.

## Related Solution Sections

- 3.2 Source-of-Truth Rules
- 4. Module Responsibility and Boundaries
- 6. Voucher Lifecycle Overview
- 13. Data State Changes
- 17.6 Required Relationship and Link Decisions
- 21. Risks and Pending Decisions

## Mermaid Diagram

```mermaid
erDiagram
    VoucherConfig ||--o{ VoucherUsageLog : "has redemption records"
    VoucherConfig ||--o{ VoucherScope : "defines applicable scope"
    VoucherConfig ||--o{ CartVoucherState : "can be applied to carts"
    DiscountCapConfig ||--o{ VoucherCalculationResult : "limits combined discount"
    Cart ||--o| CartVoucherState : "has zero or one active voucher"
    CartVoucherState ||--|| VoucherCalculationResult : "stores calculated result"
    Customer ||--o{ VoucherUsageLog : "redeems"
    Order ||--o| VoucherUsageLog : "confirms redemption"
    Product ||--o{ VoucherScope : "may be eligible"
    Category ||--o{ VoucherScope : "may be eligible"

    VoucherConfig {
        string code
        string status
        string discount_type
        int discount_value
        int max_discount_amount
        int global_usage_limit
        int per_customer_usage_limit
        date valid_from
        date valid_until
    }

    VoucherScope {
        string scope_type
        string product_or_category_reference
    }

    CartVoucherState {
        string cart_reference
        string voucher_reference
        string validation_status
        int final_voucher_discount
        boolean discount_capped
    }

    VoucherCalculationResult {
        int original_subtotal
        int item_promotion_discount
        int raw_voucher_discount
        int final_voucher_discount
        boolean discount_capped
    }

    VoucherUsageLog {
        string voucher_reference
        string customer_reference
        string order_reference
        int actual_discount_applied
        int original_pre_cap_discount
        boolean discount_capped
        datetime redeemed_at
    }

    DiscountCapConfig {
        int global_discount_cap_percentage
        string status
    }

    Cart {
        string cart_reference
    }

    Customer {
        string customer_reference
    }

    Order {
        string order_reference
    }

    Product {
        string product_reference
    }

    Category {
        string category_reference
    }
```

## Interpretation

This diagram is conceptual. It shows business relationships, not final persistence design. The future `SPEC.md` must decide whether relationships are implemented through MedusaJS Link Module, stored references, separate scope records, read-only query references, or a combination.

VoucherUsageLog must remain immutable and historically valid even if voucher configuration, product category, or customer data changes later.

## SPEC Generation Notes

The future `SPEC.md` must decide:

- how VoucherConfig relates to Product and Category scope;
- how active voucher state is associated with Cart;
- whether CartVoucherState is persisted or represented through approved cart extension;
- how VoucherUsageLog references Customer and Order;
- whether product/category snapshots are needed for audit;
- which relationships use Link Module;
- which references remain read-only and must not mutate core module data.
