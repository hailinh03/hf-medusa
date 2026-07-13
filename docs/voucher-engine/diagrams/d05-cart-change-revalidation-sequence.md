# D-05. Cart Change Revalidation Sequence Diagram

## Purpose

Show how VoucherEngine reacts when the cart changes after a voucher has already been applied. The voucher may remain applied with recalculated discount, or it may be automatically removed.

## Related Solution Sections

- 7.4 Revalidate Voucher After Cart Change
- 7.7 Concurrent Cart and Voucher Operations
- 9. Discount Resolution Flow
- 10. Business Rules to Preserve
- 13. Data State Changes
- 18. Exception and Error Handling Contract

## Mermaid Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Customer
    participant SF as Storefront
    participant Cart as Cart Module
    participant EventBus as Event Bus
    participant VE as VoucherEngine Subscriber
    participant VDB as Voucher Persistence
    participant Promo as Promotion Module
    participant Pricing as Pricing Module
    participant Product as Product Module

    Customer->>SF: Add / remove / update cart item
    SF->>Cart: Update cart request
    Cart->>Cart: Persist cart mutation
    Cart-->>SF: Updated base cart response
    Cart->>EventBus: Emit cart.updated
    EventBus->>VE: Deliver cart.updated event

    VE->>Cart: Load latest cart state
    Cart-->>VE: Latest cart + active voucher state if any

    alt No active voucher
        VE-->>EventBus: No voucher action required
    else Active voucher exists
        VE->>VDB: Reload voucher configuration
        VDB-->>VE: VoucherConfig
        VE->>Product: Resolve product/category eligibility scope
        Product-->>VE: Scope data
        VE->>Promo: Recalculate or reload item-level promotion result
        Promo-->>VE: Promotion-adjusted values
        VE->>Pricing: Reload resolved price basis when required
        Pricing-->>VE: Current prices
        VE->>VE: Revalidate cart-dependent conditions

        alt Voucher still valid
            VE->>VE: Recalculate voucher discount and global cap
            VE->>Cart: Update voucher result and recalculate totals
            Cart-->>VE: Updated cart totals
            VE-->>SF: Cart can be refetched with recalculated voucher
        else Voucher no longer valid
            VE->>Cart: Remove voucher result and recalculate without voucher
            Cart-->>VE: Updated cart without voucher
            VE-->>SF: Vietnamese auto-removal reason available on refetch/notification
        end
    end
```

## Interpretation

Voucher eligibility is dynamic and depends on the latest cart state. After every cart update, an active voucher must be revalidated. If still valid, discount is recalculated. If invalid, the voucher is automatically removed and the customer must receive a Vietnamese reason.

## SPEC Generation Notes

The future `SPEC.md` must define:

- exact cart update event name and payload;
- subscriber file/registration plan;
- how active voucher state is detected on cart;
- how the storefront sees async recalculation results;
- whether MVP uses refetch/polling or push notification;
- idempotency behavior if the same cart.updated event is processed more than once;
- integration tests for eligible item removal, min order drop, and promotion tier changes.
