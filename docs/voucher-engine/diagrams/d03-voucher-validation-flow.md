# D-03. Voucher Validation Decision Flowchart

## Purpose

Show fail-fast voucher validation from V1 to V8. Each failed validation returns one stable business error code and one Vietnamese customer-facing message.

## Related Solution Sections

- 7.1 Apply New Voucher
- 7.8 Voucher Attempt Protection
- 8. Voucher Validation Flow
- 10. Business Rules to Preserve
- 11. Error and Decision Contract
- 12. Language and Customer Messaging Policy
- 18. Exception and Error Handling Contract

## Mermaid Diagram

```mermaid
flowchart TD
    Start([Start voucher validation]) --> V1{V1: Code exists\nand is active?}

    V1 -->|No| E1[VOUCHER_NOT_FOUND\nor VOUCHER_INACTIVE\nReturn Vietnamese message\nCart unchanged]
    V1 -->|Yes| V2{V2: Current date inside\nvalidity range?}

    V2 -->|No| E2[VOUCHER_NOT_YET_ACTIVE\nor VOUCHER_EXPIRED\nReturn Vietnamese message\nCart unchanged]
    V2 -->|Yes| V3{V3: Global usage\nstill available?}

    V3 -->|No| E3[VOUCHER_USAGE_LIMIT_REACHED\nReturn Vietnamese message\nCart unchanged]
    V3 -->|Yes| V4{V4: Per-customer usage\nstill available?}

    V4 -->|No| E4[VOUCHER_USER_LIMIT_REACHED\nReturn Vietnamese message\nCart unchanged]
    V4 -->|Yes| V5{V5: Cart meets\nminimum order amount?}

    V5 -->|No| E5[VOUCHER_MIN_ORDER_NOT_MET\nReturn remaining amount\nCart unchanged]
    V5 -->|Yes| V6{V6: Cart contains\nat least one eligible item?}

    V6 -->|No| E6[VOUCHER_NO_ELIGIBLE_ITEMS\nExplain product/category scope\nCart unchanged]
    V6 -->|Yes| V7{V7: Customer segment\neligible when configured?}

    V7 -->|No| E7[VOUCHER_SEGMENT_NOT_ELIGIBLE\nReturn Vietnamese message\nCart unchanged]
    V7 -->|Yes| V8{V8: No stacking\nconflict?}

    V8 -->|No| E8[VOUCHER_STACKING_CONFLICT\nReturn Vietnamese message\nCart unchanged]
    V8 -->|Yes| Success([Validation passed\nContinue to discount calculation])

    E1 --> Stop([Stop validation])
    E2 --> Stop
    E3 --> Stop
    E4 --> Stop
    E5 --> Stop
    E6 --> Stop
    E7 --> Stop
    E8 --> Stop
```

## Interpretation

Validation must stop at the first failed rule. The system must return one clear failure reason and must not continue to later checks. This avoids confusing multi-error responses and reduces unnecessary disclosure of voucher details.

## SPEC Generation Notes

The future `SPEC.md` must define:

- validation function/service responsibility;
- exact error code constants;
- Vietnamese default messages;
- metadata for dynamic values such as remaining amount or expiry date;
- which failures increment Redis failed-attempt counters;
- whether V7 segment validation is active or deferred;
- unit tests for every validation branch.
