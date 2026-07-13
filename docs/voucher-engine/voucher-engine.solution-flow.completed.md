# VoucherEngine Module – Solution Flow Document V2

> **Project:** Badminton Equipment & Accessories Store  
> 
> **Platform:** MedusaJS v2  
> 
> **Feature:** Voucher at Checkout  
> 
> **Document Level:** BA / Solution Design  
> 
> **Purpose:** Approved solution-flow contract for generating developer-level specifications.  
> 
> **Status:** Draft – requires manual review before generating `SPEC.md`  
> 
> **Source of Truth:** SRS – Suggestive Selling + Voucher at Checkout  
> 
> 
> 
> This document defines **how the VoucherEngine solution behaves at business and system-flow level**.  
> 
> It does **not** define source-code folders, files, functions, classes, database decorators, workflow-step names, or implementation details.
> 
> 

---



# 1. Document Purpose

The VoucherEngine allows customers to apply one voucher during checkout and receive an accurate discount based on voucher eligibility, item-level promotions, cart content, and the global discount-cap policy.



This document exists to ensure that:

1. Developers understand the intended solution before implementation.

2. Claude Code can convert approved solution flows into a developer-level `SPEC.md`.

3. Business rules are not reinterpreted during coding.

4. Cart, promotion, pricing, order, customer, and Redis impacts are identified early.

5. Tests can be derived directly from the approved flows.

6. Unknown MedusaJS integration details are explicitly marked as `Pending Decision` rather than guessed.

    

---

# 2. Feature Goal and Boundary

## 2.1 Feature Goal

The system must enable a customer to:

- enter a voucher code manually at checkout;

- choose an available voucher from “My Vouchers”;

- receive an immediate and accurate recalculation of the cart;

- understand why a voucher was rejected, removed, or capped;

- remove an applied voucher;

- retain correct cart totals after any cart change;

- use only one active voucher at a time.

    

The system must enable administrators to:

- configure voucher rules;

- control voucher validity, usage limits, scope, and discount conditions;

- review voucher usage and discount outcomes.

    

---

## 2.2 In Scope

- Voucher code normalization.

- Voucher lookup and validation.

- Manual voucher application.

- Voucher selection from customer voucher list.

- Replacement of an existing active voucher.

- Voucher removal.

- Voucher eligibility checks.

- Voucher scope by product and category.

- Minimum-order validation.

- Global usage limit validation.

- Per-customer usage limit validation.

- Customer segment validation when a segment source is available.

- Percentage-based voucher calculation.

- Fixed-amount voucher calculation.

- Voucher-specific maximum discount amount.

- Item promotion and voucher stacking.

- Global discount-cap enforcement.

- Voucher revalidation after cart updates.

- Voucher usage recording after successful order placement.

- Voucher usage audit logging.

- Voucher brute-force protection.

- Voucher-related admin configuration APIs.

    

---



## 2.3 Out of Scope

- Payment processing.

- Loyalty-program implementation.

- CRM campaign-management UI.

- Customer-segment source implementation.

- Voucher recommendation logic.

- Multiple voucher stacking.

- Voucher sharing or transfer between customers.

- Product catalog management.

- Promotion-engine redesign.

- Storefront UI implementation details.



## 2.4 Requirement Traceability

|SRS ID|Functional Requirement|VoucherEngine Responsibility|Solution Flow|Status|
|---|---|---|---|---|
|VOUCH-001|Apply voucher code|Validate, calculate, attach voucher result to cart|7.1 Apply New Voucher|Covered|
|VOUCH-002|Voucher validation V1–V8|Execute fail-fast validation pipeline|8. Voucher Validation Flow|Covered|
|VOUCH-003|Discount stacking and conflict resolution|Apply promotion first, voucher second, enforce cap|9. Discount Resolution Flow|Covered|
|VOUCH-004|Remove voucher|Remove voucher result and recalculate cart|7.3 Remove Voucher|Covered|
|VOUCH-005|Auto-invalidation after cart change|Revalidate or remove voucher on `cart.updated`|7.4 Revalidate Voucher After Cart Change|Covered|
|EC-01|Suggested item promotion + voucher exceeds cap|Preserve promotion; reduce voucher only|9.5 Global Discount-Cap Behavior|Covered|
|EC-02|Eligible items removed after voucher applied|Auto-remove voucher|7.4 Revalidate Voucher After Cart Change|Covered|
|EC-03|Combined discount could make total zero/negative|Enforce global cap and minimum payable amount|9.4 Guard Rules|Covered|
|EC-04|Apply voucher and remove final eligible item concurrently|Prevent stale cart result; retry/revalidate latest cart state|7.7 Concurrent Cart and Voucher Operations|Covered|
|EC-06|Apply → remove → reapply voucher in same session|Allowed; no usage count before order success|7.1 / 7.3 / 7.5|Covered|
|EC-08|Cart update activates new promotion tier|Recalculate promotion first, then voucher and global cap|7.4 + 9.1|Covered|
|EC-10|Repeated voucher-code attempts|Rate-limit failed attempts|7.8 Voucher Attempt Protection|Covered|
|SEC-01|Server-side discount truth|Cart calculation remains authoritative|3.2 + 9|Covered|
|SEC-02|Brute-force protection|Redis-backed rate limit and monitoring|7.8 Voucher Attempt Protection|Covered|
|INT-01|Integer monetary arithmetic|No floating-point calculation|9.4 Guard Rules|Covered|
|INT-02|Atomic voucher usage count|Atomic increment after successful order|7.5|Pending technical decision|
|INT-03|Recalculate cart from source values|Do not incrementally patch totals|9.1|Covered|
|INT-04|Immutable voucher usage log|Append-only audit record|7.5|Covered|

---



# 3. Solution Context

## 3.1 Core Principle

VoucherEngine is a custom business domain that coordinates voucher-specific validation and discount decisions.

VoucherEngine must not become a replacement for core commerce domains.



It must:

- read cart state from the Cart Module;

- use item-level promotion results from the Promotion Module;

- use resolved prices from the Pricing Module;

- use product/category information for scoped vouchers;

- use customer information for per-user and segment checks;

- react to successful order completion for redemption tracking;

- use Redis only for temporary coordination, rate limiting, caching, or atomic checks where approved.

    

---

## 3.2 Source-of-Truth Rules

|Concern|Source of Truth|VoucherEngine Responsibility|
|---|---|---|
|Cart items and quantities|Cart Module|Read cart state; request/update approved voucher-related cart state only|
|Cart totals|Cart Module / approved pricing flow|Ensure voucher result is included in recalculation|
|Product information|Product Module|Read product and category scope information|
|Item-level promotion result|Promotion Module|Read promotion-adjusted values before calculating voucher|
|Resolved prices|Pricing Module|Use current resolved price basis|
|Stock availability|Inventory Module|Not required for core voucher calculation unless future voucher rules depend on stock|
|Voucher configuration|VoucherEngine|Own voucher rules and configuration|
|Voucher redemption audit|VoucherEngine|Own usage log and redemption outcome|
|Customer identity|Customer Module|Read customer identity for eligibility checks|
|Customer segment|CRM / Customer source|Read only when available and approved|
|Voucher rate-limit state|Redis|Temporary, non-authoritative coordination|
|Permanent business state|PostgreSQL / Medusa persistence|Redis must never be the permanent source of truth|

---

# 4. Module Responsibility and Boundaries

## 4.1 VoucherEngine Owns

VoucherEngine owns the business logic for:

- voucher configuration;

- voucher code lookup;

- voucher eligibility validation;

- voucher discount calculation;

- voucher-specific discount cap;

- global discount-cap decision;

- voucher-related business errors;

- voucher usage-count policy;

- voucher usage audit logs;

- voucher brute-force protection policy.

    

---

## 4.2 VoucherEngine Reads or Uses

VoucherEngine requires access to:

- current editable cart;

- current cart line items;

- original item prices;

- item-level promotion results;

- resolved pricing values;

- product and category references;

- customer identity;

- customer usage history;

- customer segment information when configured;

- order-success event;

- Redis rate-limit and temporary atomic coordination state.

    

---

## 4.3 VoucherEngine Must Not Own

VoucherEngine must not directly own or independently redefine:

- cart line items;

- cart quantity changes;

- product data;

- category data;

- product prices;

- item-level promotion configuration;

- inventory quantities;

- payment flow;

- order lifecycle;

- order finalization;

- Redis as a source of truth.

    

---

# 5. MedusaJS Alignment Notes



VoucherEngine is a custom MedusaJS business module designed to integrate with the existing commerce engine.



At solution level, VoucherEngine is expected to integrate with or extend the Promotion capability, but it must not redesign the Promotion Module.



The future SPEC must verify the actual MedusaJS v2 project structure before deciding:

- whether VoucherEngine extends Promotion directly;

- whether it wraps Promotion behavior through workflow/service orchestration;

- how cart totals are recalculated;

- which event names are available;

- how Link Module should be used for product/category scoping;

- how the active voucher state is associated with Cart.

    

If the current MedusaJS source does not support an assumed mechanism, the SPEC must mark it as:



`BLOCKED: Pending Decision`



---

# 6. Voucher Lifecycle Overview

A voucher moves through the following conceptual states:



```Plain Text
Created
  ↓
Active
  ↓
Candidate for Cart Application
  ↓
Validated
  ↓
Applied to Cart
  ↓
Revalidated on Cart Change
  ├─ Still Valid → Recalculated and Remains Applied
  └─ Invalid → Automatically Removed
  ↓
Order Successfully Placed
  ↓
Usage Count Incremented
  ↓
Voucher Usage Log Created
```

Important lifecycle rules:

- Applying a voucher to a cart does not consume the voucher. 

- Removing a voucher from a cart does not consume the voucher. 

- A voucher is counted as used only after successful order placement. 

- A failed order must not increment usage count or create a usage log. 

- A voucher may remain configured after expiry or deactivation for audit/history purposes, but it cannot be newly applied.

# 7. Core Solution Flows

---

## 7.1 Apply New Voucher

### Trigger

A customer submits a voucher code from the checkout page.

The voucher code may come from:

- manual text entry; or 

- selection from the customer’s available-voucher list. 

---

### Preconditions

Before this flow starts:

- a cart exists; 

- the cart is editable; 

- the cart contains at least one line item; 

- the customer context is available when required by voucher rules; 

- current cart pricing can be resolved; 

- current item-level promotions can be resolved; 

- the system can access the configured global discount cap. 

---

### Main Solution Flow 

1. The customer submits a voucher code from checkout.

2. The system normalizes the submitted code:

    - removes leading and trailing whitespace;

    - converts the value to uppercase;

    - treats voucher codes as case-insensitive.

3. The system checks whether the current customer, anonymous session, or request identity is temporarily blocked from voucher attempts:

    - checks the active cooldown state in Redis;

    - if a cooldown exists, the system stops immediately;

    - returns a Vietnamese rate-limit response with retry information;

    - cart state remains unchanged.

4. The system loads the latest required state:

    - current editable cart;

    - customer context;

    - voucher configuration;

    - current item-level promotion results;

    - product/category information for scoped vouchers;

    - current voucher usage information;

    - active global discount-cap configuration.

5. The system may read voucher configuration and global discount-cap configuration from short-lived Redis cache when available.

6. Cached configuration must be treated only as a read optimization:

    - cart state must always come from the Cart Module;

    - current pricing and promotion result must be recalculated or obtained from their authoritative modules;

    - the full voucher-application result must not be reused from cache.

7. The system validates the voucher in the approved validation order.

8. Validation stops immediately at the first failed condition.

9. If validation fails:

    - no voucher discount is calculated;

    - cart pricing state remains unchanged;

    - the system determines whether the failure is a security-relevant voucher-code failure;

    - when applicable, the failed-attempt counter is incremented in Redis;

    - the customer receives one precise Vietnamese business-readable failure message.

10. If validation succeeds:

    - the system clears or allows the failed-attempt counter to expire according to the approved rate-limit policy;

    - the system determines voucher-eligible cart items;

    - the system calculates promotion-adjusted values for eligible items;

    - the system calculates the raw voucher discount;

    - the system applies voucher-level discount limits;

    - the system enforces the global discount cap;

    - the system calculates the final voucher discount.

11. Before the final voucher result is attached to the cart, the system verifies that the cart state used for calculation is still current.

12. If the cart changed during voucher evaluation:

    - discard the outdated calculation result;

    - reload the latest cart state;

    - rerun cart-dependent validation;

    - rerun eligible-item resolution;

    - rerun discount calculation;

    - rerun global-cap enforcement.

13. If the cart is still valid for the voucher:

    - the system associates the calculated voucher result with the cart;

    - the system recalculates cart totals;

    - the system returns the updated cart state.

14. The system returns:

    - updated cart totals;

    - applied voucher information;

    - final voucher discount;

    - discount cap status;

    - Vietnamese customer-facing message;

    - Vietnamese cap explanation when applicable.

---

### Observable Result

The customer sees one of the following outcomes:

| Outcome | Customer Result |
|---|---|
| Voucher applied normally | Vietnamese success message, updated cart total, and voucher saving amount |
| Voucher applied but capped | Updated cart total, adjusted voucher discount, and Vietnamese cap explanation |
| Voucher rejected | Vietnamese validation error message; cart remains unchanged |
| Voucher blocked by rate limit | Vietnamese cooldown message with retry information |
| Cart changed during apply | Recalculate using latest cart state or return refresh-required message |
| Calculation cannot complete | Safe Vietnamese error; cart remains unchanged |

---

### Side Effects

When the voucher is applied successfully:

- cart pricing state is updated; 

- active voucher state is associated with the cart; 

- updated cart total is returned; 

- voucher usage count remains unchanged; 

- voucher usage log is not created; 

- discount-cap information is returned when applicable. 

---

### Redis Use in This Flow

Redis may be used for:

- checking customer/session voucher-attempt cooldown;

- counting security-relevant failed voucher-code attempts;

- short-lived voucher configuration lookup cache;

- short-lived global discount-cap configuration cache;

- optional temporary coordination during concurrent cart-voucher operations.

    

Redis must not be used as the source of truth for:

- current cart items;

- cart totals;

- final voucher discount;

- final voucher application state;

- durable usage count;

- voucher usage logs.

---

### Failure Outcomes

| Failure Type | Expected Behavior |
|---|---|
| Voucher does not exist | Cart remains unchanged |
| Voucher is inactive or expired | Cart remains unchanged |
| Usage limit is exhausted | Cart remains unchanged |
| Customer usage limit is exhausted | Cart remains unchanged |
| Minimum order is not met | Cart remains unchanged; remaining amount is returned |
| No eligible item exists | Cart remains unchanged; scope explanation is returned |
| Customer segment is not eligible | Cart remains unchanged |
| Stacking conflict exists | Cart remains unchanged |
| Rate limit is active | Cart remains unchanged; cooldown message is returned |
| Cart changed during evaluation | Re-evaluate using latest cart state |
| Discount calculation fails | Do not attach partial voucher result |

---

### Modules Involved

| Module / Component | Role in Flow |
|---|---|
| Storefront | Sends voucher code and displays result |
| VoucherEngine | Validates voucher, resolves eligibility, calculates voucher discount, and enforces caps |
| Cart Module | Provides cart state and remains authoritative for cart totals |
| Promotion Module | Provides item-level promotion outcome |
| Pricing Module | Provides resolved price basis |
| Product Module | Provides product/category scope data |
| Customer Module | Provides customer identity and eligibility context |
| Order Module | Emits successful order event for redemption tracking |
| Redis | Supports rate limit, short-lived cache, and temporary coordination |
| PostgreSQL / Medusa Persistence | Stores durable voucher configuration and usage logs |

---

## 7.2 Replace Existing Voucher

### Trigger

A customer submits a new voucher while another voucher is already active on the cart.

---

### Main Solution Flow

1. The system detects that the cart already has an active voucher. 

2. The storefront asks the customer to confirm replacement. 

3. If the customer cancels: 

    - existing voucher remains active; 

    - no recalculation occurs. 

4. If the customer confirms: 

    - the system evaluates the new voucher using the full Apply New Voucher flow; 

    - existing voucher remains logically active until the new voucher has passed validation and calculation. 

5. If the new voucher fails: 

    - existing voucher remains unchanged; 

    - customer receives the failure reason for the new voucher. 

6. If the new voucher succeeds: 

    - the existing voucher is replaced; 

    - cart totals are recalculated using the new voucher result; 

    - old voucher usage count remains unchanged; 

    - new voucher usage count remains unchanged. 

---

### Important Rule

The system must not remove a valid existing voucher before the replacement voucher is fully validated and successfully calculated.

---

## 13.2 Remove Voucher

### Trigger

A customer explicitly removes the active voucher from the cart.

---

### Main Solution Flow

1. The customer selects remove on the active voucher. 

2. The system confirms that the cart currently contains an active voucher. 

3. The system removes the voucher association from the cart. 

4. The system removes the voucher discount from cart calculation. 

5. The system recalculates cart totals using only applicable item-level promotions. 

6. The system returns the updated cart state. 

7. The storefront displays a confirmation message. 

---

### Side Effects

- Voucher is no longer active on the cart. 

- Voucher discount is removed. 

- Cart totals are recalculated. 

- Voucher usage count remains unchanged. 

- Voucher usage log is not created. 

---

### Observable Result

The customer sees:

```Plain Text
Voucher {code} removed. (Vietnamese first)
```

---

## 7.4 Revalidate Voucher After Cart Change

### Trigger

The cart changes after a voucher has already been applied.

Cart changes include:

- item added; 

- item removed; 

- quantity updated; 

- variant changed; 

- price-affecting promotion state changed; 

- a suggested product added from Suggestive Selling; 

- a suggested product removed from cart. 

---

### Main Solution Flow

1. A cart update occurs. 

2. The Cart Module publishes a cart-change event. 

3. VoucherEngine receives the cart-change event. 

4. VoucherEngine checks whether an active voucher exists on the cart. 

5. If no active voucher exists: 

    - the flow ends; 

    - no voucher action is required. 

6. If an active voucher exists: 

    - the system loads the latest cart state; 

    - the system reloads relevant voucher configuration; 

    - the system revalidates cart-dependent conditions; 

    - the system re-evaluates eligible items; 

    - the system recalculates item-level promotions if required; 

    - the system recalculates voucher discount; 

    - the system rechecks the global discount cap. 

7. If voucher remains valid: 

    - cart totals are recalculated; 

    - voucher remains applied; 

    - updated voucher saving information is returned. 

8. If voucher is no longer valid: 

    - voucher is removed from cart; 

    - voucher discount is reversed; 

    - cart totals are recalculated without voucher discount; 

    - customer receives a clear removal reason. 

---

### Auto-Removal Examples

| Cart Change | Expected Result |
|---|---|
| Cart falls below voucher minimum order | Voucher is removed |
| All eligible items are removed | Voucher is removed |
| Eligible item quantity becomes zero | Voucher is removed |
| Cart becomes ineligible for scope rule | Voucher is removed |
| Cart remains eligible but values change | Voucher remains and discount is recalculated |
| New item-level promotion becomes active | Item promotion recalculates first, then voucher recalculates |
| Suggested product is added to cart | Voucher eligibility and discount are recalculated from latest cart |

---

### Important Rule

VoucherEngine must always calculate using the latest cart state.

It must not finalize voucher amounts based on stale cart data.

---

## 7.5 Record Voucher Usage After Successful Order Placement

### Trigger

An order using an active voucher is successfully placed.

---

### Preconditions

- Order is successfully finalized. 

- Order contains a valid voucher application result. 

- Voucher discount was included in final order total. 

- The order-success event is confirmed by the platform. 

---

### Main Solution Flow



1. The Order Module confirms successful order placement.

    

2. The platform publishes the approved order-success event.

    

3. VoucherEngine receives the event.

    

4. VoucherEngine verifies that:

    - the order contains an applied voucher;

    - the voucher discount was included in the final order;

    - the order has not already been processed for voucher redemption;

    - customer identity is available;

    - voucher usage information is available.

        

5. VoucherEngine performs an idempotency check:

    - if a usage log already exists for the same voucher and order;

    - redemption processing stops;

    - usage count must not be incremented again.

        

6. VoucherEngine performs an atomic redemption operation.

    

7. The atomic operation must ensure that:

    - global usage limit is still available at redemption time;

    - per-customer usage limit is still available at redemption time;

    - voucher usage count is incremented at most once;

    - multiple concurrent successful orders cannot exceed the configured limit;

    - the same order cannot be redeemed twice.

        

8. Redis may be used as a temporary coordination layer for atomic checks, locking, or reservation where approved.

    

9. Durable redemption state must still be persisted transactionally in the authoritative database layer.

    

10. If redemption capacity is no longer available:

    - the system must not silently create an invalid usage record;

    - the event failure must be logged for operational review;

    - the exact recovery or compensation behavior must follow the approved implementation decision.

        

11. If the atomic redemption operation succeeds:

    - voucher usage count is updated;

    - an immutable VoucherUsageLog is created;

    - the usage log records:

        - voucher identifier;

        - customer identifier;

        - order identifier;

        - actual discount applied;

        - original pre-cap voucher discount;

        - whether discount was capped;

        - redemption timestamp.

            

12. The system completes the audit process.

---

### Important Rules

- Voucher usage is recorded only after successful order placement. 

- Apply-to-cart does not increment usage count. 

- Remove-from-cart does not decrement usage count because it was never incremented. 

- Usage recording must be idempotent. 

- The same order must not create multiple usage logs. 

- Usage count must be updated atomically. 

---

### Atomicity Requirement



The future technical specification must define one approved atomic strategy for redemption.

Acceptable directions may include:

- database conditional update with usage-limit guard;

- transaction-based update and usage-log creation;

- Redis atomic coordination combined with durable database confirmation;

- another equivalent mechanism that prevents over-redemption.

    

The implementation must not rely on a non-atomic sequence such as:

1. read usage count;

2. check availability;

3. increment later;

    

because concurrent order completion can exceed the usage limit.

---

## 7.6 Admin Voucher Management

### Trigger

An authorized administrator creates, updates, deactivates, or reviews a voucher.

---

### Main Solution Flow

1. Admin submits voucher configuration. 

2. The system validates configuration completeness and consistency. 

3. The system stores voucher configuration. 

4. When voucher configuration changes: 

    - new applications must use latest configuration; 

    - currently applied vouchers may require revalidation depending on policy; 

    - usage logs remain immutable; 

    - historical redemption data must remain auditable. 

5. When a voucher is deactivated: 

    - it cannot be newly applied; 

    - existing carts with that voucher require a policy decision: 

        - remove immediately on next cart update; or 

        - allow until checkout/session expiration. 



### Pending Decision

The exact policy for vouchers already applied to active carts after admin deactivation must be confirmed.

---

## 7.7 Concurrent Cart and Voucher Operations

### Trigger

Two or more cart-related requests occur at nearly the same time.



Primary example:

- Request A applies a voucher.

- Request B removes the final voucher-eligible item from the cart.

    

Other examples:

- customer applies a voucher while changing item quantity;

- customer replaces a voucher while cart promotions are recalculated;

- cart update arrives while voucher revalidation is still processing.

    

### Main Solution Flow

1. The system receives concurrent requests affecting the same cart.

2. Each request reads the latest available cart state.

3. VoucherEngine must treat the cart state used during calculation as a temporary snapshot, not as permanently valid.

4. Before persisting a voucher result, VoucherEngine verifies that the cart version, mutation timestamp, or equivalent concurrency marker is unchanged.

5. If the cart state is still current:

    - the calculated voucher result may be attached to the cart;

    - cart totals may be recalculated.

6. If the cart changed during voucher evaluation:

    - the outdated calculation result must be discarded;

    - VoucherEngine reloads the latest cart state;

    - cart-dependent validation is rerun;

    - eligible items are resolved again;

    - item-level promotions are recalculated if necessary;

    - voucher discount is recalculated;

    - global discount cap is recalculated.

7. If the updated cart no longer satisfies voucher eligibility:

    - voucher must not remain applied;

    - voucher discount must not remain in cart totals;

    - the system removes the voucher;

    - the customer receives a Vietnamese notification explaining the removal reason.

8. If the updated cart remains eligible:

    - the recalculated voucher result replaces the previous temporary result;

    - updated cart totals are returned.

9. The final cart state must contain exactly one of the following:

    - one valid active voucher with recalculated discount; or

    - no active voucher.

        

### Optional Redis Coordination

Redis may be used for a short-lived cart-voucher coordination lock when approved.



The lock is only a coordination aid. It must not replace:

- cart version validation;

- final persistence consistency;

- revalidation using latest cart state.

    

### Required Integrity Rules

The system must never persist:

- a voucher discount calculated from removed items;

- a voucher attached to a cart that no longer meets eligibility;

- multiple conflicting active voucher states;

- cart totals based on stale cart content.

    

### Pending Decision

The future technical specification must define the approved concurrency strategy:

- optimistic locking using cart version or update timestamp;

- database transaction and conditional update;

- short-lived Redis lock plus version check;

- another MedusaJS-supported equivalent.

    

Until this is decided, implementation is blocked for concurrent mutation handling.



---

## 7.8 Voucher Attempt Protection



### Trigger

A customer repeatedly submits voucher codes that fail voucher-code validation.



### Purpose

Prevent brute-force attempts to discover valid voucher codes while preserving normal customer experience.



### Main Solution Flow

1. The customer submits a voucher code.

2. The system normalizes the voucher code.

3. Before running full voucher validation, the system checks Redis for an active cooldown state associated with the request identity.

4. If an active cooldown exists:

    - the system rejects the request immediately;

    - cart state remains unchanged;

    - the customer receives a Vietnamese rate-limit message;

    - no additional validation details are exposed.

5. If no cooldown exists:

    - the system continues with the normal Apply New Voucher flow.

6. If the request fails because the voucher code is invalid, unavailable, or otherwise classified as security-relevant:

    - the system increments the failed-attempt counter in Redis;

    - the counter uses a rolling time window;

    - security metadata is logged for monitoring.

7. If the failed-attempt threshold is reached:

    - the system creates a cooldown state in Redis;

    - further voucher attempts are blocked for the configured cooldown duration;

    - the customer receives a Vietnamese retry message;

    - security monitoring receives the required audit data.

8. If a voucher application succeeds:

    - the failed-attempt counter may be cleared or allowed to expire based on approved policy.

        

### Rate-Limit Rules

- Default threshold: maximum 5 failed voucher-code attempts within 15 minutes.

- Default cooldown: 30 minutes after threshold is reached.

- The exact threshold and cooldown must remain configurable.

- The system must not reveal whether a specific voucher code is valid through different technical responses.

- Internal monitoring may record customer ID, session ID, and IP address where available and compliant with project policy.

    

### 16.1 Redis Responsibilities

Redis is the primary temporary store for:

- failed-attempt counters;

- rolling-window timestamps;

- cooldown status;

- optional request identity tracking.

    

Redis is not the source of truth for:

- voucher configuration;

- cart totals;

- final voucher application;

- voucher redemption history.

    

### Pending Decision

The future technical specification must define the rate-limit identity strategy:



|Candidate Identity|Use Case|
|---|---|
|Customer ID|Authenticated checkout|
|Session ID|Guest checkout|
|IP address|Additional abuse protection|
|Customer ID + IP address|Higher protection with stricter behavior|
|Session ID + IP address|Guest checkout protection|



The decision must balance security, shared-network false positives, and guest checkout support.

# 8. Voucher Validation Flow

## 8.1 Validation Order

Voucher validation must execute in this order:

1. Voucher code exists and is active. 

2. Current date is inside voucher validity period. 

3. Global usage limit is available. 

4. Per-customer usage limit is available. 

5. Cart meets minimum order amount. 

6. Cart contains at least one eligible item. 

7. Customer meets segment conditions when configured. 

8. Voucher has no stacking conflict. 

---

## 8.2 Fail-Fast Rule

The system must stop at the first failed condition.

It must not continue checking later rules after a failure.

This prevents:

- unnecessary processing; 

- confusing multi-error responses; 

- accidental disclosure of voucher details; 

- inconsistent user feedback. 

---

## 8.3 Validation Decision Matrix

| Stage | Question | On Success | On Failure |
|---|---|---|---|
| V1 | Does voucher code exist and is it active? | Continue | Return `VOUCHER_NOT_FOUND` or `VOUCHER_INACTIVE` |
| V2 | Is current date within validity range? | Continue | Return `VOUCHER_NOT_YET_ACTIVE` or `VOUCHER_EXPIRED` |
| V3 | Is global usage still available? | Continue | Return `VOUCHER_USAGE_LIMIT_REACHED` |
| V4 | Can current customer still use it? | Continue | Return `VOUCHER_USER_LIMIT_REACHED` |
| V5 | Does cart meet minimum order amount? | Continue | Return `VOUCHER_MIN_ORDER_NOT_MET` |
| V6 | Does cart contain eligible items? | Continue | Return `VOUCHER_NO_ELIGIBLE_ITEMS` |
| V7 | Is customer segment eligible when configured? | Continue | Return `VOUCHER_SEGMENT_NOT_ELIGIBLE` |
| V8 | Is stacking allowed? | Continue to discount calculation | Return `VOUCHER_STACKING_CONFLICT` |

---

# 9. Discount Resolution Flow

## 9.1 Calculation Principles

The system must calculate discounts in this exact order:

1. Determine original cart subtotal. 

2. Determine item-level promotion discounts. 

3. Determine post-promotion amount. 

4. Determine voucher-eligible items. 

5. Calculate voucher discount using eligible post-promotion amount. 

6. Apply voucher-specific maximum discount amount. 

7. Calculate combined discount. 

8. Enforce global discount cap. 

9. Reduce only voucher discount if cap is exceeded. 

10. Recalculate final cart total. 

---

## 9.2 Discount Definitions

| Term | Meaning |
|---|---|
| Original subtotal | Total original value of all cart items before any discount |
| Item promotion discount | Total automatic discount from item-level promotions |
| Post-promotion subtotal | Original subtotal minus item promotion discount |
| Eligible subtotal | Post-promotion value of voucher-eligible cart items |
| Raw voucher discount | Voucher amount before voucher-specific cap |
| Voucher-capped discount | Voucher amount after `max_discount_amount` |
| Maximum combined discount | Original subtotal multiplied by configured global cap |
| Final voucher discount | Voucher amount remaining after global-cap enforcement |
| Final cart total | Amount customer pays after all valid discounts |

---

## 9.3 Calculation Contract

```Plain Text
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

---

## 9.4 Guard Rules

```Plain Text
final_voucher_discount must never be negative.

item-level promotion discount must never be reduced by VoucherEngine.

final_cart_total must not be negative.

final_cart_total must remain at least 1 VND where required by policy.

all monetary values must use integer arithmetic.

floating-point arithmetic must not be used for discount calculation.
```

---

## 9.5 Global Discount-Cap Behavior

When the combined discount exceeds the configured maximum discount percentage:

1. Item-level promotion discount remains unchanged. 

2. Voucher discount is reduced. 

3. The final voucher discount is recalculated to fit the allowed remaining discount amount. 

4. The system returns: 

    - `discount_capped = true`; 

    - original voucher discount; 

    - final voucher discount; 

    - human-readable cap explanation. (Vietnamese first)

---

## 9.6 Worked Example: Under Global Cap

```Plain Text
Original subtotal:
4,700,000 VND

Item promotion discount:
900,000 VND

Post-promotion subtotal:
3,800,000 VND

Voucher:
10% off eligible cart

Raw voucher discount:
380,000 VND

Combined discount:
1,280,000 VND

Global cap:
50% of 4,700,000 = 2,350,000 VND

Result:
1,280,000 VND is below cap

Final voucher discount:
380,000 VND

Final cart total:
3,420,000 VND
```

---

## 9.7 Worked Example: Global Cap Exceeded

```Plain Text
Original subtotal:
4,700,000 VND

Item promotion discount:
1,860,000 VND

Voucher:
20% off eligible post-promotion total

Raw voucher discount:
568,000 VND

Combined discount:
2,428,000 VND

Global cap:
50% of 4,700,000 = 2,350,000 VND

Discount over cap:
78,000 VND

Final voucher discount:
490,000 VND

Final combined discount:
2,350,000 VND

Final cart total:
2,350,000 VND
```

Important conclusion:

```Plain Text
The item promotion discount is preserved.
Only the voucher discount is reduced.
```

---

# 10. Business Rules to Preserve

These rules are non-negotiable and must be copied into the future technical specification.

1. A cart can have only one active voucher. 

2. Voucher codes are case-insensitive. 

3. Voucher validation follows V1 → V8 order. 

4. Validation stops at the first failed rule. 

5. Item-level promotions are calculated before voucher discount. 

6. Percentage vouchers use eligible post-promotion value. 

7. Voucher discount applies only to eligible items. 

8. Voucher-specific maximum discount limits only voucher discount. 

9. Global discount cap is based on original cart subtotal. 

10. When global cap is exceeded, reduce only voucher discount. 

11. Item-level promotion discount must never be reduced by VoucherEngine. 

12. Voucher usage count does not increase when applied to cart. 

13. Voucher usage count increases only after successful order placement. 

14. Voucher usage log is created only after successful order placement. 

15. Voucher usage log is append-only and immutable. 

16. Cart changes require voucher revalidation. 

17. Invalid voucher after cart change must be removed automatically. 

18. Cart totals must be recalculated from source values, not incrementally patched. 

19. Monetary values use integer arithmetic only. 

20. Redis is not the source of truth for voucher or cart state. 

21. Voucher brute-force attempts must be rate-limited. 

22. Concurrent cart and voucher operations must not produce inconsistent cart state. 

---

# 11. Business Error Catalogue

| Error Code | Trigger | Customer Message Intent | Related Flow |
|---|---|---|---|
| `VOUCHER_NOT_FOUND` | Voucher code does not exist | Mã giảm giá không tồn tại | 7.1 / 8 |
| `VOUCHER_INACTIVE` | Voucher exists but is disabled | Mã giảm giá hiện không khả dụng | 7.1 / 8 |
| `VOUCHER_NOT_YET_ACTIVE` | Voucher validity has not started | Mã giảm giá chưa đến thời gian sử dụng | 7.1 / 8 |
| `VOUCHER_EXPIRED` | Voucher validity has ended | Mã giảm giá đã hết hạn | 7.1 / 8 |
| `VOUCHER_USAGE_LIMIT_REACHED` | Global usage limit exhausted | Mã giảm giá đã hết lượt sử dụng | 7.1 / 8 |
| `VOUCHER_USER_LIMIT_REACHED` | Customer usage limit exhausted | Bạn đã sử dụng hết số lượt cho mã này | 7.1 / 8 |
| `VOUCHER_MIN_ORDER_NOT_MET` | Cart below required minimum | Cần mua thêm số tiền còn thiếu | 7.1 / 8 |
| `VOUCHER_NO_ELIGIBLE_ITEMS` | No applicable product/category exists in cart | Giỏ hàng chưa có sản phẩm phù hợp | 7.1 / 8 |
| `VOUCHER_SEGMENT_NOT_ELIGIBLE` | Customer does not match segment rule | Tài khoản của bạn chưa đủ điều kiện sử dụng mã này | 7.1 / 8 |
| `VOUCHER_STACKING_CONFLICT` | Voucher cannot combine with active discount rule | Mã giảm giá không thể áp dụng cùng ưu đãi hiện tại | 7.1 / 8 |
| `VOUCHER_RATE_LIMITED` | Too many failed attempts | Thử lại sau thời gian cooldown | 7.8 |
| `VOUCHER_DISCOUNT_CAPPED` | Global cap reduces voucher amount | Giải thích discount bị điều chỉnh | 9.5 |
| `VOUCHER_AUTO_REMOVED` | Voucher becomes invalid after cart change | Mã giảm giá đã tự động bị xóa và nêu lý do | 7.4 |
| `VOUCHER_CART_CHANGED` | Cart changed during voucher evaluation | Giỏ hàng đã thay đổi, cần tính lại | 7.7 |
| `VOUCHER_CALCULATION_FAILED` | Safe calculation failure | Không thể áp dụng mã lúc này, cart giữ nguyên | 7.1 / 18 |

---

# 12. Language and Customer Messaging Policy



## 12.1 Primary Language



All customer-facing messages, notifications, toast messages, validation errors, and discount explanations must use Vietnamese as the default language.



English is secondary and may be added later through i18n support.



## 12.2 Message Ownership



VoucherEngine does not render UI toast messages directly.



VoucherEngine must return:

- stable business error code;

- Vietnamese default message;

- optional message parameters;

- optional English fallback key for future localization.

    

The storefront is responsible for presenting the message as:

- inline validation message;

- toast notification;

- voucher tag message;

- cart summary explanation.

    

## 12.3 Required Response Message Contract



Each customer-visible response must include:



|Field|Purpose|
|---|---|
|`code`|Stable machine-readable business error code|
|`message_vi`|Default Vietnamese customer-facing message|
|`message_params`|Dynamic values such as amount, expiry date, voucher code|
|`severity`|`success`, `info`, `warning`, `error`|
|`display_hint`|Suggested UI presentation: toast, inline, cart-summary|



## 12.4 Vietnamese Message Examples



|Situation|Code|Vietnamese Message|
|---|---|---|
|Voucher applied|`VOUCHER_APPLIED`|`Đã áp dụng mã giảm giá {code}. Bạn tiết kiệm {amount}.`|
|Voucher removed|`VOUCHER_REMOVED`|`Đã xóa mã giảm giá {code}.`|
|Voucher expired|`VOUCHER_EXPIRED`|`Mã giảm giá đã hết hạn vào ngày {date}.`|
|Minimum order not met|`VOUCHER_MIN_ORDER_NOT_MET`|`Bạn cần mua thêm {remaining} để sử dụng mã này.`|
|No eligible item|`VOUCHER_NO_ELIGIBLE_ITEMS`|`Giỏ hàng chưa có sản phẩm phù hợp để áp dụng mã này.`|
|Voucher capped|`VOUCHER_DISCOUNT_CAPPED`|`Ưu đãi từ mã giảm giá đã được điều chỉnh từ {original_amount} xuống {final_amount} theo chính sách giảm giá tối đa.`|
|Auto-removed after cart change|`VOUCHER_AUTO_REMOVED`|`Mã giảm giá {code} đã được tự động xóa vì {reason}.`|
|Too many attempts|`VOUCHER_RATE_LIMITED`|`Bạn đã thử mã giảm giá quá nhiều lần. Vui lòng thử lại sau {minutes} phút.`|



## 12.5 Message Rules



- Do not return raw internal exception messages to customers.

- Do not expose technical details such as Redis, database, workflow, or stack trace.

- Dynamic amounts must use Vietnamese currency formatting.

- Technical logs may remain English.

- API error codes must remain English and stable.

# 13. Data State Changes

## 13.1 Apply Voucher

| Data Area | State Change |
|---|---|
| Cart | Voucher application result becomes associated with current cart |
| Cart totals | Recalculated with item-level promotions and final voucher discount |
| Voucher usage count | No change |
| Voucher usage log | No new record |
| Redis rate limit | May update failed-attempt counter only when validation fails |
| Audit data | Optional operational log, not redemption log |

---

## 13.2 Remove Voucher

| Data Area | State Change |
|---|---|
| Cart | Voucher association removed |
| Cart totals | Recalculated without voucher discount |
| Voucher usage count | No change |
| Voucher usage log | No new record |
| Redis | No redemption-related change |

---

## 13.3 Cart Update After Voucher Applied

| Data Area | State Change |
|---|---|
| Cart | Updated by Cart Module |
| Voucher state | Revalidated |
| Voucher discount | Recalculated or removed |
| Cart totals | Recalculated from source values |
| Voucher usage count | No change |
| Voucher usage log | No new record |
| Redis cache | Cart-dependent cache is invalidated or bypassed |

---

## 13.4 Successful Order Placement

| Data Area | State Change |
|---|---|
| Order | Successfully finalized |
| Voucher usage count | Atomically incremented |
| Voucher usage log | New immutable record created |
| Idempotency state | Records that the voucher/order redemption was processed |
| Audit trail | Completed |

---

# 14. Module Interaction Map

| Interaction | Direction | Purpose | Timing |
|---|---|---|---|
| Storefront → VoucherEngine | Request | Apply, remove, list voucher | Synchronous |
| VoucherEngine → Cart Module | Read / approved update | Read latest cart and attach/remove voucher result | Synchronous |
| VoucherEngine → Promotion Module | Read | Obtain item-level promotion outcomes | Synchronous |
| VoucherEngine → Pricing Module | Read | Obtain resolved price basis | Synchronous |
| VoucherEngine → Product Module | Read | Resolve product/category scope eligibility | Synchronous |
| VoucherEngine → Customer Module | Read | Validate per-user limit and segment eligibility | Synchronous |
| Cart Module → VoucherEngine | Event | Trigger revalidation after `cart.updated` | Asynchronous |
| Order Module → VoucherEngine | Event | Trigger usage count increment and usage log creation | Asynchronous |
| VoucherEngine → Redis | Read/write temporary state | Rate limit, cooldown, cache, and temporary coordination | Mixed |
| VoucherEngine → Persistence | Read/write durable state | Voucher configuration, usage count, usage log | Synchronous / transactional where required |

---

# 15. API Entry Point Overview



This section defines solution-level API responsibilities.

It does not define route files, handler functions, validators, or implementation details.



|API Concern|Intended Entry Point|Responsibility|Related Flow|
|---|---|---|---|
|Apply voucher|`POST /store/cart/voucher`|Apply, validate, calculate, attach voucher result to cart|7.1|
|Remove voucher|`DELETE /store/cart/voucher`|Remove active voucher and recalculate cart|7.3|
|List customer vouchers|`GET /store/customer/vouchers`|Return vouchers available to current customer|7.1 / 7.6|
|Create voucher|`POST /admin/vouchers`|Create voucher configuration|7.6|
|Voucher analytics|`GET /admin/vouchers/:id/analytics`|Show usage and discount statistics|7.6 / 7.5|

---

# 16. Redis Coordination and Cache Policy



## 16.1 Redis Responsibilities



Redis is used only for:



1. Voucher attempt rate limiting.

2. Short-lived voucher validation support where safe.

3. Atomic temporary coordination for usage-limit checks.

4. Optional short-lived voucher configuration cache.

5. Optional lock or version coordination for concurrent voucher/cart operations.

    

Redis is not the source of truth for:

- cart state;

- voucher configuration;

- final cart totals;

- voucher usage log;

- final redemption count.

    

## 16.2 Safe Cache Candidates



|Data|Can Cache?|Reason|
|---|---|---|
|Voucher configuration by normalized code|Yes, short TTL|Read-heavy and changes infrequently|
|Voucher active status|Yes, short TTL with invalidation on admin update|Derived from configuration|
|Customer failed-attempt counter|Yes|Temporary security state|
|Usage-limit coordination counter|Yes, only as atomic coordination|Must remain consistent with durable redemption state|
|Full voucher apply result|No by default|Depends on live cart, promotions, eligibility, and customer state|
|Cart totals|No|Cart is source of truth|
|Eligible item result|No by default|Changes whenever cart or product scope changes|
|Global discount cap config|Yes, short TTL|Low-change shared configuration|



## 16.3 Cache Invalidation Events



Redis entries must be invalidated or bypassed when:



- voucher configuration changes;

- voucher is activated or deactivated;

- voucher validity window changes;

- usage limit changes;

- global discount-cap configuration changes;

- cart changes;

- order is successfully placed using voucher;

- customer segment eligibility changes when supported.

    

## 16.4 Cache Key Intent



The technical specification must later define exact key names.



At solution level, the following key purposes are required:



|Key Purpose|Example Intent|
|---|---|
|Voucher config lookup|voucher configuration by normalized code|
|Voucher attempt counter|failed attempts per customer/session/IP window|
|Voucher cooldown|temporary blocked status after threshold|
|Usage coordination|atomic reservation/check around usage availability|
|Global cap config|active global discount policy|
|Optional concurrency lock|short-lived cart-voucher operation lock|



---

# 17. Technical Design Inputs for Future SPEC Generation



This section does not define source files, classes, methods, or implementation details.



It defines the technical design areas that the future `SPEC.md` must resolve before implementation begins.



## 17.1 Required Domain Contracts



The future SPEC must define business-level and technical-level contracts for:



- VoucherConfig;

- VoucherUsageLog;

- DiscountCapConfig;

- voucher state associated with Cart;

- voucher validation result;

- voucher eligibility result;

- voucher discount calculation result;

- discount-cap explanation result;

- voucher-attempt rate-limit state;

- redemption idempotency state.

    

## 17.2 Required API and DTO Contracts



The future SPEC must define request and response DTOs for:



- apply voucher request;

- apply voucher success response;

- apply voucher validation failure response;

- remove voucher response;

- voucher auto-removal notification payload;

- customer voucher-list response;

- admin voucher create request;

- admin voucher update request;

- voucher analytics response;

- discount-capped explanation response.

    

All customer-facing DTOs must support:



- stable English machine-readable code;

- Vietnamese default message;

- dynamic message parameters;

- severity;

- display hint;

- future i18n extension.

    

## 17.3 Required Orchestration Contracts



The future SPEC must define orchestration responsibilities for:



- apply new voucher;

- replace existing voucher;

- remove voucher;

- validate voucher;

- resolve eligible cart items;

- calculate voucher discount;

- enforce voucher-specific cap;

- enforce global discount cap;

- revalidate voucher after cart change;

- process voucher redemption after successful order;

- rate-limit voucher attempts;

- coordinate concurrent cart-voucher operations.

    

## 17.4 Required Workflow Skeleton Decisions



The future SPEC must decide:



- which operations require MedusaJS Workflow orchestration;

- which operations are read-only service operations;

- which workflow steps require compensation;

- what state must be rolled back on failure;

- what operations must be idempotent;

- where cart recalculation occurs;

- how workflow result is returned to Store API.

    

## 17.5 Required Subscriber Decisions



The future SPEC must define:



|Trigger|Subscriber Responsibility|
|---|---|
|`cart.updated`|Revalidate active voucher and recalculate/remove it|
|successful order event|Atomically record voucher redemption and create usage log|
|voucher configuration changed|Invalidate voucher-related Redis cache if enabled|
|discount-cap configuration changed|Invalidate global-cap cache if enabled|



## 17.6 Required Relationship and Link Decisions



The future SPEC must explicitly decide:



- how VoucherConfig is related to scoped products;

- how VoucherConfig is related to scoped categories;

- whether these relationships use MedusaJS Link Module;

- whether the relation is persisted, linked, or read-only;

- how the cart stores or references the active voucher result;

- how VoucherUsageLog references Customer and Order;

- how historical usage records remain valid after voucher configuration changes;

- whether product/category snapshots are required for audit.

    

## 17.7 Required Service Boundaries



The future SPEC must define service responsibilities without duplicating core Medusa ownership:



|Concern|Expected Owner|
|---|---|
|Voucher lookup and configuration|VoucherEngine|
|Voucher validation|VoucherEngine|
|Discount calculation decision|VoucherEngine|
|Cart state and cart totals|Cart Module / approved cart pricing flow|
|Item-level promotion result|Promotion Module|
|Price resolution|Pricing Module|
|Product/category data|Product Module|
|Stock state|Inventory Module when required|
|Order completion|Order Module|
|Rate limiting and temporary coordination|Redis integration layer|



## 17.8 Required Test-Design Inputs



The future SPEC must map each solution flow to:



- unit tests;

- integration tests;

- concurrency tests;

- event/subscriber tests;

- error-message tests;

- Redis failure/fallback tests;

- idempotency tests;

- verification commands.



---

# 18. Exception and Error Handling Contract



## 18.1 Purpose



VoucherEngine must distinguish business failures, concurrency failures, and infrastructure failures.



The system must never expose raw internal exceptions, stack traces, database errors, Redis errors, workflow details, or source-code details to customers.



## 18.2 Error Categories



|Category|Examples|Customer-Facing Behavior|Internal Behavior|
|---|---|---|---|
|Business Validation Error|Voucher expired, minimum order not met, no eligible items|Return Vietnamese business message and stable error code|No retry, no rollback needed because cart remains unchanged|
|Business Calculation Error|Invalid discount state, negative calculated voucher amount|Return safe Vietnamese failure message|Log calculation context; prevent partial cart update|
|Concurrency Error|Cart changed while voucher calculation is running|Refresh/recalculate or ask client to retry|Reload latest cart and rerun validation/calculation|
|Idempotency Error|Same order event received twice|Do not show customer error|Ignore duplicate safely and log idempotency outcome|
|Rate-Limit Error|Too many failed voucher-code attempts|Return Vietnamese cooldown message|Update/inspect Redis cooldown state|
|Infrastructure Error|Redis timeout, database failure, event failure|Return safe generic Vietnamese error|Log technical details, apply retry/compensation policy|
|Authorization Error|Unauthorized admin voucher action|Return localized authorization error|Audit security event where required|



## 18.3 Customer Response Rules



Every customer-facing error response must include:



|Field|Purpose|
|---|---|
|`code`|Stable machine-readable error code|
|`message_vi`|Vietnamese customer-facing message|
|`message_params`|Dynamic details such as amount, date, code|
|`severity`|`info`, `warning`, `error`|
|`display_hint`|`inline`, `toast`, `cart_summary`, `refresh_required`|
|`retryable`|Indicates whether client may safely retry|



The system must not return:



- raw exception text;

- database constraint names;

- Redis connection errors;

- stack traces;

- workflow internals;

- internal entity IDs unless explicitly safe and required.

    

## 18.4 Rollback and Partial-Failure Rules



1. If voucher validation fails:

    - cart remains unchanged;

    - no voucher state is attached;

    - no usage count changes;

    - no usage log is created.

        

2. If discount calculation fails:

    - cart remains unchanged;

    - no partial discount result may remain.

        

3. If replacement voucher fails:

    - previous valid voucher remains active.

        

4. If cart changes during voucher calculation:

    - outdated result is discarded;

    - latest cart is revalidated.

        

5. If voucher usage recording fails after order success:

    - do not duplicate order processing;

    - preserve enough audit information for recovery;

    - retry behavior must be idempotent;

    - recovery strategy must be defined in the future SPEC.

        

6. If Redis is unavailable:

    - the future SPEC must define approved fallback behavior separately for:

        - rate limiting;

        - voucher configuration cache;

        - concurrency coordination;

        - redemption coordination.

            

## 18.5 Retry Policy



|Failure Type|Retry Allowed?|Required Behavior|
|---|---|---|
|Business validation failure|No automatic retry|Return business response|
|Cart version conflict|Yes|Reload latest cart and re-evaluate|
|Duplicate order event|No business retry needed|Idempotently ignore|
|Temporary Redis failure|Conditional|Follow approved fallback policy|
|Database transaction conflict|Conditional|Retry safely if operation is idempotent|
|Unknown infrastructure failure|No blind retry|Log and return safe failure response|



## 18.6 Logging and Audit Requirements



Technical logs must contain enough context for debugging:



- correlation/request ID;

- cart ID where applicable;

- voucher ID/code where safe;

- customer ID where available;

- order ID where applicable;

- error category;

- failure stage;

- retry count;

- Redis or persistence failure details;

- final decision: rejected, recalculated, removed, redeemed, or failed.

    

Customer-facing logs and messages must not expose sensitive technical details.



## 18.7 Future SPEC Requirements



The future SPEC must define:



- concrete domain exception names or error classes;

- HTTP status mapping;

- error-code constants;

- error-response DTO;

- workflow compensation behavior;

- retry boundaries;

- idempotency keys or equivalent;

- Redis failure fallback;

- logging implementation and monitoring hooks.



---

# 19. Diagram Specifications

> Generate these diagrams with the approved effective-diagram plugin.
> The diagrams must remain solution-level and must not include file names, classes, or implementation-specific method names.
> 
> 

---

The actual diagram sources are stored in: 

- `diagrams/d01-voucher-module-interaction.md`

- `diagrams/d02-apply-voucher-sequence.md`

- `diagrams/d03-voucher-validation-flow.md`

- `diagrams/d04-discount-resolution-flow.md`

- `diagrams/d05-cart-change-revalidation-sequence.md`

- `diagrams/d06-voucher-usage-recording-sequence.md`

- `diagrams/d07-conceptual-voucher-domain-relationship.md`

These diagrams are part of the approved solution-flow contract. Claude Code must read them before generating `SPEC.md`.



## D-01. VoucherEngine Module Interaction Diagram

### Goal

Show how VoucherEngine interacts with Cart, Promotion, Pricing, Product, Customer, Order, Redis, and persistent storage.

### Must Show

- VoucherEngine at the center. 

- Synchronous reads from Cart, Promotion, Pricing, Product, and Customer. 

- `cart.updated` event flowing from Cart to VoucherEngine. 

- order-success event flowing from Order to VoucherEngine. 

- Redis as temporary cache/rate-limit/coordination infrastructure. 

- PostgreSQL / durable persistence for voucher configuration and usage logs. 

- Cart as authoritative holder of cart state and totals. 

### Interpretation

VoucherEngine coordinates voucher behavior but does not take ownership of core commerce data.

---

## D-02. Apply Voucher Sequence Diagram

### Goal

Show the end-to-end flow from voucher submission to updated cart response.

### Actors

- Customer 

- Storefront 

- VoucherEngine 

- Cart Module 

- Promotion Module 

- Pricing Module 

- Product Module 

- Customer Module 

- Redis 

- Persistent Storage 

### Must Show

1. Customer submits code. 

2. Code normalization. 

3. Latest cart retrieval. 

4. Voucher lookup. 

5. Validation V1–V8. 

6. Eligible item resolution. 

7. Promotion result lookup. 

8. Voucher calculation. 

9. Global-cap check. 

10. Cart update/recalculation. 

11. Updated cart response. 

12. Failure path where cart remains unchanged. 

### Interpretation

Voucher application is only finalized after validation and discount calculation succeed.

---

## D-03. Voucher Validation Decision Flowchart

### Goal

Show fail-fast validation from V1 to V8.

### Must Show

```Plain Text
Code exists and active?
  ↓
Date valid?
  ↓
Global usage available?
  ↓
Per-user usage available?
  ↓
Minimum order met?
  ↓
Eligible item exists?
  ↓
Customer segment eligible?
  ↓
No stacking conflict?
  ↓
Continue to discount calculation
```

Each failed decision must lead to one specific error result.

### Interpretation

The system returns one clear failure reason and does not continue to later validation checks.

---

## D-04. Discount Resolution Flowchart

### Goal

Show exact discount calculation order.

### Must Show

```Plain Text
Original Cart Subtotal
  ↓
Apply Item-Level Promotions
  ↓
Resolve Voucher-Eligible Items
  ↓
Calculate Raw Voucher Discount
  ↓
Apply Voucher Maximum Discount Amount
  ↓
Calculate Combined Discount
  ↓
Check Global Discount Cap
  ├─ Under Cap → Keep Voucher Discount
  └─ Over Cap → Reduce Voucher Discount Only
  ↓
Recalculate Final Cart Total
  ↓
Return Cart + Voucher Result
```

### Interpretation

Item-level promotions are protected. The global cap can reduce only the voucher discount.

---

## D-05. Cart Change Revalidation Sequence Diagram

### Goal

Show how a cart update can recalculate or remove an active voucher.

### Must Show

1. Customer changes cart. 

2. Cart Module updates cart. 

3. Cart Module emits `cart.updated`. 

4. VoucherEngine checks active voucher. 

5. VoucherEngine reloads latest cart and voucher. 

6. VoucherEngine revalidates. 

7. Branch: 

    - valid → recalculate discount; 

    - invalid → remove voucher. 

8. Updated cart result is made available to storefront. 

### Interpretation

Voucher eligibility is dynamic and always depends on current cart state.

---

## D-06. Voucher Usage Recording Sequence Diagram

### Goal

Show usage recording only after order success.

### Must Show

1. Order successfully placed. 

2. Order-success event emitted. 

3. VoucherEngine consumes event. 

4. Idempotency check. 

5. Atomic usage increment. 

6. Immutable usage-log creation. 

7. Audit completion. 

### Interpretation

Voucher application to cart is not redemption. Successful order placement is redemption.

---

## D-07. Conceptual Voucher Domain Relationship Diagram

### Goal

Show business relationships, not database implementation.

### Must Show

- VoucherConfig 

- VoucherUsageLog 

- DiscountCapConfig 

- Cart 

- Customer 

- Order 

- Product 

- Category 

### Relationship Meaning

| Relationship | Meaning |
|---|---|
| VoucherConfig → VoucherUsageLog | A voucher can have many redemption records |
| VoucherUsageLog → Customer | A redemption belongs to one customer |
| VoucherUsageLog → Order | A redemption belongs to one successful order |
| VoucherConfig → Product / Category | A voucher may be scoped to products or categories |
| Cart → VoucherConfig | A cart can have zero or one active voucher |
| DiscountCapConfig → Voucher calculation | Global policy limits combined discounts |
| VoucherUsageLog → Discount snapshot | Historical audit should preserve actual applied discount result |

---

# 20. Impact Analysis

| Area | Impact Level | Why It Is Affected |
|---|---|---|
| Cart pricing | High | Voucher changes final cart total |
| Checkout response | High | Must return voucher result, cap status, and Vietnamese messages |
| Promotion integration | High | Voucher is calculated after item-level promotions |
| Cart update behavior | High | Voucher must be revalidated after cart changes |
| Order completion | High | Usage count and usage log occur after successful order |
| Data integrity | High | Usage count, audit log, and totals require consistency |
| Redis | Medium | Needed for rate limit, cache, and temporary coordination |
| Product/category scope | Medium | Required for scoped voucher eligibility |
| Customer eligibility | Medium | Required for per-user limit and segment rules |
| Admin voucher management | Medium | Voucher configuration changes may require cache invalidation and revalidation policy |
| Suggestive Selling | Indirect | Suggested items can change voucher eligibility and cart totals |
| Storefront | Medium | Must display success, failure, cap, auto-removal, and refresh-required messages |

---

# 21. Risks and Pending Decisions

|ID|Risk / Unknown|Why It Matters|Proposed Direction|Blocks SPEC?|Blocks Implementation?|Status|
|---|---|---|---|---|---|---|
|PD-01|Exact method to associate voucher state with Cart in this MedusaJS project|Determines where applied voucher state is stored and how cart total recalculation works|Inspect current MedusaJS cart extension pattern before defining implementation|Yes|Yes|Need Repository Inspection|
|PD-02|Exact source of item-level promotion result|Voucher discount must be calculated after reliable post-promotion values|Confirm Promotion/Pricing integration contract from current source|Yes|Yes|Need Repository Inspection|
|PD-03|Exact order-success event name and payload|Controls when usage count and VoucherUsageLog are created|Verify installed MedusaJS order event contract|Yes|Yes|Need Repository Inspection|
|PD-04|Cart concurrency mechanism|Prevents stale cart state when voucher apply and cart update happen together|Define optimistic locking, transaction, or Redis lock + version-check strategy|Yes|Yes|Pending Technical Decision|
|PD-05|Atomic usage-count strategy|Required to prevent over-redemption under concurrent orders|Confirm DB conditional update / transaction / Redis coordination strategy|Yes|Yes|Pending Technical Decision|
|PD-06|Customer segment source|Required only for V7 segment validation|If no approved source exists, mark segment validation as conditional/deferred|No|No, if deferred|Pending - Can Defer|
|PD-07|Customer purchase-history source|Not core VoucherEngine, but may affect shared customer/order query pattern|Confirm only if needed by Suggestive Selling or segment-related voucher rules|No|No|Pending - Can Defer|
|PD-08|Existing active voucher after admin deactivation|Determines whether applied vouchers are removed immediately or on next cart update|Define invalidation policy: immediate, next cart update, or checkout-time revalidation|No|Yes, for admin deactivation behavior|Pending Business Decision|
|PD-09|Real-time storefront update after subscriber processing|Affects how customer sees recalculated or removed voucher after async processing|Use refetch/polling for MVP; push can be future enhancement|No|No|Pending - Can Defer|
|PD-10|Promotion tier changes after cart mutation|Can alter voucher calculation unexpectedly|Always recalculate promotions before voucher calculation|No|No|Covered by Solution Flow|
|PD-11|Redis unavailable during voucher attempt protection|Rate limit, cache, and coordination may behave differently when Redis fails|Define fail-open/fail-closed policy per Redis use case|Yes|Yes|Pending Technical Decision|
|PD-12|Voucher validation cache scope|SRS mentions short-lived validation cache, but cart-dependent validation can become stale|Cache only safe config/static validation unless cart version is included|Yes|Yes|Pending Technical Decision|
|PD-13|Product/category scoping relationship|Voucher can apply to categories/products, but relationship strategy affects Link Module and query design|Decide whether to use Link Module, stored IDs, or read-only references|Yes|Yes|Need Repository Inspection|
|PD-14|Error/exception mapping to HTTP response|Prevents raw errors and inconsistent API responses|SPEC must define domain errors, HTTP status, Vietnamese message contract|Yes|Yes|Pending Technical Decision|

# 22. Test Scenario Intent

> This section does not prescribe test files or testing framework.
> It defines what future implementation tests must prove.

---

## 22.1 Apply Voucher Scenarios

| Scenario | Expected Result |
|---|---|
| Valid percentage voucher for full cart | Cart total is reduced correctly |
| Valid percentage voucher scoped to category | Only eligible post-promotion items are discounted |
| Valid fixed-amount voucher | Discount does not exceed eligible subtotal |
| Voucher has maximum discount amount | Voucher discount is capped by voucher rule |
| Invalid voucher code | Cart remains unchanged |
| Expired voucher | Cart remains unchanged |
| Voucher not active yet | Cart remains unchanged |
| Global usage limit exhausted | Cart remains unchanged |
| Per-user usage limit exhausted | Cart remains unchanged |
| Cart below minimum order | Remaining amount is returned |
| Cart has no eligible item | Scope-specific error is returned |
| Segment condition fails | Customer receives eligibility error |
| Stacking conflict exists | Cart remains unchanged |
| Existing voucher replaced by valid voucher | Old voucher remains until new voucher succeeds |
| Existing voucher replacement fails | Previous valid voucher remains active |

---

## 22.2 Discount Calculation Scenarios

| Scenario | Expected Result |
|---|---|
| Item promotion + voucher remain below global cap | Both discounts apply |
| Item promotion + voucher exceed global cap | Voucher is reduced only |
| Voucher discount exceeds voucher-level max amount | Voucher-level cap applies first |
| Item promotion already uses entire global cap | Final voucher discount is zero |
| Fixed voucher exceeds eligible subtotal | Discount does not exceed eligible value |
| Combined discounts could make cart total zero or negative | System enforces minimum valid total policy |
| Percentage calculation creates decimal amount | Integer arithmetic produces deterministic result |

---

## 22.3 Cart Change Scenarios

| Scenario | Expected Result |
|---|---|
| Customer removes item but cart remains eligible | Voucher remains and discount recalculates |
| Customer drops below minimum order | Voucher auto-removes |
| Customer removes all eligible items | Voucher auto-removes |
| Customer adds eligible item | Voucher recalculates |
| New item promotion tier becomes active | Promotion recalculates before voucher |
| Suggested product is added | Voucher eligibility recalculates from latest cart |
| Cart changes during voucher apply | Final result uses latest cart state |

---

## 22.4 Usage Recording Scenarios

| Scenario | Expected Result |
|---|---|
| Voucher applied then removed | Usage count remains unchanged |
| Voucher applied but payment/order fails | Usage count remains unchanged |
| Successful order using voucher | Usage count increments once |
| Successful order using voucher | One usage log is created |
| Order event delivered twice | No duplicate usage increment or usage log |
| Concurrent successful redemptions near usage limit | Usage limit remains consistent |

---

## 22.5 Security and Performance Scenarios

| Scenario | Expected Result |
|---|---|
| Repeated invalid voucher attempts | Rate limit activates after configured threshold |
| Frontend tampers with discount amount | Server recalculates authoritative total |
| Redis unavailable for rate limit | Approved fallback behavior is followed |
| Voucher configuration cache is stale | Cache is invalidated or bypassed according to policy |
| Voucher validation under normal load | Meets performance target |
| Cart revalidation after change | Meets recalculation target |
| Raw technical exception occurs | Customer receives safe Vietnamese message only |

---

# 23. Requirement-to-Flow Coverage

| Requirement Area | Solution Flow | Diagram | Test Intent |
|---|---|---|---|
| Apply voucher | 7.1 Apply New Voucher | D-02 | 22.1 Apply Voucher Scenarios |
| Replace active voucher | 7.2 Replace Existing Voucher | D-02 | 22.1 replacement scenarios |
| Voucher validation | 8. Voucher Validation Flow | D-03 | 22.1 validation failures |
| Discount stacking | 9. Discount Resolution Flow | D-04 | 22.2 Discount Calculation Scenarios |
| Voucher removal | 7.3 Remove Voucher | D-02 | 22.1 removal/usage scenarios |
| Cart-change revalidation | 7.4 Revalidate Voucher After Cart Change | D-05 | 22.3 Cart Change Scenarios |
| Order-success redemption | 7.5 Record Voucher Usage After Successful Order Placement | D-06 | 22.4 Usage Recording Scenarios |
| Admin voucher configuration | 7.6 Admin Voucher Management | D-01 / D-07 | Admin configuration validation |
| Concurrent cart-voucher operations | 7.7 Concurrent Cart and Voucher Operations | D-05 | 22.3 concurrency scenario |
| Brute-force protection | 7.8 Voucher Attempt Protection | D-03 | 22.5 Security Scenarios |
| Data integrity | 9. Discount Resolution + 13. Data State Changes | D-04 / D-07 | 22.2 / 22.4 |

---

# 24. Definition of Ready for SPEC Generation

Claude Code may generate a developer-level `SPEC.md` when all solution-level items below are approved.

Blocking technical decisions may remain unresolved only if they are explicitly marked for repository inspection or `BLOCKED: Pending Decision` handling in the generated SPEC.

| Condition | Required |
|---|---|
| Voucher scope is approved | Yes |
| Apply, replace, remove flows are approved | Yes |
| Validation order V1–V8 is approved | Yes |
| Discount calculation order is approved | Yes |
| Global discount-cap behavior is approved | Yes |
| Cart-change revalidation flow is approved | Yes |
| Order-success usage-recording flow is approved | Yes |
| Concurrent cart-voucher operation behavior is approved | Yes |
| Voucher attempt protection behavior is approved | Yes |
| Redis policy is approved | Yes |
| Vietnamese messaging policy is approved | Yes |
| Exception contract is approved | Yes |
| Diagram files are available and linked | Yes |
| Impact analysis is reviewed | Yes |
| Blocking pending decisions are marked for repository inspection | Yes |
| Test scenario intent is approved | Yes |

---

# 25. AI Specification-Generation Contract

The first generated SPEC.md must be a planning artifact only.

- It must not create or modify source code.

- If a section requires repository inspection, Claude must inspect the source and record repository evidence before proposing implementation files.

- If repository evidence conflicts with this solution document, Claude must stop and report the conflict instead of silently changing the solution.



When generating a future developer-level specification from this document, Claude Code must:

1. Treat this document as the approved solution-flow source of truth. 

2. Translate every approved solution flow into a code-level implementation flow. 

3. Generate a `SPEC.md` that defines: 

    - implementation entry points; 

    - files to create or modify; 

    - module/service/workflow responsibilities; 

    - data persistence changes; 

    - validation sequence; 

    - error handling; 

    - event subscribers; 

    - Redis usage; 

    - cart/promotion/pricing/order impacts; 

    - concurrency and idempotency handling; 

    - test implementation plan; 

    - verification commands; 

    - implementation order. 

4. Copy the rules from **Section 10. Business Rules to Preserve** into a `Non-Negotiable Rules` section without reinterpretation. 

5. Mark unresolved technical details as: 

```Plain Text
BLOCKED: Pending Decision
```

6. Never invent business behavior that is not defined in this document or formally approved later. 

7. Never begin implementation until the generated `SPEC.md` has been manually reviewed and approved by a developer. 

---

# 26. Next Step

After manual review and approval of this document:

```Plain Text
VoucherEngine Solution Flow Document
  ↓
Generate VoucherEngine SPEC.md
  ↓
Developer Manual Review
  ↓
Approve SPEC.md
  ↓
Implement Code
  ↓
Run Tests and Capture Evidence
  ↓
Create VoucherEngine Lessons Learned
```

