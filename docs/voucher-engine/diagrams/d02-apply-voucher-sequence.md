# D-02. Apply Voucher Sequence Diagram

## Purpose

Show the end-to-end flow from voucher submission to updated cart response, including Redis cooldown, fail-fast validation, discount calculation, global cap enforcement, stale-cart protection, and Vietnamese customer response.

## Related Solution Sections

- 7.1 Apply New Voucher
- 7.7 Concurrent Cart and Voucher Operations
- 7.8 Voucher Attempt Protection
- 8. Voucher Validation Flow
- 9. Discount Resolution Flow
- 11. Error and Decision Contract
- 12. Language and Customer Messaging Policy
- 16. Redis Coordination and Cache Policy
- 18. Exception and Error Handling Contract

## Mermaid Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Customer
    participant SF as Storefront
    participant VE as VoucherEngine
    participant Redis as Redis
    participant Cart as Cart Module
    participant VDB as Voucher Persistence
    participant CustomerMod as Customer Module
    participant Product as Product Module
    participant Promo as Promotion Module
    participant Pricing as Pricing Module

    Customer->>SF: Submit voucher code
    SF->>VE: Apply voucher request

    VE->>VE: Normalize code\ntrim + uppercase + case-insensitive
    VE->>Redis: Check cooldown for customer/session/IP

    alt Active cooldown exists
        Redis-->>VE: Cooldown active
        VE-->>SF: VOUCHER_RATE_LIMITED + message_vi + retry info
        SF-->>Customer: Show Vietnamese retry message
    else No cooldown
        Redis-->>VE: Allowed
        VE->>Cart: Load latest editable cart
        Cart-->>VE: Cart snapshot + cart version / updated marker
        VE->>VDB: Load VoucherConfig by normalized code\nor short-lived config cache
        VDB-->>VE: Voucher configuration
        VE->>CustomerMod: Load customer context and usage history
        CustomerMod-->>VE: Customer eligibility context
        VE->>Product: Resolve product/category scope
        Product-->>VE: Scope data
        VE->>Promo: Load item-level promotion result
        Promo-->>VE: Item-level discount outcome
        VE->>Pricing: Load resolved price basis
        Pricing-->>VE: Current pricing values

        VE->>VE: Validate V1-V8 fail-fast

        alt Validation fails
            VE->>Redis: Increment failed-attempt counter if security-relevant
            VE-->>SF: Business error code + Vietnamese message\nCart unchanged
            SF-->>Customer: Show inline/toast error
        else Validation succeeds
            VE->>VE: Resolve eligible items
            VE->>VE: Calculate raw voucher discount
            VE->>VE: Apply voucher max discount amount
            VE->>VE: Enforce global discount cap\nReduce voucher only if needed
            VE->>Cart: Verify cart version / latest cart state

            alt Cart changed during evaluation
                Cart-->>VE: Cart changed
                VE->>Cart: Reload latest cart
                VE->>VE: Re-run cart-dependent validation and calculation
            else Cart still current
                Cart-->>VE: Cart still current
            end

            alt Latest cart remains eligible
                VE->>Cart: Attach voucher result and recalculate totals
                Cart-->>VE: Updated cart with final voucher discount
                VE-->>SF: Updated cart + applied voucher + message_vi\ncap explanation if applicable
                SF-->>Customer: Display updated total and saving
            else Latest cart no longer eligible
                VE-->>SF: Voucher rejected/removed + Vietnamese reason\nCart unchanged or recalculated without voucher
                SF-->>Customer: Show refresh/removal message
            end
        end
    end
```

## Interpretation

Voucher application is finalized only after validation, discount calculation, global-cap check, and latest-cart verification succeed. A failed validation or calculation must leave the cart unchanged. If the cart changes during evaluation, the outdated calculation result is discarded and the latest cart must be re-evaluated.

## SPEC Generation Notes

The future `SPEC.md` must define:

- Store API entry point for apply voucher;
- request/response DTOs;
- validation sequence and error mapping;
- Redis failed-attempt/cooldown keys and TTL;
- source of cart version or concurrency marker;
- source of promotion and pricing results;
- cart update/recalculation strategy;
- rollback behavior if calculation fails;
- Vietnamese message response shape.
