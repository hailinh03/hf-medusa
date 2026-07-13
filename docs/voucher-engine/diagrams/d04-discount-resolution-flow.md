# D-04. Discount Resolution Flowchart

## Purpose

Show the exact discount calculation order: item-level promotions first, voucher second, voucher cap third, global discount cap last. If the global cap is exceeded, only the voucher discount is reduced.

## Related Solution Sections

- 7.1 Apply New Voucher
- 7.4 Revalidate Voucher After Cart Change
- 9. Discount Resolution Flow
- 10. Business Rules to Preserve
- 13. Data State Changes
- 18. Exception and Error Handling Contract

## Mermaid Diagram

```mermaid
flowchart TD
    A([Start discount resolution]) --> B[Load original cart subtotal]
    B --> C[Load item-level promotion discount]
    C --> D[Calculate post-promotion subtotal]
    D --> E[Resolve voucher-eligible cart items]
    E --> F{Eligible subtotal > 0?}

    F -->|No| E_NO[VOUCHER_NO_ELIGIBLE_ITEMS\nCart remains unchanged]
    F -->|Yes| G[Calculate raw voucher discount\npercentage or fixed amount]

    G --> H{Voucher has\nmax_discount_amount?}
    H -->|Yes| I[Apply voucher-level cap\nvoucher_discount = min(raw, max)]
    H -->|No| J[Use raw voucher discount]

    I --> K[Calculate combined discount\nitem promotion + voucher]
    J --> K

    K --> L[Calculate maximum combined discount\noriginal_subtotal × global_discount_cap_percentage]
    L --> M{Combined discount\nexceeds global cap?}

    M -->|No| N[Keep voucher discount]
    M -->|Yes| O[Reduce voucher discount only\nitem promotion remains unchanged]

    N --> P[Recalculate final cart total]
    O --> P

    P --> Q{Final voucher discount >= 0\nand final total valid?}
    Q -->|No| ERR[VOUCHER_CALCULATION_FAILED\nDo not attach partial voucher result]
    Q -->|Yes| R[Return cart totals + voucher result\ninclude discount_capped status]
    R --> S([End])
    E_NO --> S
    ERR --> S
```

## Interpretation

Item-level promotion discounts are protected. VoucherEngine must never reduce item-level promotion discounts. When the global cap is exceeded, only the voucher discount is reduced. Cart totals must be recalculated from source values, not patched incrementally.

## Calculation Contract

```text
original_subtotal
= sum(original line item totals)

post_promotion_subtotal
= original_subtotal - item_promotion_discount

eligible_post_promotion_subtotal
= sum(post-promotion values of voucher-eligible line items)

raw_voucher_discount
= calculate voucher rule against eligible_post_promotion_subtotal

voucher_discount_after_voucher_cap
= min(raw_voucher_discount, max_discount_amount)
  when max_discount_amount exists

maximum_combined_discount
= original_subtotal × global_discount_cap_percentage

final_voucher_discount
= min(
    voucher_discount_after_voucher_cap,
    maximum_combined_discount - item_promotion_discount
)

final_cart_total
= original_subtotal
  - item_promotion_discount
  - final_voucher_discount
```

## SPEC Generation Notes

The future `SPEC.md` must define:

- integer money calculation strategy;
- rounding policy for percentage vouchers;
- fixed-amount voucher behavior when fixed amount exceeds eligible subtotal;
- voucher max discount amount handling;
- global discount cap source;
- guard against negative final voucher discount;
- guard against zero/negative cart total where policy requires minimum 1 VND;
- unit tests for under-cap and cap-exceeded cases.
