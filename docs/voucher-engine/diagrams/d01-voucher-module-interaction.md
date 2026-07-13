# D-01. VoucherEngine Module Interaction Diagram

## Purpose

Show how VoucherEngine interacts with MedusaJS core modules, Redis, and durable persistence while preserving ownership boundaries.

## Related Solution Sections

- 3. Solution Context
- 3.2 Source-of-Truth Rules
- 4. Module Responsibility and Boundaries
- 14. Module Interaction Map
- 16. Redis Coordination and Cache Policy
- 17. Technical Design Inputs for Future SPEC Generation

## Mermaid Diagram

```mermaid
flowchart TB
    Customer[Customer]
    Admin[Admin]
    Storefront[Storefront]
    AdminUI[Admin UI]

    subgraph Medusa[MedusaJS Backend]
        VE[VoucherEngine Module]
        Cart[Cart Module\nSource of cart state and totals]
        Promotion[Promotion Module\nItem-level promotion result]
        Pricing[Pricing Module\nResolved price basis]
        Product[Product Module\nProduct and category scope]
        CustomerMod[Customer Module\nCustomer identity and segment context]
        Order[Order Module\nSuccessful order event]
        Inventory[Inventory Module\nOptional future stock-based rules]
    end

    Redis[(Redis\nTemporary cache / rate limit / coordination)]
    DB[(PostgreSQL / Medusa Persistence\nDurable voucher config and usage logs)]

    Customer --> Storefront
    Admin --> AdminUI

    Storefront -->|Apply / remove / list voucher| VE
    AdminUI -->|Create / update / deactivate voucher| VE

    VE -->|Read latest cart / approved voucher state update| Cart
    VE -->|Read item-level promotion outcome| Promotion
    VE -->|Read resolved prices| Pricing
    VE -->|Read product/category scope| Product
    VE -->|Read customer identity / eligibility context| CustomerMod
    VE -.->|Optional stock-aware rule| Inventory

    Cart -.->|cart.updated event| VE
    Order -.->|successful order event| VE

    VE -->|Rate limit / short TTL cache / temporary lock| Redis
    VE -->|VoucherConfig / DiscountCapConfig / VoucherUsageLog| DB

    Cart --> DB
    Promotion --> DB
    Pricing --> DB
    Product --> DB
    CustomerMod --> DB
    Order --> DB
```

## Interpretation

VoucherEngine coordinates voucher validation, discount decision, cap enforcement, and redemption audit. It does not own cart items, product data, item-level promotions, prices, order lifecycle, or inventory quantities.

Redis is a temporary support layer only. It may help with rate limiting, short-lived cache, and coordination, but final cart state, final cart totals, voucher configuration, redemption count, and usage logs must remain durable and authoritative outside Redis.

## SPEC Generation Notes

The future `SPEC.md` must inspect the current MedusaJS project before deciding:

- how active voucher state is associated with Cart;
- where cart totals are recalculated;
- how Promotion/Pricing expose item-level promotion results;
- which event names and payloads are available;
- whether Link Module should be used for product/category scoping;
- which operations need workflows, subscribers, links, or service calls.
