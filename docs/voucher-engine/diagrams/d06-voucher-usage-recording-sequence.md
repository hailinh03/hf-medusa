# D-06. Voucher Usage Recording Sequence Diagram

## Purpose

Show voucher redemption recording only after successful order placement. Applying a voucher to cart is not redemption. Successful order placement is redemption.

## Related Solution Sections

- 6. Voucher Lifecycle Overview
- 7.5 Record Voucher Usage After Successful Order Placement
- 10. Business Rules to Preserve
- 13. Data State Changes
- 17. Technical Design Inputs for Future SPEC Generation
- 18. Exception and Error Handling Contract
- 21. Risks and Pending Decisions

## Mermaid Diagram

```mermaid
sequenceDiagram
    autonumber
    participant Order as Order Module
    participant EventBus as Event Bus
    participant VE as VoucherEngine Subscriber
    participant Redis as Redis Coordination
    participant VDB as Voucher Persistence
    participant Audit as Audit / Logs

    Order->>Order: Successfully finalize order
    Order->>EventBus: Emit successful order event
    EventBus->>VE: Deliver order-success event

    VE->>VE: Verify order contains applied voucher
    VE->>VDB: Check existing VoucherUsageLog for voucher + order

    alt Usage log already exists
        VDB-->>VE: Duplicate found
        VE->>Audit: Log idempotent duplicate ignored
    else No usage log exists
        VDB-->>VE: No previous redemption
        VE->>Redis: Optional temporary atomic coordination / lock / reservation

        alt Coordination unavailable or rejected
            Redis-->>VE: Coordination failed or capacity unavailable
            VE->>Audit: Log redemption processing failure for recovery
        else Coordination accepted
            Redis-->>VE: Proceed
            VE->>VDB: Atomically increment usage count with usage-limit guard

            alt Usage limit unavailable at redemption time
                VDB-->>VE: Conditional update rejected
                VE->>Audit: Log over-redemption prevention / recovery required
            else Usage increment succeeds
                VDB-->>VE: Usage count updated
                VE->>VDB: Create immutable VoucherUsageLog
                VDB-->>VE: Usage log persisted
                VE->>Audit: Log redemption completed
            end
        end
    end
```

## Interpretation

Voucher usage count and VoucherUsageLog are created only after successful order placement. Usage recording must be idempotent and atomic. The same order event must not increment usage count more than once. Multiple concurrent successful orders must not exceed global or per-customer usage limits.

## SPEC Generation Notes

The future `SPEC.md` must define:

- exact successful order event name and payload;
- idempotency key or unique constraint strategy;
- atomic usage-count strategy;
- transaction boundary for increment + usage log creation;
- Redis coordination role, if used;
- failure recovery when order succeeded but voucher usage recording failed;
- event/subscriber tests for duplicate event delivery;
- concurrency tests near usage limit.
