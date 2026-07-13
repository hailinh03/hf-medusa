# VoucherEngine — Developer Implementation Specification

> **Status:** Planning artifact. **Do not implement until manually reviewed and approved.**
> **Feature:** Voucher at Checkout (`voucher-engine` module)
> **Platform:** MedusaJS **2.16.0** (verified — `apps/backend/package.json`)
> **Repository:** `hf-medusa-store` (pnpm + Turborepo monorepo; backend = `@dtc/backend`)
>
> **Source-of-truth inputs (all read):**
>
> - Solution Flow: `docs/voucher-engine/voucher-engine.solution-flow.completed.md` (V2, approved)
> - Diagrams: `docs/voucher-engine/diagrams/d01..d07`
> - SRS: `docs/SRS_SuggestiveSelling_Voucher_v1.0.md` (v1.0)
> - Project rules: `CLAUDE.md`, `.claude/rules/project-conventions.md`
> - Medusa backend patterns: `medusa-dev` plugin skill `building-with-medusa`
>
> **Legend used throughout this document:**
>
> - `[NEEDS_VERIFICATION]` — a MedusaJS API, event, payload, or integration mechanism that this spec references but that was **not** confirmed against installed source in this repo. Must be verified against `node_modules/@medusajs/*` or MedusaDocs MCP before the referenced code is written.
> - `BLOCKED: Pending Decision` — an unresolved decision that blocks implementation of the affected slice. Implementation of that slice must not start until the decision is signed off.
> - `[CONFLICT]` — the SRS or Solution Flow disagrees with the actual codebase / Medusa v2 capabilities. Recorded, not silently changed. See §18.
>
> **Verification method for this revision pass (2026-07-13):**
>
> - **Reachable and verified** — repository source under `apps/backend/src/**` and `apps/backend/package.json`, inspected with the built-in `Read` tool (exact paths). Every fact tagged _"verified (repo)"_ below cites the file read in this pass.
> - **Reachability of installed `@medusajs/*` (updated by pass 2 below).** `Grep`/`Glob` remain disabled and policy forbids Bash search, but the **two direct-dependency packages `@medusajs/medusa` and `@medusajs/framework` are top-level symlinks and their `dist/**`is readable by exact-path`Read`** — pass 2 used this to verify the cart/order/promotion mechanisms from shipped API route code. Only the **transitive** packages (`@medusajs/cart|order|promotion|core-flows|utils|types`) sit behind version-hashed `.pnpm/`paths that can't be located without`Glob`/`find`; facts that live only there remain `[NEEDS_VERIFICATION]`. See §19.2 for the exact package each residual item must be checked against.
> - Where a _strategy_ can be finalized from the approved Solution Flow + SRS without touching framework internals (concurrency approach, redemption atomicity approach, Redis policy, validation split, sync-vs-subscriber revalidation), this pass **resolves the decision** and isolates the remaining framework detail as a scoped `[NEEDS_VERIFICATION]` so the surrounding slice is no longer wholesale-blocked.
>
> **Verification pass 2 (2026-07-13) — installed Medusa source now partially reachable.** `Grep`/`Glob` are still disabled, but `node_modules` **is installed** and the two direct-dependency packages `@medusajs/medusa` and `@medusajs/framework` are top-level symlinks, so their compiled `dist/**` files are readable by exact-path `Read`. This unblocked the three cart/order/promotion gaps (§14.2, §10.7, §13) via the **shipped store/admin API route handlers and query-configs** inside `@medusajs/medusa/dist/api/**`, which are authoritative. Files inspected this pass (all under `apps/backend/node_modules/@medusajs/`):
>
> | File                                                   | What it verified                                                                                                                                                                                                                                       |
> | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | --------- | ---------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | `medusa/package.json`, `framework/package.json`        | 2.16.0; core modules (`@medusajs/cart                                                                                                                                                                                                                  | order | promotion | core-flows | types | utils`) are **transitive** deps of `@medusajs/medusa`(present only behind pnpm peer-hashed`.pnpm/`dirs → **not enumerable without`Glob`/`find`**). `framework/utils`&`framework/types`re-export`@medusajs/utils`/`@medusajs/types`. |
> | `medusa/dist/api/store/carts/[id]/complete/route.js`   | Cart completion runs `completeCartWorkflowId`; returns an **order** via `query.graph({entity:"order", filters:{id: result.id}})` (⇒ `result.id` = order id); native completion concurrency guard `transaction.hasFinished()` → `MedusaError.CONFLICT`. |
> | `medusa/dist/api/store/carts/[id]/promotions/route.js` | Discounts enter the cart via `updateCartPromotionsWorkflowId` + `PromotionActions.ADD/REMOVE/REPLACE` (`promo_codes`).                                                                                                                                 |
> | `medusa/dist/api/store/carts/[id]/line-items/route.js` | `addToCartWorkflowId`; cart mutations are workflows (revalidation trigger surface).                                                                                                                                                                    |
> | `medusa/dist/api/store/carts/query-config.js`          | Authoritative cart fields: computed totals + `promotions.*` + `items.adjustments.{amount,promotion_id,code}` + `items.product_id`/`items.product.categories.id` (§10.7).                                                                               |
> | `medusa/dist/api/store/orders/query-config.js`         | Order carries same computed totals + `*items.adjustments` + `metadata` (⇒ cart adjustments propagate to order).                                                                                                                                        |
> | `medusa/dist/api/admin/promotions/query-config.js`     | Promotion fields: `code, type, is_automatic, limit, used, status, application_method.{target_rules,buy_rules}, rules.{attribute,operator,values}, campaign.budget`.                                                                                    |
> | `medusa/dist/api/store/carts/helpers.js`               | `refetchCart` via REMOTE_QUERY entryPoint `"cart"`.                                                                                                                                                                                                    |
> | `medusa/package.json` deps                             | **`@medusajs/locking`, `@medusajs/locking-postgres`, `@medusajs/locking-redis`** present ⇒ first-class **Locking Module** (`Modules.LOCKING`) available for concurrency.                                                                               |
>
> Still **not reachable** (in transitive `@medusajs/utils`/`@medusajs/core-flows`/cart-order-promotion module internals): the exact successful-order **event id string**, whether `completeCartWorkflow` exposes a **hook**, the `createPromotions`/`addPromotionsToCart` workflow **input signatures**, and the precise discount-inclusion **semantics** of `item_subtotal` vs `item_discount_total`. These are now narrowly scoped `[NEEDS_VERIFICATION]` (§19.2), not whole-slice blockers.

---

## 0. Table of Contents

1. Scope & Goal
2. Non-Negotiable Rules (copied verbatim from Solution Flow §10)
3. Architecture & Conventions (verified from codebase)
4. Module Layout — files to create / modify
5. Data Models
6. Links (Link Module)
7. Service Layer
8. DTOs, Validators & Error Contract
9. Validation Pipeline (V1 → V8) — 3 contexts: apply / cart-change revalidation / redemption
10. Discount Resolution (calculation contract + worked examples)
11. Workflows & Steps (incl. §11.5 sync-vs-subscriber, §11.6–11.9 admin workflows, §11.10 step contracts)
12. API Routes
13. Subscribers & Events
14. Redis Usage, Rate Limiting, Idempotency, Concurrency
15. Migrations
16. Test Plan
17. SRS Traceability Matrix (+ §17.1 reverse test-ID map)
18. Conflicts (SRS/Solution Flow vs codebase)
19. Pending Decisions register (PD-01 … PD-14) + `[NEEDS_VERIFICATION]` index
20. Implementation Order
21. Verification Commands
22. Implementation Readiness (Ready / Ready-after-verification / Blocked) + §22.1 SRS Compliance Summary
23. Code-Level Implementation Blueprint — Focus Tasks (money, discount calc, cart-context, verify-totals, store route)

---

## 1. Scope & Goal

VoucherEngine lets a customer apply **exactly one** voucher at checkout and receive an accurate discount computed from voucher eligibility, item-level promotions, cart content, and a global discount cap. It owns voucher configuration, validation, discount decision, cap enforcement, redemption audit, and brute-force protection. It **reads** cart/promotion/pricing/product/customer state from core modules and **must not** own or redefine them (Solution Flow §4).

**In scope (this module):** code normalization; lookup; V1–V8 validation; apply / replace / remove; scope-by-product/category; min-order; global + per-user usage limits; segment check (conditional — see PD-06); percentage & fixed-amount calculation; voucher max-discount; item-promotion + voucher stacking; global cap; cart-change revalidation; usage recording after successful order; audit logging; brute-force protection; admin config APIs. (Solution Flow §2.2)

**Out of scope:** payment, loyalty, CRM UI, segment source implementation, recommendation logic, multi-voucher stacking, voucher sharing, catalog management, promotion-engine redesign, storefront UI. (Solution Flow §2.3; SRS §1.2)

---

## 2. Non-Negotiable Rules

> Copied verbatim from Solution Flow **§10. Business Rules to Preserve**. Do not reinterpret. Each maps to sections of this spec.

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

## 3. Architecture & Conventions (verified from codebase)

All facts below are **verified** against the repository unless marked otherwise.

| Concern             | Verified fact                                                                                                                                                                      | Evidence                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Medusa version      | 2.16.0 across all `@medusajs/*` deps                                                                                                                                               | `apps/backend/package.json`                                                                    |
| Workspace root      | inner `hf-medusa-store/`; run all pnpm/turbo there                                                                                                                                 | `CLAUDE.md`, `.claude/rules`                                                                   |
| Module scope        | packages are `@dtc/*`                                                                                                                                                              | `.claude/rules`                                                                                |
| Module pattern      | `index.ts` exports `<NAME>_MODULE` const + `Module(...)`; `service.ts` extends `MedusaService({...models})`; one model per file under `models/`                                    | `src/modules/suggestive-selling/*`                                                             |
| Module name string  | **camelCase** — dashes cause runtime errors                                                                                                                                        | skill `type-module-name-camelcase`; existing `SUGGESTIVE_SELLING_MODULE = 'suggestiveSelling'` |
| Cross-module refs   | store id as `model.text()`, wire via **Link Module** `defineLink(... { readOnly: true })`; no DB FKs                                                                               | `src/links/suggestion-rule-item-product.ts`; `.claude/rules`                                   |
| Module registration | add `{ resolve: './src/modules/<name>' }` to `medusa-config.ts` `modules[]`                                                                                                        | `medusa-config.ts`                                                                             |
| Redis               | **optional** — cache/event-bus/workflow-engine load only when `REDIS_URL` set; in-memory fallback otherwise                                                                        | `medusa-config.ts`                                                                             |
| Mutations           | **must** go through Workflows; routes never call module services to mutate                                                                                                         | skill `arch-workflow-required`                                                                 |
| HTTP methods        | skill mandates **GET / POST / DELETE only** (no PUT/PATCH). NB: existing `suggestion-rules/[id]` uses PUT — a repo divergence (see §18 [CONFLICT-4])                               | skill `arch-http-methods`; `src/api/admin/suggestion-rules/[id]/route.ts`                      |
| Validation          | `validateAndTransformBody(zodSchema)` in `api/middlewares.ts`; typed via `MedusaRequest<T>` and `req.validatedBody`                                                                | `src/api/middlewares.ts`, validators                                                           |
| Errors              | throw `MedusaError` with `MedusaError.Types.*` → auto HTTP mapping                                                                                                                 | skill `reference/error-handling.md`                                                            |
| Cross-module reads  | `query.graph({ entity, fields, filters })`; `query.index()` when filtering by linked-module fields                                                                                 | skill `data-query-*`                                                                           |
| Money               | prices stored as-is (NOT cents). VND has no minor unit → 1 = 1 VND; all integer arithmetic                                                                                         | skill `data-price-format`; SRS INT-01                                                          |
| Tests               | Jest; `TEST_TYPE` selects suite. unit=`src/**/__tests__/**/*.unit.spec.ts`; module int=`src/modules/*/__tests__/**`; http int=`integration-tests/http/*.spec.ts`                   | `jest.config.js`, `package.json`                                                               |
| Test setup file     | `jest.config.js` references `./integration-tests/setup.js` — **this file and the `integration-tests/` dir do NOT exist yet** and must be created for HTTP integration tests to run | `find` returned nothing; `jest.config.js` `setupFiles`                                         |
| Migrations          | generated (not hand-written) with the module's `db:generate`; migrations live in `src/modules/<name>/migrations/`                                                                  | `src/modules/suggestive-selling/migrations/*`; skill `db-generate`                             |

---

## 4. Module Layout — files to create / modify

Folder name **`voucher-engine`** (kebab dir, per repo convention); module string **`voucherEngine`** (camelCase).

### 4.1 New files

```
apps/backend/src/modules/voucher-engine/
  index.ts                                  # export VOUCHER_ENGINE_MODULE='voucherEngine' + Module(...)
  service.ts                                # VoucherEngineService extends MedusaService({...})
  models/
    voucher-config.ts                       # VoucherConfig
    voucher-usage-log.ts                    # VoucherUsageLog (append-only)
    discount-cap-config.ts                  # DiscountCapConfig (singleton)
    voucher-scope.ts                         # VoucherScope (product/category scope rows)  [see §5.4 / PD-13]
  migrations/                               # generated by db:generate (do NOT hand-write)

apps/backend/src/modules/voucher-engine/
  lib/
    money.ts                                # integer-only helpers (INT-01)
    calculate-discount.ts                   # pure discount-resolution fn (§10) — unit-testable, no I/O
    normalize-code.ts                       # trim + uppercase (Rule 2)
    errors.ts                               # VoucherError codes + message_vi catalogue (§8)
    rate-limit.ts                           # Redis rate-limit/cooldown adapter (§14)
    __tests__/
      calculate-discount.unit.spec.ts
      normalize-code.unit.spec.ts
      money.unit.spec.ts

apps/backend/src/workflows/voucher/
  steps/
    normalize-code.ts
    lookup-voucher.ts
    validate-voucher.ts                     # V1–V8 orchestration (fail-fast)
    resolve-eligible-items.ts
    calculate-voucher-discount.ts
    enforce-global-cap.ts
    verify-cart-unchanged.ts                # concurrency marker check (§14)
    attach-voucher-to-cart.ts               # + compensation (re-derive, not stale restore)
    remove-voucher-from-cart.ts             # + compensation
    atomic-increment.ts                     # conditional usage_count++ (§14.3)
    create-usage-log.ts                     # append-only snapshot insert (§5.2)
    validate-voucher-config.ts              # admin create/update validation
    create-voucher-config.ts / create-voucher-scopes.ts
    apply-voucher-update.ts / deactivate-voucher.ts
    validate-cap.ts / upsert-active-cap.ts
    invalidate-cache.ts                     # cache invalidation (§14.4)
  apply-voucher.ts                          # applyVoucherWorkflow (§11.1)
  remove-voucher.ts                         # removeVoucherWorkflow (§11.2)
  revalidate-voucher-on-cart-change.ts      # revalidateVoucherWorkflow (§11.3)
  record-voucher-usage.ts                   # recordVoucherUsageWorkflow (§11.4)
  create-voucher.ts                         # createVoucherWorkflow (§11.6)
  update-voucher.ts                         # updateVoucherWorkflow (§11.7)
  deactivate-voucher.ts                     # deactivateVoucherWorkflow (§11.8)
  update-discount-cap.ts                    # updateDiscountCapConfigWorkflow (§11.9)

apps/backend/src/api/store/cart/voucher/
  route.ts                                  # POST (apply) + DELETE (remove)
  validators.ts                             # ApplyVoucherSchema (zod v4)
apps/backend/src/api/store/customer/vouchers/
  route.ts                                  # GET list customer vouchers
apps/backend/src/api/admin/vouchers/
  route.ts                                  # POST create, GET list
  validators.ts                             # CreateVoucherSchema + UpdateVoucherSchema
  [id]/
    route.ts                                # GET one, POST (update), DELETE (deactivate)  [§12 / CONFLICT-4]
    analytics/route.ts                      # GET analytics
apps/backend/src/api/admin/discount-cap/
  route.ts                                  # GET active cap, POST update cap (§11.9)
  validators.ts                             # UpdateDiscountCapSchema

apps/backend/src/subscribers/
  voucher-cart-updated.ts                   # cart.updated → revalidate (external mutations, §13.1)
  voucher-order-placed.ts                   # order.placed → record usage (§13.2)
  # NOTE: no cache-invalidation subscriber — invalidation is inlined into admin workflows (§14.4)

apps/backend/src/links/
  voucher-config-product.ts                 # VoucherScope(product) → Product (readOnly)  [PD-13]
  voucher-config-category.ts                # VoucherScope(category) → ProductCategory (readOnly)  [PD-13]

apps/backend/src/scripts/
  seed-vouchers.ts                          # idempotent seed (default DiscountCapConfig + sample vouchers)

apps/backend/integration-tests/
  setup.js                                  # referenced by jest.config.js but MISSING — create it
  http/
    apply-voucher.spec.ts
    remove-voucher.spec.ts
    admin-vouchers.spec.ts
```

### 4.2 Modified files

| File                                  | Change                                                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/backend/medusa-config.ts`       | append `{ resolve: './src/modules/voucher-engine' }` to `modules[]`                                                                                             |
| `apps/backend/src/api/middlewares.ts` | register `validateAndTransformBody` for `POST /store/cart/voucher`, `POST /admin/vouchers` (and admin update route once its method is decided — §18 CONFLICT-4) |

---

## 5. Data Models

All monetary fields are integers in the smallest currency unit (VND: 1 = 1 VND) — Rule 19 / INT-01. IDs of entities owned by other modules are `model.text()` with a read-only Link (never DB FK) — repo convention.

### 5.0 Ownership & sources of truth (authoritative)

To prevent the "which record is right?" ambiguity across VoucherEngine and Medusa, each concern has exactly one owner:

| Concern                                                                                                                                             | Authoritative owner                                         | Notes                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Voucher business configuration (code, type/value, validity, scope, min-order, per-user limit, segment, `max_discount_amount`, global `usage_limit`) | **`VoucherConfig`** (VoucherEngine)                         | The source of truth for _what the voucher is_.                                                                                                                                                                                                                     |
| The discount amount landing in **Cart & Order totals**                                                                                              | **backing Medusa Promotion** (`VoucherConfig.promotion_id`) | The native _carrier_ of the discount into authoritative `discount_total` / `items.adjustments` (§14.2-A). VoucherEngine computes the capped amount; the Promotion transports it.                                                                                   |
| Completed-redemption **audit & analytics**                                                                                                          | **`VoucherUsageLog`** (append-only, §5.2)                   | The authoritative record of _who redeemed what, when, and how much_ — the source for `GET /admin/vouchers/:id/analytics`. Never overwritten (INT-04).                                                                                                              |
| Fast **usage counter** for V3 availability checks                                                                                                   | **`VoucherConfig.usage_count`**                             | Authoritative fast counter; incremented atomically at redemption (§14.3). Must stay reconcilable with `count(VoucherUsageLog)`.                                                                                                                                    |
| Medusa-side promotion usage (`Promotion.used` / `limit`)                                                                                            | Medusa (secondary)                                          | A **secondary, defense-in-depth** value only. It **must not** be treated as the audit source or the usage counter — `VoucherUsageLog` + `VoucherConfig.usage_count` always win. If they diverge from `Promotion.used`, the VoucherEngine values are authoritative. |
| Cart contents & recalculated totals                                                                                                                 | Cart Module                                                 | VoucherEngine never writes totals directly (Rule 18).                                                                                                                                                                                                              |

Rule of thumb: **VoucherConfig = definition, Promotion = transport, VoucherUsageLog = truth of record, usage_count = fast truth of count.**

### 5.1 `VoucherConfig` (`models/voucher-config.ts`)

Maps SRS §5.2 `VoucherConfig`, minus the `extends Promotion` clause (see §18 CONFLICT-1). Implemented as a standalone model that **provisions and references a backing Medusa Promotion** (§14.2-A) via the `promotion_id` text field below — this is the reinterpretation of SRS "extends Promotion": VoucherEngine owns voucher-specific config + audit, while the discount is carried by a native Promotion so it lands in authoritative Cart/Order totals.

| Field                       | Type                                                            | Notes / SRS                                                                                                                                                                                                                                                      |
| --------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | `model.id().primaryKey()`                                       |                                                                                                                                                                                                                                                                  |
| `code`                      | `model.text()`                                                  | **stored UPPERCASE**, unique index; case-insensitive lookup (Rule 2, SEC-03). Also the backing Promotion's `code`.                                                                                                                                               |
| `promotion_id`              | `model.text().nullable()`                                       | id of the backing Medusa **Promotion** (§14.2-A), set by `createVoucherWorkflow`. Cross-module ref → read-only Link to Promotion (§6), never DB FK. Used to identify the voucher's own adjustment on cart/order (`items.adjustments[].promotion_id`).            |
| `discount_type`             | `model.enum(['percentage','fixed_amount'])`                     | SRS §5.2                                                                                                                                                                                                                                                         |
| `discount_value`            | `model.number()`                                                | integer. For percentage: basis points per SRS (`2000` = 20.00%). **[NEEDS_VERIFICATION — unit convention]**: SRS §5.2 says `2000 = 20.00%` (basis points) but worked example §9.6 uses "10%". SPEC adopts **basis points** (`value/10000`); confirm at sign-off. |
| `min_order_value`           | `model.number().nullable()`                                     | V5                                                                                                                                                                                                                                                               |
| `max_discount_amount`       | `model.number().nullable()`                                     | voucher-level cap (Rule 8)                                                                                                                                                                                                                                       |
| `stackable_with_promotions` | `model.boolean().default(true)`                                 | V8                                                                                                                                                                                                                                                               |
| `per_user_limit`            | `model.number().default(1)`                                     | V4                                                                                                                                                                                                                                                               |
| `usage_limit`               | `model.number().nullable()`                                     | V3 global                                                                                                                                                                                                                                                        |
| `usage_count`               | `model.number().default(0)`                                     | incremented only at redemption (Rule 13). Atomicity → §14                                                                                                                                                                                                        |
| `user_segment_conditions`   | `model.json().nullable()`                                       | V7 (conditional, PD-06)                                                                                                                                                                                                                                          |
| `valid_from`                | `model.dateTime()`                                              | V2                                                                                                                                                                                                                                                               |
| `valid_to`                  | `model.dateTime()`                                              | V2                                                                                                                                                                                                                                                               |
| `is_active`                 | `model.boolean().default(true)`                                 | V1                                                                                                                                                                                                                                                               |
| `scopes`                    | `model.hasMany(() => VoucherScope, { mappedBy: 'voucher' })`    | product/category scope                                                                                                                                                                                                                                           |
| `usage_logs`                | `model.hasMany(() => VoucherUsageLog, { mappedBy: 'voucher' })` | audit                                                                                                                                                                                                                                                            |

Indexes: `{ on: ['code'], unique: true }`, `{ on: ['is_active','valid_from','valid_to'] }`.

> **Decision (SEC-03):** enforce `code` min 6 chars, alphanumeric, uppercased — in `CreateVoucherSchema` (admin) and in `normalize-code` (apply). Traced from SRS §9.2 SEC-03 (not present in Solution Flow).

### 5.2 `VoucherUsageLog` (`models/voucher-usage-log.ts`)

Append-only, immutable (Rule 15 / INT-04). Never updated or deleted after creation. It is the durable redemption audit record and a **point-in-time snapshot** — it must remain correct even after the parent `VoucherConfig` is later edited, deactivated, or its scope changes (Solution Flow §7.6 step 4, D-07 "Discount snapshot", SRS INT-04). Therefore it copies the redemption-relevant voucher attributes at redemption time rather than relying on a live read of `VoucherConfig`.

| Field                                | Type                                        | Notes                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                 | `model.id().primaryKey()`                   |                                                                                                                                                                    |
| `voucher_id`                         | `model.text()`                              | logical ref (link, not DB FK)                                                                                                                                      |
| `customer_id`                        | `model.text()`                              | Solution Flow §7.5                                                                                                                                                 |
| `order_id`                           | `model.text()`                              | Solution Flow §7.5                                                                                                                                                 |
| `currency_code`                      | `model.text()`                              | **snapshot** — order/cart currency (e.g. `vnd`); makes every monetary field self-describing for analytics and multi-currency safety                                |
| `voucher_code`                       | `model.text()`                              | **snapshot** — code as applied (survives rename/deactivation)                                                                                                      |
| `discount_type`                      | `model.enum(['percentage','fixed_amount'])` | **snapshot** of the rule kind used                                                                                                                                 |
| `discount_value`                     | `model.number()`                            | **snapshot** — bps or fixed amount used at redemption                                                                                                              |
| `raw_voucher_discount`               | `model.number()`                            | §10 `raw_voucher_discount` — voucher rule applied to eligible post-promotion subtotal, **before** any cap                                                          |
| `voucher_discount_after_voucher_cap` | `model.number()`                            | §10 `voucher_discount_after_voucher_cap` — after the voucher's own `max_discount_amount`, **before** the global cap                                                |
| `final_voucher_discount`             | `model.number()`                            | §10 `final_voucher_discount` — amount **actually charged** (after global cap); equals the applied Promotion adjustment total                                       |
| `discount_applied`                   | `model.number()`                            | **retained alias — DEFINED AS `= final_voucher_discount`** (kept for the SRS §5.2 field name; single canonical value, no drift)                                    |
| `original_discount`                  | `model.number()`                            | **retained alias — DEFINED AS `= voucher_discount_after_voucher_cap`** (the "pre-global-cap voucher discount" the SRS/UI compares against for the cap explanation) |
| `was_capped`                         | `model.boolean().default(false)`            | global cap reduced the voucher ⇔ `final_voucher_discount < voucher_discount_after_voucher_cap`                                                                     |
| `cap_percentage_bps`                 | `model.number().nullable()`                 | **snapshot** of `DiscountCapConfig.max_discount_percentage` in force at redemption                                                                                 |
| `original_subtotal`                  | `model.number()`                            | **snapshot** — cart original subtotal (audit basis for the cap calc, §10)                                                                                          |
| `item_promotion_discount`            | `model.number().default(0)`                 | **snapshot** — item-level promo total at redemption (proves cap arithmetic, Rule 11)                                                                               |
| `applied_at`                         | `model.dateTime()`                          | redemption timestamp (distinct from `created_at`; set explicitly by `createUsageLogStep`)                                                                          |

Indexes: **unique `{ on: ['voucher_id','order_id'], unique: true }`** → this unique constraint is the durable idempotency guard for redemption (§14.3, D-06, INT-02). Also `{ on: ['voucher_id'] }`, `{ on: ['customer_id'] }`, `{ on: ['order_id'] }` (analytics + idempotency lookups).

**Append-only enforcement (Rule 15 / INT-04) — how, concretely.** `MedusaService` auto-generates `update*` / `delete*` / `softDelete*` for every model (verified pattern — `suggestive-selling/service.ts`). Those generated mutators must be treated as **forbidden** for `VoucherUsageLog`:

1. **Service-level:** the module service overrides `updateVoucherUsageLogs`, `deleteVoucherUsageLogs`, `softDeleteVoucherUsageLogs` to throw `MedusaError(NOT_ALLOWED, 'voucher usage log is immutable')`. This is the enforced boundary since all app code goes through the service.
2. **Workflow-level:** no workflow references any usage-log mutator except `createUsageLogStep` (§11.4); `createUsageLogStep` has **no compensation that deletes** — a failed redemption transaction rolls back the insert atomically (§14.3), it never issues a delete.
3. **DB-level (defense in depth, optional):** a Postgres trigger/rule rejecting `UPDATE`/`DELETE` on the table. `[NEEDS_VERIFICATION #11a]` — whether a hand-authored trigger can coexist with Medusa's generated migrations without being dropped on regeneration; if not, rely on layers 1–2. Recorded, not required for MVP.
4. Corrections are made by appending a compensating record in a separate reversal log (future scope), never by mutating a row here.

### 5.3 `DiscountCapConfig` (`models/discount-cap-config.ts`)

Global singleton (SRS §5.2). One active record.

| Field                     | Type                            | Notes                                                         |
| ------------------------- | ------------------------------- | ------------------------------------------------------------- |
| `id`                      | `model.id().primaryKey()`       |                                                               |
| `max_discount_percentage` | `model.number()`                | basis points; `5000` = 50.00% (SRS §5.2). Default seed = 5000 |
| `is_active`               | `model.boolean().default(true)` | single active record enforced in service/seed                 |
| `updated_by`              | `model.text().nullable()`       | audit                                                         |

### 5.4 `VoucherScope` (`models/voucher-scope.ts`) — scope rows

SRS §5.2 stores scope as `applicable_category_ids[]` / `applicable_product_ids[]` arrays on `VoucherConfig`. This spec normalizes them into scope rows so each can be wired through the Link Module and queried via `query.graph` (repo convention forbids DB FKs; array columns can't be linked). See §18 CONFLICT-2 and PD-13.

| Field         | Type                                                           | Notes                                                     |
| ------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| `id`          | `model.id().primaryKey()`                                      |                                                           |
| `scope_type`  | `model.enum(['product','category'])`                           |                                                           |
| `product_id`  | `model.text().nullable()`                                      | set when `scope_type='product'` — Link → Product          |
| `category_id` | `model.text().nullable()`                                      | set when `scope_type='category'` — Link → ProductCategory |
| `voucher`     | `model.belongsTo(() => VoucherConfig, { mappedBy: 'scopes' })` |                                                           |

> A voucher with **no** scope rows = applies to the whole cart (unscoped). With scope rows = only matching line items are eligible (V6, Rule 7).

> **Cart↔voucher association is NOT a model here.** The active voucher is attached to the cart as a **Promotion-driven adjustment** (§14.2-A, verified mechanism), not a VoucherEngine table; `cart.metadata.voucher` holds only an auxiliary snapshot.

---

## 6. Links (Link Module)

Follow `src/links/suggestion-rule-item-product.ts` (read-only link on an existing text id field, no pivot table). PD-13 resolved toward **read-only links on `VoucherScope`**.

```
src/links/voucher-config-product.ts
  defineLink({ linkable: VoucherEngineModule.linkable.voucherScope, field: 'product_id' },
             ProductModule.linkable.product, { readOnly: true })

src/links/voucher-config-category.ts
  defineLink({ linkable: VoucherEngineModule.linkable.voucherScope, field: 'category_id' },
             ProductModule.linkable.productCategory, { readOnly: true })

src/links/voucher-config-promotion.ts
  defineLink({ linkable: VoucherEngineModule.linkable.voucherConfig, field: 'promotion_id' },
             PromotionModule.linkable.promotion, { readOnly: true })   # backing promotion (§14.2-A, §5.1)
```

- `[NEEDS_VERIFICATION #4]` — exact `ProductModule.linkable.productCategory` and `PromotionModule.linkable.promotion` linkable key names (`ProductModule.linkable.product` is confirmed by the existing `suggestion-rule-item-product.ts` link; category + promotion linkable names must be checked against `@medusajs/medusa/product` and `@medusajs/medusa/promotion`). `@medusajs/medusa/promotion` and `@medusajs/medusa/product` subpath exports are **verified** to exist (medusa `package.json` `./*` → `dist/modules/*.js`).
- `.linkable` is auto-added to models — never call `.linkable()` in a model file (skill `type-linkable-auto`).

---

## 7. Service Layer

`service.ts` default-exports `VoucherEngineService extends MedusaService({ VoucherConfig, VoucherUsageLog, DiscountCapConfig, VoucherScope })`. This auto-generates CRUD (`list*`, `retrieve*`, `create*`, `update*`, `delete*`, `softDelete*`, `listAndCount*`).

**Keep the module service CRUD-only** (skill `logic-module-service`). Custom orchestration/validation/calculation logic lives in workflow steps and `lib/` pure functions — NOT in the service. Read-only helper methods that are pure queries (e.g. `retrieveByCode`) may be added to the service, but all **mutations** go through workflows (Rule / skill `arch-workflow-required`).

Pure, I/O-free logic (unit-tested directly):

- `lib/normalize-code.ts` — `normalizeCode(raw): string` = `raw.trim().toUpperCase()` (Rule 2).
- `lib/money.ts` — integer math helpers; percentage via `Math.floor(amount * bps / 10000)` (rounding policy below).
- `lib/calculate-discount.ts` — the entire §10 calculation contract as a deterministic function of primitive inputs.

---

## 8. DTOs, Validators & Error Contract

### 8.1 Store: Apply voucher

`POST /store/cart/voucher`

- Request `ApplyVoucherSchema` (zod): `{ code: string (min 6, /^[A-Z0-9]+$/ after normalize), cart_id: string, confirm_replace?: boolean }`.
  - `cart_id` sourced per store API convention `[NEEDS_VERIFICATION — whether cart id comes from body, header, or session]`.
- Success response (SRS §6.2 + Solution Flow §12.3):

```jsonc
{
  "success": true,
  "cart": {
    /* recalculated cart totals from Cart module */
  },
  "voucher": {
    "code": "SHUTTLE20",
    "discount_type": "...",
    "discount_value": 2000,
  },
  "discount_amount": 30000, // final_voucher_discount
  "original_discount": 30000, // pre global-cap
  "discount_capped": false,
  "message": {
    "code": "VOUCHER_APPLIED",
    "message_vi": "Đã áp dụng mã giảm giá SHUTTLE20. Bạn tiết kiệm 30.000₫.",
    "message_params": { "code": "SHUTTLE20", "amount": 30000 },
    "severity": "success",
    "display_hint": "toast",
  },
}
```

- Failure response (business error) — HTTP per §8.4; body is the message envelope:

```jsonc
{
  "code": "VOUCHER_MIN_ORDER_NOT_MET",
  "message_vi": "Bạn cần mua thêm 50.000₫ để sử dụng mã này.",
  "message_params": { "remaining": 50000 },
  "severity": "error",
  "display_hint": "inline",
  "retryable": false,
}
```

### 8.2 Store: Remove voucher

`DELETE /store/cart/voucher` → `{ success, cart, message: { code: "VOUCHER_REMOVED", message_vi: "Đã xóa mã giảm giá {code}.", ... } }`.

### 8.3 Message envelope contract (Solution Flow §12.3 / §18.3)

Every customer-visible response includes: `code`, `message_vi`, `message_params`, `severity` (`success|info|warning|error`), `display_hint` (`toast|inline|cart_summary|refresh_required`), and for errors `retryable`. `message_en` fallback key is reserved for future i18n. **Never** return raw exception text, DB/Redis errors, stack traces, or workflow internals (§12.5, §18.1).

### 8.4 Error code catalogue & HTTP mapping (`lib/errors.ts`)

Codes are **stable English constants**; `message_vi` is the default customer text (Solution Flow §11, §12.4). HTTP status via `MedusaError` types where the flow is synchronous (apply/remove).

| Code                           | Trigger (validation stage) | `MedusaError.Type`               | HTTP | Vietnamese default                                                                                                 |
| ------------------------------ | -------------------------- | -------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------ |
| `VOUCHER_NOT_FOUND`            | V1 not found               | NOT_FOUND                        | 404  | Mã giảm giá không tồn tại                                                                                          |
| `VOUCHER_INACTIVE`             | V1 disabled                | NOT_ALLOWED                      | 403  | Mã giảm giá hiện không khả dụng                                                                                    |
| `VOUCHER_NOT_YET_ACTIVE`       | V2                         | NOT_ALLOWED                      | 403  | Mã giảm giá chưa đến thời gian sử dụng                                                                             |
| `VOUCHER_EXPIRED`              | V2                         | NOT_ALLOWED                      | 403  | Mã giảm giá đã hết hạn vào ngày {date}                                                                             |
| `VOUCHER_USAGE_LIMIT_REACHED`  | V3                         | NOT_ALLOWED                      | 403  | Mã giảm giá đã hết lượt sử dụng                                                                                    |
| `VOUCHER_USER_LIMIT_REACHED`   | V4                         | NOT_ALLOWED                      | 403  | Bạn đã sử dụng hết số lượt cho mã này                                                                              |
| `VOUCHER_MIN_ORDER_NOT_MET`    | V5                         | INVALID_DATA                     | 400  | Bạn cần mua thêm {remaining} để sử dụng mã này                                                                     |
| `VOUCHER_NO_ELIGIBLE_ITEMS`    | V6                         | INVALID_DATA                     | 400  | Giỏ hàng chưa có sản phẩm phù hợp để áp dụng mã này                                                                |
| `VOUCHER_SEGMENT_NOT_ELIGIBLE` | V7                         | NOT_ALLOWED                      | 403  | Tài khoản của bạn chưa đủ điều kiện sử dụng mã này                                                                 |
| `VOUCHER_STACKING_CONFLICT`    | V8                         | NOT_ALLOWED                      | 409  | Mã giảm giá không thể áp dụng cùng ưu đãi hiện tại                                                                 |
| `VOUCHER_RATE_LIMITED`         | §14 cooldown               | NOT_ALLOWED                      | 429  | Bạn đã thử mã giảm giá quá nhiều lần. Vui lòng thử lại sau {minutes} phút                                          |
| `VOUCHER_DISCOUNT_CAPPED`      | §10 global cap hit         | (not an error — flag in success) | 200  | Ưu đãi từ mã giảm giá đã được điều chỉnh từ {original_amount} xuống {final_amount} theo chính sách giảm giá tối đa |
| `VOUCHER_AUTO_REMOVED`         | §13 revalidation fail      | (async notification)             | —    | Mã giảm giá {code} đã được tự động xóa vì {reason}                                                                 |
| `VOUCHER_CART_CHANGED`         | concurrency                | CONFLICT                         | 409  | Giỏ hàng đã thay đổi, cần tính lại                                                                                 |
| `VOUCHER_CALCULATION_FAILED`   | safe calc failure          | INVALID_STATE                    | 400  | Không thể áp dụng mã lúc này, giỏ hàng được giữ nguyên                                                             |

> `429` is not a native `MedusaError.Type`. `[NEEDS_VERIFICATION #8]` — whether `MedusaError` supports a 429 mapping in 2.16, else the rate-limit route returns `res.status(429)` directly with the envelope (fallback is safe and known). Recorded as PD-14 detail.

---

## 9. Validation Pipeline (V1 → V8)

### 9.0 The three validation contexts

Validation runs in **three distinct contexts** with different rule subsets and different consequences. Do not collapse them into one call site — each has its own step and its own failure handling. All three obey the same **fail-fast** rule (stop at the first failed condition, return exactly one error, run no later checks — Rules 3–4; D-03; SRS §4.1 V-order) and the same V1→V8 ordering for whatever subset they run.

| Context                      | When                                                                 | Rules run (in order)                             | Consequence of failure                                                                                                | Increments brute-force counter?                                | Step / workflow                                               |
| ---------------------------- | -------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| **Apply-time**               | Customer submits a code (`POST /store/cart/voucher`), incl. replace  | **V1 → V8** (full pipeline)                      | Cart unchanged; return one Vietnamese business error (§8). No voucher attached.                                       | Yes, only for security-relevant code failures (V1) — see 9.3   | `validateVoucherStep` in `applyVoucherWorkflow` (§11.1)       |
| **Cart-change revalidation** | An already-applied voucher must be re-checked after the cart mutates | **V1, V2, V5, V6, V8** (see 9.2 for why)         | If any fails → voucher **auto-removed** (`VOUCHER_AUTO_REMOVED` + reason); if all pass → discount recalculated (§10). | **No** (customer did not submit a code; not an attack surface) | `revalidateStep` in `revalidateVoucherWorkflow` (§11.3)       |
| **Redemption-time**          | `order.placed` for an order that carried a voucher                   | **V3, V4** only, enforced **atomically** (§14.3) | Redemption capacity exhausted → do **not** write usage/log; log for operational recovery (§11.4, §18.4-5).            | **No**                                                         | `atomicIncrementStep` in `recordVoucherUsageWorkflow` (§11.4) |

### 9.1 Validation stages (full pipeline, apply-time)

Implemented in `steps/validate-voucher.ts`. The full V1→V8 pipeline is the apply-time contract; the other two contexts run the subsets above by passing a `context` flag into the same step.

| Stage | Check                                                                                                                                                        | Inputs (source)                                                                                                                                                | On failure                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| V1    | code exists AND `is_active`                                                                                                                                  | `VoucherConfig` by normalized code (VoucherEngine DB / short-TTL cache)                                                                                        | `VOUCHER_NOT_FOUND` / `VOUCHER_INACTIVE`     |
| V2    | `valid_from <= now <= valid_to`                                                                                                                              | config + server clock                                                                                                                                          | `VOUCHER_NOT_YET_ACTIVE` / `VOUCHER_EXPIRED` |
| V3    | `usage_count < usage_limit` (or `usage_limit` null)                                                                                                          | config (authoritative DB read)                                                                                                                                 | `VOUCHER_USAGE_LIMIT_REACHED`                |
| V4    | per-user count `< per_user_limit`                                                                                                                            | `count(VoucherUsageLog where voucher_id, customer_id)`                                                                                                         | `VOUCHER_USER_LIMIT_REACHED`                 |
| V5    | cart subtotal `>= min_order_value`                                                                                                                           | Cart module (post-promotion basis per §10 — subtotal comparison uses original subtotal per SRS V5 wording) `[NEEDS_VERIFICATION — which subtotal V5 compares]` | `VOUCHER_MIN_ORDER_NOT_MET` (+ `remaining`)  |
| V6    | ≥1 cart line item matches scope (or unscoped)                                                                                                                | `VoucherScope` + cart line items' product/category (via `query.graph`)                                                                                         | `VOUCHER_NO_ELIGIBLE_ITEMS`                  |
| V7    | customer meets `user_segment_conditions` when configured                                                                                                     | Customer/CRM segment source                                                                                                                                    | `VOUCHER_SEGMENT_NOT_ELIGIBLE`               |
| V8    | no stacking conflict: `stackable_with_promotions=false` AND cart has active item-promotions ⇒ conflict; and no other active voucher unless replace-confirmed | config + Promotion result on cart                                                                                                                              | `VOUCHER_STACKING_CONFLICT`                  |

**V7 status:** `BLOCKED: Pending Decision` (PD-06). No approved customer-segment source exists in scope (Solution Flow §2.3 lists segment source as out of scope). **Decision for this spec:** V7 is a **no-op pass when `user_segment_conditions` is null**, and returns `VOUCHER_SEGMENT_NOT_ELIGIBLE` only if conditions are configured AND a segment source is wired. Ship V1–V6, V8 fully; V7 as a stub that passes when unconfigured. Confirm at sign-off.

**Which failures increment the brute-force counter (§14):** only _security-relevant code failures_ — `VOUCHER_NOT_FOUND` (and arguably `VOUCHER_INACTIVE`). Business failures on a _known_ code (min-order, no-eligible-items, expired, usage-limit, segment, stacking) do **not** count toward brute-force (Solution Flow §7.1 step 9, §7.8 step 6). Exact classification list → confirm (part of PD-14 messaging).

### 9.2 Cart-change revalidation subset — rationale (RESOLVED)

The revalidation context (§11.3) re-runs **V1, V2, V5, V6, V8** and deliberately **skips V3, V4, V7**:

- **V1 (still active)** — re-run so admin deactivation between apply and cart change removes the voucher on the next cart mutation (this is the recommended resolution of **PD-08**; see §11.3).
- **V2 (not expired)** — re-run because the voucher may have expired while the cart was open.
- **V5 (min order), V6 (eligible items), V8 (stacking)** — the genuinely **cart-dependent** rules; these are the auto-removal triggers in Solution Flow §7.4 (below min order, all eligible removed, scope ineligible, new promotion changes stacking state).
- **V3 (global usage) / V4 (per-user usage) — SKIPPED.** Usage is not consumed until order placement (Rules 12–13). Removing an already-applied cart voucher because the _global_ counter moved would punish a customer mid-checkout and contradicts EC-06. Usage capacity is re-checked authoritatively at redemption-time (§9.0, §14.3) instead.
- **V7 (segment) — SKIPPED** while PD-06 is unresolved (segment source out of scope); segment eligibility does not change from a cart mutation. Re-add to the subset if/when a segment source is wired.

Superseded note: earlier text described the revalidation subset as "V3–V8"; the resolved subset is **V1, V2, V5, V6, V8**.

### 9.3 Brute-force classification (RESOLVED for MVP)

Only failures that reveal _whether a submitted code maps to a real voucher_ are security-relevant and increment the counter (§14.1):

- **Increments counter:** `VOUCHER_NOT_FOUND` (code does not exist). This is the only unambiguous guessing signal.
- **Does NOT increment:** `VOUCHER_INACTIVE`, `VOUCHER_NOT_YET_ACTIVE`, `VOUCHER_EXPIRED`, `VOUCHER_USAGE_LIMIT_REACHED`, `VOUCHER_USER_LIMIT_REACHED`, `VOUCHER_MIN_ORDER_NOT_MET`, `VOUCHER_NO_ELIGIBLE_ITEMS`, `VOUCHER_SEGMENT_NOT_ELIGIBLE`, `VOUCHER_STACKING_CONFLICT` — all imply the code is _known_, so they are legitimate-customer states, not guessing.
- **Trade-off recorded:** counting only `VOUCHER_NOT_FOUND` means an attacker who happens to hit a real-but-inactive code is not throttled by that specific response. Because SEC-02's goal is to slow _discovery of valid codes_, and inactive/expired codes are not usable, this is acceptable for MVP. If monitoring later shows enumeration of the known-code space, add `VOUCHER_INACTIVE`/`VOUCHER_EXPIRED` to the counted set (business decision, not a code blocker).
- The counter classification is applied **only in the apply-time context** (§9.0). Cart-change and redemption-time never touch it.

### 9.4 V7 segment status

**V7 status:** `BLOCKED: Pending Decision` (PD-06) — unchanged. V7 is a **no-op pass when `user_segment_conditions` is null**, and returns `VOUCHER_SEGMENT_NOT_ELIGIBLE` only if conditions are configured AND a segment source is wired. Ship V1–V6, V8 fully; V7 as a stub that passes when unconfigured. Confirm at sign-off. (The V7 row above and this note are the same decision; kept here so the phase tables read cleanly.)

---

## 10. Discount Resolution

`lib/calculate-discount.ts` — pure, deterministic, integer-only (Rules 5–11, 18–19; D-04). Order is fixed (Solution Flow §9.1).

### 10.1 Calculation contract (verbatim, Solution Flow §9.3 / D-04)

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

### 10.2 Guard rules (Solution Flow §9.4)

- `final_voucher_discount` never negative → clamp at 0.
- item-level promotion discount is **never** reduced by VoucherEngine (Rule 11).
- `final_cart_total` never negative; **≥ 1 VND** where policy requires (EC-03). `[NEEDS_VERIFICATION — is the "min 1 VND" clamp mandatory or policy-flagged?]` — SRS EC-03 says minimum 1 VND; Solution Flow §9.4 says "at least 1 VND where required by policy". Adopt: clamp to ≥ 1 VND and log a warning when the cap alone would drive total to 0 (EC-03).
- integer arithmetic only; **rounding policy:** percentage uses `Math.floor` (round down, favors the store; never creates fractional VND). Confirm at sign-off — recorded under §19.
- Fixed-amount voucher: `raw_voucher_discount = min(discount_value, eligible_post_promotion_subtotal)` (fixed can't exceed eligible subtotal — SRS §22.2).

### 10.3 Percentage basis-point convention

`raw = Math.floor(eligible_post_promotion_subtotal * discount_value / 10000)` (discount_value in bps). Global cap: `maximum_combined_discount = Math.floor(original_subtotal * max_discount_percentage / 10000)`.

### 10.4 Worked example — under cap (must reproduce Solution Flow §9.6 exactly)

```
original_subtotal            = 4,700,000
item_promotion_discount      =   900,000
post_promotion_subtotal      = 3,800,000
voucher 10% (bps 1000) on eligible = whole cart eligible → eligible = 3,800,000
raw_voucher_discount         =   380,000
no voucher cap
maximum_combined_discount    = 50% × 4,700,000 = 2,350,000
final_voucher_discount       = min(380,000, 2,350,000 - 900,000 = 1,450,000) = 380,000
final_cart_total             = 4,700,000 - 900,000 - 380,000 = 3,420,000   ✓
discount_capped = false
```

### 10.5 Worked example — cap exceeded (must reproduce Solution Flow §9.7 exactly)

```
original_subtotal            = 4,700,000
item_promotion_discount      = 1,860,000
voucher 20% (bps 2000) on eligible post-promotion (2,840,000)
raw_voucher_discount         =   568,000
maximum_combined_discount    = 2,350,000
final_voucher_discount       = min(568,000, 2,350,000 - 1,860,000 = 490,000) = 490,000
final_cart_total             = 4,700,000 - 1,860,000 - 490,000 = 2,350,000   ✓
discount_capped = true; original_amount=568,000; final_amount=490,000
```

### 10.6 EC-03 (would-be negative) example

Voucher 50% + item promo 50% ⇒ combined would be 100%. Global cap 50% forces `final_voucher_discount = max(0, 2,350,000 - item_promotion_discount)`; total clamped ≥ 1 VND; warning logged.

### 10.7 Source of `item_promotion_discount` and `original line item totals` — VERIFIED field sources

**Technically Verified** (fields exist and are the authoritative store cart fields — `@medusajs/medusa/dist/api/store/carts/query-config.js`) with one **narrow `[NEEDS_VERIFICATION]`** on exact discount-inclusion semantics. All inputs come from the **authoritative Cart + Promotion state** via `query.graph`, never recomputed by VoucherEngine (Rule 5/11/18, SEC-01, Solution Flow §3.2). `loadCartContextStep` (§11.1) reads these and hands the calculator **plain integers** (`CalcInputDTO`, §11.10).

| §10 calculator input                   | Verified authoritative source (cart `query.graph` field)                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `original_subtotal` (pre-any-discount) | cart **`original_item_subtotal`** (verified field). Cross-check: `Σ items.unit_price × items.quantity`.                                                                                    |
| `item_promotion_discount` (total)      | cart **`item_discount_total`** (verified) **before** the voucher is applied; equivalently `Σ items.adjustments[].amount` over **non-voucher** adjustments (see distinguishing rule below). |
| `item_promotion_discount` (per line)   | **`items.adjustments[].amount`** for that line (verified: `items.adjustments.{id,code,promotion_id,amount,is_tax_inclusive}`).                                                             |
| `post_promotion_subtotal`              | cart **`item_subtotal`** (verified) = original less item-level discounts.                                                                                                                  |
| `eligible_post_promotion_subtotal`     | `Σ` over voucher-eligible lines of `(unit_price × quantity − Σ non-voucher adjustments on that line)` — all from verified line fields.                                                     |
| eligible-item scope match (V6)         | **`items.product_id`** and **`items.product.categories.id`** (verified) matched against `VoucherScope` (product/category ids).                                                             |

**Distinguishing item-promotion adjustments from VoucherEngine's own voucher adjustment (verified basis):** every adjustment carries **`promotion_id`** and **`code`** (verified fields). VoucherEngine's backing promotion (§14.2-A) has a known `promotion_id`/`code`; therefore:

- item-level promotion discount = `Σ items.adjustments[].amount WHERE promotion_id ≠ voucher.promotion_id`.
- the voucher's own contribution = the adjustment(s) where `promotion_id = voucher.promotion_id` (or `code = voucher.code`).

This makes Rule 11 ("never reduce item promotions") enforceable directly against the data: the cap only ever changes the voucher's own adjustment amount, never the others.

**Narrow `[NEEDS_VERIFICATION #2]`:** the exact discount-inclusion semantics of `item_subtotal` vs `item_discount_total` vs `discount_total` — specifically whether `item_subtotal` is net of **item-level** promotions only (expected) vs all discounts, and whether `discount_total` includes shipping discounts. Confirm against the cart module's totals calculator (transitive `@medusajs/cart`, unreachable this pass). Mitigation: compute `item_promotion_discount` directly from per-line `items.adjustments[].amount` (excluding the voucher's own), which does not depend on the aggregate-field semantics. **The pure `lib/calculate-discount.ts` takes plain numbers and is fully unit-testable now** (§16.1). §10.7 (read) and §14.2-A (write) share the same verified adjustment model.

---

## 11. Workflows & Steps

All mutations via workflows (skill `arch-workflow-required`). Workflow composition constraints (skill): non-async regular `function`, no `await`, no conditionals (use `when()`), no direct var manipulation (use `transform()`), unique step `.config({name})` on repeats.

### 11.1 `applyVoucherWorkflow` (`workflows/voucher/apply-voucher.ts`) — Solution Flow §7.1, D-02, SRS §7.2

Steps (each in `steps/`):

The whole read→compute→apply section runs inside a **Locking Module** lock keyed `voucher:cart:{cart_id}` (§14.2-C).

1. `normalizeCodeStep` — trim+upper (pure).
2. `checkRateLimitStep` — cooldown check via atomic counter client; throws `VOUCHER_RATE_LIMITED` if blocked (§14.1).
3. `lookupVoucherStep` — load `VoucherConfig` by code (+ scopes + `promotion_id`). 404 → `VOUCHER_NOT_FOUND`.
4. `loadCartContextStep` — read the **latest** cart via `query.graph` (fields per §10.7); derive `original_item_subtotal`, per-line `items.adjustments`, `item_subtotal`, product/category. (No stale snapshot — the lock makes this read authoritative for the section.)
5. `validateVoucherStep` — V1–V8 fail-fast (§9). On security-relevant failure (V1 only, §9.3) increment the rate-limit counter (no compensation needed; cart unchanged).
6. `resolveEligibleItemsStep` — determine eligible line items from scope (`items.product_id` / `items.product.categories.id`).
7. `calculateVoucherDiscountStep` — raw + voucher cap (`lib/calculate-discount`, plain ints).
8. `enforceGlobalCapStep` — apply global cap; produce `final_voucher_discount`, `discount_capped`.
9. `applyVoucherPromotionStep` — apply the discount as a Promotion-driven adjustment via `updateCartPromotionsWorkflow ADD` (amount = `final_voucher_discount`; §14.2-A). The Cart module recomputes authoritative totals from source. Also write the auxiliary `cart.metadata.voucher` snapshot + `_revalidation_marker`. **Compensation:** `updateCartPromotionsWorkflow REMOVE` the voucher code and let the cart recompute — **never** write back a captured numeric total (Rule 18).
10. `verifyCartTotalsStep` — **refetch** the authoritative cart, read the voucher adjustment + `cart.total`, and compare against the internally computed `final_voucher_discount` / `expected_final_cart_total` (§23.4, tasks 3.3.14 / 3.8.4). On mismatch → throw `VOUCHER_CALCULATION_FAILED`. **Compensation:** `updateCartPromotionsWorkflow REMOVE` the voucher code so the cart recomputes to its pre-voucher state. The internally computed total is used **only** for this assertion; the refetched Cart total is what the route returns.

(The former "verify-cart-unchanged / updated*at re-read" step is replaced by the lock + latest-read in §14.2-C; the new step 10 verifies \_totals correctness*, a different concern from concurrency.)

Full code-level contracts for the calculation/cart-context/verification/route files touched by steps 4, 7–10 are in **§23 (Code-Level Implementation Blueprint)**.

Returns the apply-success/failure envelope (§8). On any validation/calc failure the cart stays unchanged (§18.4).

**Replace (SRS VOUCH-001, Solution Flow §7.2):** if cart already has an active voucher and `confirm_replace!==true`, the workflow short-circuits **before step 9 (`applyVoucherPromotionStep`)** and returns a "confirm replacement" signal (no mutation). If confirmed, the existing voucher's promotion stays attached until step 9 succeeds; only then is it swapped (`REPLACE`/`REMOVE` old + `ADD` new). If the new voucher fails validation/calc, the old promotion remains (Solution Flow §7.2 "must not remove valid existing voucher before replacement validated"; §18.4 rule 3).

### 11.2 `removeVoucherWorkflow` (`workflows/voucher/remove-voucher.ts`) — Solution Flow §13.2 (Remove), SRS VOUCH-004

1. `assertActiveVoucherStep` — confirm cart has an active voucher promotion (adjustment with the voucher's `promotion_id`/`code`, §14.2-A).
2. `removeVoucherPromotionStep` — `updateCartPromotionsWorkflow REMOVE` the voucher code; the Cart module recomputes totals **without** the voucher from source (never a stale write-back). Clear the `cart.metadata.voucher` snapshot. **Compensation:** re-`ADD` the promotion (unlikely needed).
   No usage change (Rule 12/13). Returns `VOUCHER_REMOVED` envelope.

### 11.3 `revalidateVoucherWorkflow` (`workflows/voucher/revalidate-voucher-on-cart-change.ts`) — Solution Flow §7.4, D-05, SRS VOUCH-005

Invoked by the `cart.updated` subscriber (external mutations) and inline at the end of voucher-owned flows (§11.5). Runs inside the `voucher:cart:{cart_id}` lock (§14.2-C).

1. `checkVoucherExistsStep` — if no active voucher, exit early (`when()`).
2. `loadCartContextStep` (reuse) — latest cart.
3. `revalidateStep` — re-run the cart-change validation subset **V1, V2, V5, V6, V8** (§9.2).
   3a. valid → `calculateVoucherDiscountStep` + `enforceGlobalCapStep` → re-`ADD`/update the voucher promotion with the new amount (`updateCartPromotionsWorkflow`); the Cart module recomputes authoritative totals from source.
   3b. invalid → `removeVoucherPromotionStep` + build `VOUCHER_AUTO_REMOVED` reason.
   Auto-removal reasons per Solution Flow §7.4 table (below min order, all eligible removed, scope ineligible → removed; else recalculated).

**Revalidation subset:** `revalidateStep` re-runs **V1, V2, V5, V6, V8** (§9.2), **not** V3–V8 (usage rules are re-checked only at redemption, §9.0). Superseded note: the earlier "V3–V8" phrasing (and any elsewhere) is corrected to this subset.

### 11.4 `recordVoucherUsageWorkflow` (`workflows/voucher/record-voucher-usage.ts`) — Solution Flow §7.5, D-06, SRS INT-02/INT-04

Invoked **primarily** as a synchronous step/hook of `completeCartWorkflow`, and **as a fallback** by the `order.placed` subscriber (§13.2/§13.3). Both are idempotent, so running both is safe.

1. `assertOrderHasVoucherStep` — resolve the applied voucher **from the order** (verified: `order.items.adjustments[].code`/`promotion_id` → `VoucherConfig`; §13.3). If none → exit early via `when()` (not an error). No dependency on `cart.metadata` propagation.
2. `idempotencyCheckStep` — if `VoucherUsageLog(voucher_id, order_id)` exists → stop (no increment). First idempotency guard (Rule; D-06).
3. `atomicIncrementStep` — conditional atomic global increment + concurrency-safe per-user check (§14.3), in one transaction.
4. `createUsageLogStep` — insert immutable `VoucherUsageLog` with the full audit snapshot (§5.2), incl. `discount_applied`/`original_discount`/`was_capped` read from the order's voucher adjustment. Unique `(voucher_id, order_id)` = **second** idempotency guard. Same DB transaction as step 3 (§14.3).
5. failure (capacity exhausted at redemption) → do not create an invalid log; **log-and-alert, no auto-compensation** (§14.3, §18.4-5); order stands, redemption flagged for manual review.

> When run from the subscriber path, the handler must not throw (async, non-blocking): errors are caught + logged; idempotency makes redelivery safe (skill best-practices 2, 6). When run from the completion hook, a failure in steps 3–4 is caught and flagged (per step 5) rather than failing the order — the customer has already paid.

### 11.5 Cart-change revalidation — synchronous vs subscriber (RESOLVED: combination)

**Decision:** use **both**, with a single shared `revalidateVoucherWorkflow` invoked from two triggers. This resolves task item 8.

| Trigger                                                                                                            | Mode                             | Why                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Voucher-owned mutations (`applyVoucherWorkflow` end, before returning)                                             | **Synchronous, inline**          | The apply flow already holds the latest cart; the customer must see the correct total in the same response. This is the concurrency re-check (§14.2). |
| External cart mutations (item add/remove, qty change, variant change, suggestive-selling add) via core Cart routes | **Subscriber** on `cart.updated` | VoucherEngine does not own these routes and cannot wrap them; the event is the only decoupled hook (Solution Flow §7.4, §14 interaction map).         |

Rationale for the combination (not subscriber-only): a subscriber is **asynchronous and eventually-consistent**, so if the customer's _next_ action is reading the cart immediately after a voucher-affecting change made inside our own flow, an async-only design could show a stale total for a window. Inline revalidation on our own mutations closes that window; the subscriber covers everything we don't control. Both call the same workflow, so the rules cannot drift.

**Loop-guard (critical) — convergent, not counter-based.** Applying/updating the voucher promotion via `updateCartPromotionsWorkflow` mutates the cart and therefore may re-emit `cart.updated`, re-triggering the subscriber. The guard must guarantee the re-run performs **no further mutation**, so the loop terminates after one convergent pass:

- The workflow computes the **desired** voucher state `{voucher_id, final_voucher_discount, eligible_item_ids}` from the latest cart, then compares it to the **currently applied** state (the existing voucher adjustment amount + code already on the cart).
- If desired == applied → **exit before any write** (no promotion update, no metadata write). Because the second (echo) invocation recomputes the _same_ desired state that is already applied, it hits this branch and stops — the loop cannot continue.
- Only a genuine change (amount differs, or validity flipped) mutates, which is exactly the intended behavior.
- The `_revalidation_marker` is a cheap fast-path (skip recompute when the cart's change fingerprint is unchanged) but is **not** the loop's correctness mechanism — the desired-vs-applied equality is. This avoids the failure mode where writing the marker itself re-emits `cart.updated` and sustains the loop.

`[NEEDS_VERIFICATION #5]` — whether `updateCartPromotionsWorkflow`'s no-op case (re-adding an identical promotion) still emits `cart.updated`; if it does not, the guard is belt-and-suspenders; if it does, the desired-vs-applied equality above is load-bearing (and sufficient).

### 11.6 `createVoucherWorkflow` (`workflows/voucher/create-voucher.ts`) — Solution Flow §7.6, SRS §6.2 (NEW)

Admin create. Referenced by `POST /admin/vouchers` (§12) but previously undefined.

1. `validateVoucherConfigStep` — completeness/consistency: code format (SEC-03: ≥6 chars, `^[A-Z0-9]+$`, uppercased), `discount_value>0`, `valid_from<valid_to`, `per_user_limit>=1`, percentage `discount_value<=10000` bps, nullable-vs-required coherence. Business errors, not `MedusaError.NOT_FOUND`.
2. `normalizeVoucherCodeStep` — uppercase+trim (reuse `lib/normalize-code`); assert uniqueness (service `list` by code) → conflict error if taken.
3. `createBackingPromotionStep` — create the native Medusa **Promotion** (§14.2-A) via the core-flows create-promotion workflow: `code`, `application_method` (percentage/fixed), scope `target_rules` from scopes, min-order `rules`, global `limit`, `is_automatic=false`. **Compensation:** delete the created Promotion. `[NEEDS_VERIFICATION #3]` — exact create-promotion input signature.
4. `createVoucherConfigStep` — `create` `VoucherConfig` with `promotion_id` from step 3. **Compensation:** `delete` the created row.
5. `createVoucherScopesStep` — `when()` scopes provided → create `VoucherScope` rows. **Compensation:** delete created scope rows.
6. `invalidateVoucherCacheStep` — invalidate config cache for the code (§14.4). Compensation: none (cache is non-authoritative).

> The backing Promotion covers natively-expressible parts (code/percentage/fixed, scope via `target_rules`, min-order via `rules`, global `limit`). VoucherEngine's cross-source global cap + per-user limit + segment stay in VoucherEngine and are enforced at apply/redemption; at apply, the final capped amount is what gets applied to the cart (§14.2-A).

### 11.7 `updateVoucherWorkflow` (`workflows/voucher/update-voucher.ts`) — Solution Flow §7.6 (NEW)

Admin update. Referenced by `POST /admin/vouchers/:id` (§12, CONFLICT-4). Usage logs remain immutable; historical redemptions stay auditable (Solution Flow §7.6 step 4).

1. `assertVoucherExistsStep` — retrieve by id (+ `promotion_id`) → `VOUCHER_NOT_FOUND` if missing.
2. `validateVoucherConfigStep` (reuse, partial) — validate only provided fields; forbid mutating `usage_count` and `code`-to-a-taken-code.
3. `applyVoucherUpdateStep` — `update` `VoucherConfig`; diff scopes and create/delete `VoucherScope` rows. **Compensation:** restore previous field values + previous scope set (captured pre-update in the step input).
4. `syncBackingPromotionStep` — **keep the backing Promotion consistent with the updated config.** When any config field that maps to the Promotion changes, update the backing Promotion (`updatePromotionsWorkflow`, `[NV #3]`) in the **same workflow** so config and Promotion never diverge:

   | Changed VoucherConfig field                  | Backing-Promotion field to update            |
   | -------------------------------------------- | -------------------------------------------- |
   | `code`                                       | Promotion `code`                             |
   | `discount_type`                              | `application_method.type` (percentage↔fixed) |
   | `discount_value`                             | `application_method.value`                   |
   | `valid_from` / `valid_to`                    | Promotion validity window / campaign dates   |
   | product/category scope (`VoucherScope` rows) | `application_method.target_rules`            |
   | `min_order_value`                            | Promotion `rules` (min-subtotal rule)        |
   | `usage_limit` (global)                       | Promotion `limit`                            |
   | `is_active`                                  | Promotion active/enabled status              |

   No mapped field changed → skip via `when()` (no Promotion write). **Compensation:** restore the Promotion's previous mapped fields (captured pre-update). Fields that stay VoucherEngine-only (`max_discount_amount`, `per_user_limit`, `stackable_with_promotions`, `user_segment_conditions`) do **not** touch the Promotion.

5. `invalidateVoucherCacheStep` (reuse) — invalidate config cache for old and new code.

> **Consistency guarantee:** `VoucherConfig` update (step 3) and backing-Promotion update (step 4) run in the one `updateVoucherWorkflow`; if step 4 fails, step 3's compensation restores the prior config, so the pair never ends up half-updated. `[NV #3]` — `updatePromotionsWorkflow` input signature.
>
> **Revalidation policy on config change (PD-08 adjacent):** updating a live voucher does **not** retroactively rewrite applied carts synchronously. Currently-applied carts are re-checked lazily on their next `cart.updated` (§11.5 subscriber) against the latest config **and the updated Promotion**. Recorded as the approved policy; confirm at sign-off.

### 11.8 `deactivateVoucherWorkflow` (`workflows/voucher/deactivate-voucher.ts`) — Solution Flow §7.6, SRS §6.2 (NEW)

Admin soft-deactivate. Referenced by `DELETE /admin/vouchers/:id` (§12).

1. `assertVoucherExistsStep` (reuse) — also load `promotion_id`.
2. `deactivateVoucherStep` — `update` `is_active=false` (soft; **not** `delete` — audit/history must survive, Solution Flow §6, §7.6). **Compensation:** set `is_active=true`.
3. `deactivateBackingPromotionStep` — **disable the backing Promotion** (`updatePromotionsWorkflow` set inactive/`status` disabled, or the deactivate-promotion flow; `[NV #3]`) so Medusa itself refuses to apply it to any cart, not just VoucherEngine's V1 check. **Compensation:** re-enable the Promotion. **`VoucherUsageLog` rows are never touched** — historical redemptions stay intact and auditable (INT-04).
4. `invalidateVoucherCacheStep` (reuse).

> **Applied-cart policy after deactivation (PD-08) — RESOLVED (recommended):** deactivated vouchers are removed from carts on the **next `cart.updated` revalidation** (V1 re-run in §9.2 fails → `VOUCHER_AUTO_REMOVED`), not force-removed from all live carts synchronously. Rationale: no way to enumerate/lock every open cart cheaply; lazy removal is consistent with the revalidation design and avoids a mass-mutation job. Business owner to confirm; until confirmed this remains the documented default, not a hard block.

### 11.9 `updateDiscountCapConfigWorkflow` (`workflows/voucher/update-discount-cap.ts`) — SRS §5.2 DiscountCapConfig, §6 (NEW)

Admin updates the global cap singleton. Referenced by the discount-cap admin route (§12).

1. `validateCapStep` — `0 < max_discount_percentage <= 10000` bps.
2. `upsertActiveCapStep` — enforce **single active record**: set previous active `is_active=false` and create/update the new active record, or update-in-place. Set `updated_by` from the authenticated admin. **Compensation:** restore the prior active record + prior value.
3. `invalidateCapCacheStep` — invalidate `DiscountCapConfig` cache (§14.4).

> The cap change affects only **future** calculations. Live carts pick up the new cap on their next revalidation (§11.5); no retroactive rewrite.

### 11.10 Workflow-step contracts

Concrete input/output contracts for every step above. `Input`/`Output` are the step's own DTOs (define under `workflows/voucher/steps/*` or `lib/`); names ending `DTO` are VoucherEngine-owned and fully specifiable now. Types tagged `[NV#n]` reference a Medusa framework type whose exact shape is unverified this pass (§19.2) — the step signature is defined, only the external type binding is pending. `Reads`/`Mutations` name the module and operation. `—` = none.

**`applyVoucherWorkflow` (§11.1)**

| Step                         | File                                | Input Type                                                                                                                                 | Output Type                                                                                                                                                                                                                          | Dependencies     | Reads                                                                                                 | Mutations                                                                                        | Compensation                                                                             | Errors                                                            |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| normalizeCodeStep            | steps/normalize-code.ts             | `{ code: string }`                                                                                                                         | `{ normalized_code: string }`                                                                                                                                                                                                        | —                | —                                                                                                     | —                                                                                                | —                                                                                        | — (pure)                                                          |
| checkRateLimitStep           | steps/check-rate-limit.ts           | `{ identity: RateLimitIdentityDTO }`                                                                                                       | `{ allowed: true }`                                                                                                                                                                                                                  | normalizeCode    | Redis counter/cooldown keys (§14.1)                                                                   | —                                                                                                | —                                                                                        | `VOUCHER_RATE_LIMITED` (429)                                      |
| lookupVoucherStep            | steps/lookup-voucher.ts             | `{ normalized_code: string }`                                                                                                              | `{ voucher: VoucherConfigDTO, scopes: VoucherScopeDTO[] }`                                                                                                                                                                           | rateLimit        | VoucherEngine `list/retrieve` (+config cache §14.4)                                                   | —                                                                                                | —                                                                                        | `VOUCHER_NOT_FOUND` (404)                                         |
| loadCartContextStep          | steps/load-cart-context.ts          | `{ cart_id: string, customer_id?: string }`                                                                                                | `CartContextDTO { original_item_subtotal:int, item_subtotal:int, item_discount_total:int, lines:[{id,unit_price,quantity,product_id,category_ids,adjustments:[{amount,promotion_id,code}]}] }` (all from verified cart fields §10.7) | —                | Cart `query.graph` (verified fields §10.7): totals + `items.adjustments` + `items.product.categories` | —                                                                                                | —                                                                                        | `VOUCHER_CALCULATION_FAILED` (safe)                               |
| validateVoucherStep          | steps/validate-voucher.ts           | `{ voucher, scopes, cartContext, context:'apply', customer_usage_count:int }`                                                              | `{ valid: true, eligible_item_ids: string[] }`                                                                                                                                                                                       | lookup, loadCart | VoucherEngine usage `count` (V4)                                                                      | Redis counter++ on V1 fail only (§9.3)                                                           | —                                                                                        | `VOUCHER_*` per V1–V8 (§8.4), fail-fast                           |
| resolveEligibleItemsStep     | steps/resolve-eligible-items.ts     | `{ scopes, line_items }`                                                                                                                   | `{ eligible: EligibleItemDTO[] }`                                                                                                                                                                                                    | validate         | — (uses loaded context)                                                                               | —                                                                                                | —                                                                                        | —                                                                 |
| calculateVoucherDiscountStep | steps/calculate-voucher-discount.ts | `CalcInputDTO { eligible_post_promotion_subtotal:int, discount_type, discount_value:int, max_discount_amount?:int }`                       | `{ raw_voucher_discount:int, voucher_discount_after_voucher_cap:int }`                                                                                                                                                               | resolveEligible  | — (pure, `lib/calculate-discount`)                                                                    | —                                                                                                | —                                                                                        | `VOUCHER_CALCULATION_FAILED`                                      |
| enforceGlobalCapStep         | steps/enforce-global-cap.ts         | `{ voucher_discount_after_voucher_cap:int, original_subtotal:int, item_promotion_discount:int, cap_bps:int }`                              | `{ final_voucher_discount:int, discount_capped:bool, original_discount:int }`                                                                                                                                                        | calculate        | DiscountCapConfig (+cap cache §14.4)                                                                  | —                                                                                                | —                                                                                        | —                                                                 |
| applyVoucherPromotionStep    | steps/apply-voucher-promotion.ts    | `ApplyInputDTO { cart_id, voucher_id, promotion_id, code, final_voucher_discount, original_discount, discount_capped, eligible_item_ids }` | `{ cart }` (recomputed by Cart module)                                                                                                                                                                                               | enforceCap       | —                                                                                                     | Cart: `updateCartPromotionsWorkflow ADD` adjustment (§14.2-A) + `cart.metadata.voucher` snapshot | `updateCartPromotionsWorkflow REMOVE` code → cart recomputes (NOT stale restore — §14.2) | `VOUCHER_CALCULATION_FAILED`; apply-signature `[NV#3]`            |
| verifyCartTotalsStep         | steps/verify-cart-totals.ts         | `VerifyTotalsInputDTO { cart_id, promotion_id, final_voucher_discount:int, expected_final_cart_total:int }`                                | `{ cart, verified:true }` (authoritative refetched cart)                                                                                                                                                                             | applyPromotion   | Cart refetch (`query.graph`/`refetchCart`, §23.4)                                                     | — (read-only; no total mutation)                                                                 | `updateCartPromotionsWorkflow REMOVE` code → cart recomputes to pre-voucher state        | `VOUCHER_CALCULATION_FAILED` on total/adjustment mismatch (§23.4) |

**`removeVoucherWorkflow` (§11.2)**

| Step                       | File                              | Input Type          | Output Type                          | Dependencies | Reads                                                     | Mutations                                                                             | Compensation                                       | Errors                                              |
| -------------------------- | --------------------------------- | ------------------- | ------------------------------------ | ------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------- |
| assertActiveVoucherStep    | steps/assert-active-voucher.ts    | `{ cart_id }`       | `{ voucher_id, code, promotion_id }` | —            | Cart adjustments (voucher `promotion_id`/`code`, §14.2-A) | —                                                                                     | —                                                  | `VOUCHER_NOT_FOUND` (no active voucher → 404/no-op) |
| removeVoucherPromotionStep | steps/remove-voucher-promotion.ts | `{ cart_id, code }` | `{ cart }` (recomputed)              | assert       | —                                                         | Cart: `updateCartPromotionsWorkflow REMOVE` code → recompute; clear metadata snapshot | re-`ADD` promotion → recompute (not stale restore) | `VOUCHER_CALCULATION_FAILED`                        |

**`revalidateVoucherWorkflow` (§11.3, §11.5)**

| Step                               | File                                      | Input Type                                               | Output Type                                                 | Dependencies | Reads                       | Mutations                                                                              | Compensation                             | Errors                                     |
| ---------------------------------- | ----------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- | ------------ | --------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------ |
| checkVoucherExistsStep             | steps/check-voucher-exists.ts             | `{ cart_id }`                                            | `{ has_voucher:bool, voucher_id?, marker? }`                | —            | Cart voucher state `[NV#3]` | —                                                                                      | —                                        | — (exit via `when()`)                      |
| loadCartContextStep (reuse)        | steps/load-cart-context.ts                | `{ cart_id, customer_id? }`                              | `CartContextDTO`                                            | checkExists  | as §11.1                    | —                                                                                      | —                                        | caught → log, no throw (subscriber)        |
| revalidateStep                     | steps/validate-voucher.ts                 | `{ voucher, scopes, cartContext, context:'revalidate' }` | `{ still_valid:bool, failure_reason?, eligible_item_ids? }` | loadCart     | VoucherEngine               | —                                                                                      | —                                        | none surfaced to customer synchronously    |
| recalcAndUpdateStep (when valid)   | steps/apply-voucher-promotion.ts (reuse)  | `ApplyInputDTO`                                          | `{ cart }`                                                  | revalidate   | DiscountCapConfig           | Cart: `updateCartPromotionsWorkflow` re-apply new amount → recompute; refresh snapshot | re-derive (recompute, not stale restore) | `VOUCHER_CALCULATION_FAILED` (logged)      |
| removeAndNotifyStep (when invalid) | steps/remove-voucher-promotion.ts (reuse) | `{ cart_id, code, reason_code }`                         | `{ cart, notification }`                                    | revalidate   | —                           | Cart: `updateCartPromotionsWorkflow REMOVE` → recompute                                | —                                        | builds `VOUCHER_AUTO_REMOVED` (§13, async) |

**`recordVoucherUsageWorkflow` (§11.4)**

| Step                      | File                              | Input Type                                                 | Output Type                                                                              | Dependencies               | Reads                                                                                           | Mutations                                                                                                    | Compensation                         | Errors                                                                      |
| ------------------------- | --------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------- |
| assertOrderHasVoucherStep | steps/assert-order-has-voucher.ts | `{ order_id }`                                             | `{ voucher_id, customer_id, discount_applied, original_discount, was_capped, snapshot }` | —                          | Order `items.adjustments[].code`/`promotion_id` (verified propagation, §13.3) → `VoucherConfig` | —                                                                                                            | —                                    | exit via `when()` if none                                                   |
| idempotencyCheckStep      | steps/idempotency-check.ts        | `{ voucher_id, order_id }`                                 | `{ already_processed:bool }`                                                             | assert                     | VoucherEngine `list VoucherUsageLog`                                                            | —                                                                                                            | —                                    | — (stop if processed)                                                       |
| atomicIncrementStep       | steps/atomic-increment.ts         | `{ voucher_id, customer_id, per_user_limit, usage_limit }` | `{ incremented:bool }`                                                                   | idempotency                | —                                                                                               | VoucherEngine: conditional `usage_count++` + per-user guard in txn (§14.3); Locking `voucher:redeem:{v}:{c}` | — (txn rollback is the compensation) | capacity-exhausted → no throw; flag for review (§18.4-5)                    |
| createUsageLogStep        | steps/create-usage-log.ts         | `UsageLogSnapshotDTO (§5.2)`                               | `{ usage_log_id }`                                                                       | atomicIncrement (same txn) | —                                                                                               | VoucherEngine: `create VoucherUsageLog` (append-only §5.2)                                                   | txn rollback                         | unique-violation on `(voucher_id,order_id)` → treated as idempotent success |

**Admin workflows (§11.6–11.9)**

| Step                                                | File                                  | Input Type                                | Output Type                                  | Dependencies           | Reads                             | Mutations                                                                 | Compensation                               | Errors                                 |
| --------------------------------------------------- | ------------------------------------- | ----------------------------------------- | -------------------------------------------- | ---------------------- | --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------- |
| validateVoucherConfigStep                           | steps/validate-voucher-config.ts      | `CreateVoucherDTO / Partial<...>`         | `{ valid: true }`                            | —                      | VoucherEngine `list` (uniqueness) | —                                                                         | —                                          | `MedusaError.INVALID_DATA` (400)       |
| normalizeVoucherCodeStep                            | steps/normalize-voucher-code.ts       | `{ code }`                                | `{ normalized_code }`                        | validate               | VoucherEngine `list` by code      | —                                                                         | —                                          | conflict (409) if code taken           |
| createBackingPromotionStep                          | steps/create-backing-promotion.ts     | `CreateVoucherDTO + scopes`               | `{ promotion_id }`                           | normalize              | —                                 | Promotion: `createPromotionsWorkflow` (§14.2-A)                           | `delete` created Promotion                 | `[NV #3]` create signature             |
| createVoucherConfigStep                             | steps/create-voucher-config.ts        | `CreateVoucherDTO + promotion_id`         | `{ voucher_id }`                             | createBackingPromotion | —                                 | VoucherEngine `create VoucherConfig` (+`promotion_id`)                    | `delete VoucherConfig`                     | —                                      |
| createVoucherScopesStep                             | steps/create-voucher-scopes.ts        | `{ voucher_id, scopes: ScopeInputDTO[] }` | `{ scope_ids: string[] }`                    | createConfig           | —                                 | VoucherEngine `create VoucherScope[]`                                     | `delete VoucherScope[]`                    | —                                      |
| assertVoucherExistsStep                             | steps/assert-voucher-exists.ts        | `{ id }`                                  | `{ voucher: VoucherConfigDTO, prev_scopes }` | —                      | VoucherEngine `retrieve`          | —                                                                         | —                                          | `VOUCHER_NOT_FOUND` (404)              |
| applyVoucherUpdateStep                              | steps/apply-voucher-update.ts         | `{ id, patch, scopes_diff }`              | `{ voucher }`                                | assert, validate       | —                                 | VoucherEngine `update` + scope create/delete                              | restore prev field values + prev scope set | `MedusaError.INVALID_DATA`             |
| syncBackingPromotionStep                            | steps/sync-backing-promotion.ts       | `{ promotion_id, changed_fields }`        | `{ synced:bool }`                            | applyVoucherUpdate     | —                                 | Promotion: `updatePromotionsWorkflow` mapped fields (§11.7)               | restore Promotion's prev mapped fields     | `[NV #3]` update signature             |
| deactivateVoucherStep                               | steps/deactivate-voucher.ts           | `{ id }`                                  | `{ voucher }`                                | assert                 | —                                 | VoucherEngine `update is_active=false`                                    | `update is_active=true`                    | —                                      |
| deactivateBackingPromotionStep                      | steps/deactivate-backing-promotion.ts | `{ promotion_id }`                        | `{ disabled:bool }`                          | deactivateVoucher      | —                                 | Promotion: disable via `updatePromotionsWorkflow`; **UsageLog untouched** | re-enable Promotion                        | `[NV #3]`                              |
| validateCapStep                                     | steps/validate-cap.ts                 | `{ max_discount_percentage:int }`         | `{ valid: true }`                            | —                      | —                                 | —                                                                         | —                                          | `INVALID_DATA` if out of 1..10000      |
| upsertActiveCapStep                                 | steps/upsert-active-cap.ts            | `{ max_discount_percentage, updated_by }` | `{ cap_id }`                                 | validateCap            | DiscountCapConfig `list`          | deactivate prev + create/update active `DiscountCapConfig`                | restore prior active record + value        | —                                      |
| invalidateVoucherCacheStep / invalidateCapCacheStep | steps/invalidate-cache.ts             | `{ code? \| 'cap' }`                      | `{ invalidated:bool }`                       | (last)                 | —                                 | Redis `del` key(s) (§14.4)                                                | —                                          | swallow Redis error (fail-open, §14.5) |

---

## 12. API Routes

Store routes require the publishable API key (SDK handles it); admin routes require admin auth (use `AuthenticatedMedusaRequest`, skill `type-authenticated-request`). Routes are thin: validate → run workflow → map result/error to envelope (skill `arch-workflow-required`, `logic-workflow-validation`).

| Method + path                       | Handler                            | Workflow                                     | SRS / Flow           |
| ----------------------------------- | ---------------------------------- | -------------------------------------------- | -------------------- |
| `POST /store/cart/voucher`          | apply/replace                      | `applyVoucherWorkflow`                       | VOUCH-001, §7.1/§7.2 |
| `DELETE /store/cart/voucher`        | remove                             | `removeVoucherWorkflow`                      | VOUCH-004, §13.2     |
| `GET /store/customer/vouchers`      | list vouchers for current customer | read-only (`query.graph`, no workflow)       | §6.2, §7.1           |
| `POST /admin/vouchers`              | create                             | `createVoucherWorkflow` (§11.6)              | §6.2, §7.6           |
| `GET /admin/vouchers`               | list                               | read-only                                    | §7.6                 |
| `GET /admin/vouchers/:id`           | retrieve                           | read-only                                    | §7.6                 |
| `POST /admin/vouchers/:id`          | update                             | `updateVoucherWorkflow` (§11.7)              | §6.2, §7.6           |
| `DELETE /admin/vouchers/:id`        | deactivate (soft)                  | `deactivateVoucherWorkflow` (§11.8)          | §7.6                 |
| `GET /admin/vouchers/:id/analytics` | usage/discount stats               | read-only aggregation over `VoucherUsageLog` | §6.2                 |
| `GET /admin/discount-cap`           | read active cap                    | read-only (`DiscountCapConfig` active row)   | §5.2, §5.3           |
| `POST /admin/discount-cap`          | update global cap                  | `updateDiscountCapConfigWorkflow` (§11.9)    | §5.2, EC-01/EC-03    |

**Admin update:** SRS §6.1/§6.2 imply update via PUT. Skill mandates no PUT/PATCH. `[CONFLICT-4]` → this spec uses **`POST /admin/vouchers/:id`** (and `POST /admin/discount-cap`) for updates rather than PUT, to satisfy the skill; existing `suggestion-rules` PUT is a pre-existing divergence, not a precedent to copy. Confirm at sign-off.

Rate limiting on `POST /store/cart/voucher` is enforced inside the workflow (step 2) so the cooldown check shares the normalized-code context; a route-level middleware alternative is possible but not required.

Register body validators in `api/middlewares.ts` (verified pattern — `apps/backend/src/api/middlewares.ts` uses `defineMiddlewares` + `validateAndTransformBody`; note zod is **v4.2.0** per `package.json`, so use zod-v4 schema APIs) for `POST /store/cart/voucher`, `POST /admin/vouchers`, `POST /admin/vouchers/:id`, and `POST /admin/discount-cap`.

---

## 13. Subscribers & Events

Two subscribers only. Cache invalidation is **not** a subscriber — it is inlined into the admin workflows (§14.4), so §13.4 (old) is dropped. Revalidation is a **combination of synchronous + subscriber** (§11.5); this section covers the subscriber half.

### 13.1 `voucher-cart-updated.ts` — `cart.updated` (external cart mutations)

```ts
export const config: SubscriberConfig = { event: "cart.updated" };
```

Handler resolves the cart id from `data.id`, runs `revalidateVoucherWorkflow` (§11.3). Catches & logs errors (never throws — skill best-practice 2). Covers the mutations VoucherEngine does **not** own: item add/remove, qty change, variant change, suggestive-selling adds (§11.5). Voucher-owned flows revalidate **synchronously** and do not depend on this event.

**Loop-guard (load-bearing):** `revalidateVoucherWorkflow` updates cart totals, which may re-emit `cart.updated`. The workflow exits before mutating when its input marker equals `cart.metadata.voucher._revalidation_marker` (§11.5). Without this guard the subscriber can self-trigger indefinitely.

- `[NEEDS_VERIFICATION #5]` — that `cart.updated` fires for **every** relevant mutation and does **not** fire (or is guarded) for the totals-update our own workflow performs; and its exact payload shape (`data.id` assumed). Event **name** is documented in the medusa-dev skill (`reference/subscribers-and-events.md` Cart Events); payload/coverage unverified against installed source. (PD-03, PD-09.)

### 13.2 `voucher-order-placed.ts` — successful-order event (redemption trigger)

```ts
export const config: SubscriberConfig = { event: "order.placed" };
```

Runs `recordVoucherUsageWorkflow` (§11.4) with `order_id = data.id`. Idempotent (unique constraint + pre-check, §14.3), so duplicate delivery is safe. **This subscriber is the FALLBACK/repair path** — the primary redemption trigger is a synchronous completion hook (§13.3).

**Successful-order event — status `[NEEDS_VERIFICATION #6]`.** Verified: cart completion runs **`completeCartWorkflow`** and produces an order whose id is the completion `result.id` (`carts/[id]/complete/route.js`). The event **id string** and payload are defined in the transitive `@medusajs/utils` / `@medusajs/core-flows` (unreachable this pass — `framework/utils` only re-exports `@medusajs/utils`). So the literal name is **not** yet confirmed; candidate `order.placed` (medusa-dev skill reference). Because the **primary** trigger is the sync hook (§13.3), the fallback subscriber's unconfirmed event name no longer gates redemption — if the name is wrong the fallback simply never fires, while the primary hook still records usage. Confirm (a) the event id, (b) fires-once, (c) `data.id` = order id, against `@medusajs/utils` `OrderWorkflowEvents`/`completeCartWorkflow` emissions.

### 13.3 Cart→Order propagation + redemption trigger — VERIFIED propagation; sync hook PRIMARY

**Propagation — Technically Verified.** The voucher discount is a Promotion-driven **line-item adjustment** (§14.2-A), and the order carries `*items.adjustments` plus the same computed `discount_total`/`item_subtotal` (verified: `orders/query-config.js`). Therefore the voucher discount and its identifying `adjustment.code` / `promotion_id` **survive cart→order natively** — no dependency on `cart.metadata` propagation. `recordVoucherUsageWorkflow`'s `assertOrderHasVoucherStep` resolves the voucher by reading the **order's** adjustments/promotions (`items.adjustments[].code` / `promotion_id` → `VoucherConfig`), which is authoritative and verified to exist. `order.metadata` is available too (verified) and may carry the auxiliary snapshot, but is not required.

**Redemption trigger — sync hook PRIMARY, subscriber FALLBACK (resolves the "sync vs subscriber" correction):**

- **Primary (synchronous):** add a step/hook to the **`completeCartWorkflow`** so redemption (`recordVoucherUsageWorkflow` logic: idempotency check → atomic increment → usage-log insert, §14.3) runs **as part of successful order placement**, in the completion transaction. This is deterministic, ordered, and does not depend on the async event name. It fires exactly when the order is truly placed (Rule 13). `[NEEDS_VERIFICATION #6a]` — whether `completeCartWorkflow` exposes a consumable hook point (e.g. a `.hooks.*` such as an order-created hook) or must be extended by composing a wrapping workflow; verify in `@medusajs/core-flows`.
- **Fallback / repair (asynchronous):** the `order.placed` subscriber (§13.2) re-runs the same idempotent workflow. It covers orders created by paths that bypass the hook (e.g. admin/draft-order completion) and any missed hook execution. Because both paths share the `(voucher_id, order_id)` unique guard (§14.3), running both is safe — at most one redemption is recorded.
- If `[NV #6a]` shows no usable hook, the subscriber becomes primary and `[NV #6]` (event name) is promoted back to a redemption-slice blocker; documented so the fallback plan is explicit.

Net: propagation is **verified**; the redemption slice is **Ready after minor verification** (`[NV #6/#6a]`), no longer `BLOCKED`.

---

## 14. Redis Usage, Rate Limiting, Idempotency, Concurrency

Redis is **optional** in this repo — verified (repo): `medusa-config.ts` loads `@medusajs/cache-redis`, `@medusajs/event-bus-redis`, `@medusajs/workflow-engine-redis` under `key: Modules.CACHE / EVENT_BUS / WORKFLOW_ENGINE` **only when `REDIS_URL` is set**, otherwise Medusa's in-memory defaults apply. Redis is **never** the source of truth (Rule 20; Solution Flow §16.1).

**Access pattern `[NEEDS_VERIFICATION #9]`:** the cache module (`Modules.CACHE`, resolvable in workflow steps via the container) covers §14.4 caching cleanly, but it exposes only get/set/invalidate — it does **not** expose atomic `INCR`/`EXPIRE`/`SETNX`, which the rate-limiter (§14.1) and any optional lock (§14.2) need. Confirm whether this project standardises on (a) a thin dedicated `ioredis` client resolved from `REDIS_URL` for atomic ops, or (b) the cache module for cache + a separate client for counters. Recommendation: (b). The atomic-op client must degrade per §14.5 when `REDIS_URL` is unset.

### 14.1 Brute-force protection — RESOLVED (§7.8, SEC-02, EC-10)

**Algorithm (fixed 15-min window via TTL; simplest correct form):**

1. On an apply request, build the identity key (below) and read cooldown key first. If cooldown key exists → reject immediately with `VOUCHER_RATE_LIMITED` (429) and a `retry_after` derived from key TTL. No validation runs.
2. Otherwise run apply-time validation (§9.0). On a **security-relevant failure only** (`VOUCHER_NOT_FOUND`; §9.3): `INCR attempts_key`; if the INCR result is `1`, `EXPIRE attempts_key 900` (15 min). This makes the counter a **fixed 15-minute window** anchored at the first failure (chosen over a sliding log for simplicity and O(1) memory; documented trade-off — a burst straddling a window boundary can allow up to ~2×threshold, acceptable for MVP).
3. If the INCR result `>= threshold (5)` → `SET cooldown_key 1 EX 1800` (30 min) and `DEL attempts_key`; return `VOUCHER_RATE_LIMITED`.
4. On a **successful apply** → `DEL attempts_key` (do not touch cooldown; a success while cooling down is impossible because step 1 rejects first).

**Configurable** (env or DiscountCapConfig-adjacent config): `VOUCHER_RL_THRESHOLD=5`, `VOUCHER_RL_WINDOW_SEC=900`, `VOUCHER_RL_COOLDOWN_SEC=1800`.

**Key patterns (§16.4 intent → concrete):**

| Purpose         | Key                              | Value             | TTL             |
| --------------- | -------------------------------- | ----------------- | --------------- |
| Failed attempts | `voucher:rl:attempts:{identity}` | integer count     | 900s (window)   |
| Cooldown        | `voucher:rl:cooldown:{identity}` | `1`               | 1800s           |
| Config lookup   | `voucher:cfg:{normalized_code}`  | serialized config | 60s (see §14.4) |
| Cap config      | `voucher:capcfg:active`          | serialized cap    | 60s             |

Concurrency locks are **not** Redis `SETNX` keys — they use the **Locking Module** (`Modules.LOCKING`, §14.2-C / §14.3) with keys `voucher:cart:{cart_id}` and `voucher:redeem:{voucher_id}:{customer_id}`. The rate-limit counters above still need atomic `INCR`/`EXPIRE`; those use the dedicated atomic client (`[NV #9]`), independent of the lock provider.

**Identity strategy — RESOLVED (recommended):** `identity = customer_id` when the request is authenticated, else `sess:{session_id}` for guests. IP is **logged** for monitoring (SEC-02) but **not** the primary throttle key, to avoid shared-network / CGNAT false positives. `[NEEDS_VERIFICATION #7]` — how the store request exposes session id and customer id in 2.16 (same source needed for `cart_id`, §8.1). Uniform `VOUCHER_RATE_LIMITED` response regardless of code validity (§7.8 — no oracle).

### 14.2 Cart↔voucher association + concurrency — mechanism VERIFIED, sub-flow binding pending

Status: **Technically Verified** (the discount must be an adjustment carried by a Promotion, applied through the cart-promotions workflow, to be in authoritative totals) + **Technical Strategy Resolved — Business Approval Pending** (how VoucherEngine's cap-adjusted amount maps onto a Promotion) + narrow **`[NEEDS_VERIFICATION]`** (exact create/add-promotion input signatures).

**(A) How the discount is persisted in authoritative Cart totals — VERIFIED mechanism = Promotion-driven adjustment.**

Evidence (verified, files in top note): the store cart totals (`subtotal`, `discount_total`, `discount_subtotal`, `item_discount_total`, `total`, `original_item_subtotal`) are **computed fields** returned by `query.graph` (`carts/query-config.js`), and the **only** way a discount enters them is a line-item **adjustment** (`items.adjustments.{amount, promotion_id, code, is_tax_inclusive}`), which is produced by applying a **Promotion** to the cart via `updateCartPromotionsWorkflowId` + `PromotionActions.ADD/REMOVE/REPLACE` (`carts/[id]/promotions/route.js`). `cart.metadata` is a **separate, non-computed** field — it does **not** participate in total computation. Therefore:

- **Selected:** the voucher discount is represented as a **Medusa Promotion** whose adjustment lands in `items.adjustments`, so Cart, checkout, payment, and Order totals are all consistent and it **propagates to the Order** (verified: order carries `*items.adjustments` + same `discount_total`, `orders/query-config.js`).
- **Rejected — metadata-only / custom response total:** `cart.metadata` does not feed authoritative totals (verified); a discount kept only in metadata would diverge from the stored cart/order `total` at payment and completion. Metadata is retained **only** as an auxiliary, non-authoritative snapshot for messaging (`{ voucher_id, code, original_discount, was_capped }`) — never as the source of the amount.
- **Rejected — direct standalone line-item adjustment without a Promotion:** the shipped adjustment shape ties adjustments to a `promotion_id`, and the supported cart mutation path is the promotions workflow; hand-writing adjustments outside a Promotion is not an evidenced supported path.

**Promotion shape (VERIFIED fields, `admin/promotions/query-config.js`):** `code`, `type`, `is_automatic`, `limit`/`used` (native usage limit + counter), `status`, `application_method.{type,value,target_rules,buy_rules}`, `rules.{attribute,operator,values}`, `campaign.budget`. This natively covers several voucher features: **scope** (V6) via `application_method.target_rules`, **min-order** (V5) via `rules`, **global usage limit** (V3) via `limit`/`used`, **code** (V1) and **percentage/fixed** via `application_method.type/value`.

**How VoucherEngine's cap-adjusted amount maps onto the Promotion — Strategy Resolved, signature `[NEEDS_VERIFICATION #3]`:** VoucherEngine still owns the cross-source **global cap** and the exact §10 math, which the promotion engine cannot express. Approach:

- Admin `createVoucherWorkflow` (§11.6) **provisions a backing Promotion** (via the core-flows create-promotion workflow) for the natively-expressible parts and stores its id on `VoucherConfig.promotion_id`.
- At apply, VoucherEngine runs V1–V8 + §10 (incl. global cap) → `final_voucher_discount`, then applies the discount to the cart through `updateCartPromotionsWorkflow`. Because the cap makes the amount **cart-specific**, the promotion is applied as a **fixed-amount** effect equal to `final_voucher_discount` (cart-level allocation) rather than letting the engine recompute a percentage — this keeps VoucherEngine's math authoritative while using the native adjustment pipeline.
- `[NEEDS_VERIFICATION #3]` — the exact input signatures of `createPromotionsWorkflow` / `addPromotionsToCartWorkflow` / `updateCartPromotionsWorkflow` and whether a per-cart fixed override is expressible, OR whether a short-lived per-cart promotion must be created. Verify in `@medusajs/core-flows` (`dist/definitions/.../cart|promotion/*`) when reachable. This is the **only** remaining binding for apply/remove; the _mechanism_ (promotion adjustment in authoritative totals) is verified.

**Apply / replace / remove / revalidation behavior on this mechanism:**

- **Apply:** validate + compute → `updateCartPromotionsWorkflow ADD` with the voucher code (amount = `final_voucher_discount`). Cart totals recompute natively. Write the auxiliary metadata snapshot.
- **Replace (VOUCH-001):** the new voucher is validated/computed first; only on success is the old voucher's promotion swapped (`REPLACE`, or `REMOVE` old + `ADD` new in one workflow) so a failed new voucher leaves the old promotion intact (Solution Flow §7.2, §18.4-3).
- **Remove:** `updateCartPromotionsWorkflow REMOVE` with the code; totals recompute without it; no usage change (Rule 12/13).
- **Revalidation (§11.3):** on `cart.updated`, recompute; if still valid re-apply the (possibly new) amount via `updateCartPromotionsWorkflow`; if invalid `REMOVE` + `VOUCHER_AUTO_REMOVED`.
- **Compensation / recalculation:** because totals are **always recomputed by the Cart module from source** after any promotion add/remove (verified: computed fields), compensation is simply "remove the voucher promotion and let the cart recompute" — VoucherEngine **never writes back a captured numeric total** (Rule 18/INT-03). This satisfies "compensation must not restore stale totals".
- **Remaining limitation:** representing a percentage voucher whose amount is later reduced by the global cap means the applied promotion is a computed fixed amount, so the stored promotion adjustment reflects the capped number, not the nominal percentage — acceptable and correct for totals; the nominal percentage is preserved on `VoucherConfig` for display.

**(B) Where active-voucher state lives.** The **authoritative** state is the backing Promotion + its cart adjustment (above). `cart.metadata.voucher` holds only the **auxiliary snapshot** for messaging and a `_revalidation_marker` (§11.5). It is **not** relied on for the amount, and — per the "do not call it fixed until propagation verified" correction — nothing in redemption depends on `cart.metadata` propagating to the order: redemption reads the voucher from the **order's adjustments/promotions** (verified propagation, §13.3).

**(C) EC-04 concurrency — RESOLVED using the Locking Module + latest-state recompute (not `updated_at` alone).** A bare pre-write `updated_at` re-read is a TOCTOU check with a race window between the read and the write; it is **not** sufficient. Resolved strategy (Solution Flow §7.7, PD-04):

1. **Serialize the critical section with the Locking Module** — `@medusajs/locking` is a verified dependency (`Modules.LOCKING`, with postgres/redis providers). `applyVoucherWorkflow` / `revalidateVoucherWorkflow` acquire a lock keyed `voucher:cart:{cart_id}` (short TTL) around the read→compute→apply-promotion section, so two voucher operations on one cart cannot interleave. Provider falls back to postgres when Redis is absent (Redis-optional, §14.5) — so this is **not** a Redis-only mechanism.
2. **Recompute against the latest cart inside the lock** — re-read the cart at the top of the locked section (not a cached snapshot) and run cart-dependent validation + §10 on that; then apply via `updateCartPromotionsWorkflow`. The promotion apply is itself the conditional write: it operates on the current cart the workflow engine sees.
3. **Cart-completion is separately guarded by Medusa** — verified: `completeCartWorkflow` rejects concurrent completion with `MedusaError.CONFLICT` (`transaction.hasFinished()`), so a voucher change racing a completion cannot half-apply.
4. If a cart mutation still lands between the recompute and the apply, the subsequent `cart.updated` revalidation (§11.5) re-runs and converges (removes/recalculates) — the system is **self-correcting**, and the lock keeps the common case consistent.
5. **Compensation re-derives, never restores stale totals** (Rule 18): compensation removes the voucher promotion and lets the cart recompute (§11.10 tables).

`[NEEDS_VERIFICATION #3a]` — exact `Modules.LOCKING` service API (`acquire`/`execute`/`release` signatures, default provider wiring) in 2.16; strategy is fixed, only the call shape is pending.

### 14.3 Atomic redemption & idempotency — RESOLVED (PD-05, INT-02, INT-04, D-06)

Two independent durable guards, both in PostgreSQL (Redis never authoritative):

- **Idempotency (over-processing guard):** unique DB index `(voucher_id, order_id)` on `VoucherUsageLog` (§5.2) **plus** the `idempotencyCheckStep` pre-check. A duplicate `order.placed` either short-circuits at the pre-check or, on a genuine race, fails the unique insert — both are treated as **idempotent success**, no second increment (Rule; §18.4-5). This is the primary guard and needs no Redis.
- **Over-redemption guard (atomic increment) — global:** in a single DB transaction —
  1. conditional update: `UPDATE voucher_config SET usage_count = usage_count + 1 WHERE id = :id AND (usage_limit IS NULL OR usage_count < usage_limit)`; if `0 rows affected` → global capacity exhausted at redemption.
  2. re-check per-user (see next bullet for concurrency).
  3. insert `VoucherUsageLog` (append-only snapshot, §5.2).
     All in one transaction so `usage_count` and the log commit atomically; the conditional `WHERE` prevents the read-check-write race under concurrent successful orders (SRS INT-02 / Solution Flow §7.5 "must not read→check→increment later").
- **Per-user limit — concurrency-safe (RESOLVED):** a plain `SELECT count(*) … < per_user_limit` before insert is a TOCTOU race (two concurrent orders by the same customer both read `count = limit-1`). Make it safe by **either** (preferred) serializing per (voucher, customer) with the **Locking Module** (`Modules.LOCKING`, verified dep) key `voucher:redeem:{voucher_id}:{customer_id}` around the count-check+insert, **or** enforcing it structurally with a conditional insert that fails when the limit is reached (e.g. insert guarded by `WHERE (SELECT count(*) …) < :per_user_limit`, or a partial unique index when `per_user_limit = 1`). Both close the window; the lock generalizes to any limit. The `(voucher_id, order_id)` unique index still guarantees one redemption per order regardless.
- **Backing-promotion counter (defense in depth):** the voucher's backing Medusa Promotion (§14.2-A) has a native `limit`/`used` counter that Medusa increments on completion; it provides a second over-redemption guard, but **`VoucherUsageLog` + `VoucherConfig.usage_count` remain the authoritative audit** per SRS INT-02/INT-04 (do not depend on the promotion counter for the audit trail).
- **Capacity-exhausted recovery — RESOLVED:** do **not** write an invalid log; **log-and-alert for operational review**, order stands (the customer already paid the discounted total — reversing at redemption would be worse). No automatic compensation. Approved resolution of the §11.4 step-5 open item.
- **`[NEEDS_VERIFICATION #10]`** — exact 2.16 mechanism for a raw conditional `UPDATE` + manual transaction inside a module service (MikroORM `EntityManager` `nativeUpdate` within `em.transactional(...)`, resolved from the module's manager), and the `Modules.LOCKING` API shape (shared with #3a). Strategy fixed; only the API binding is pending.

### 14.4 Caching — RESOLVED scope (PD-12)

- **Safe to cache (short TTL 60s):** `VoucherConfig` by normalized code (`voucher:cfg:{code}`), `DiscountCapConfig` (`voucher:capcfg:active`). Read-heavy, low-change (Solution Flow §16.2).
- **Never cache:** full apply result, cart totals, eligible-item result, live `usage_count`/redemption count (Solution Flow §16.2). Cart is authoritative.
- **No cart-dependent validation cache (PD-12 resolved):** because eligibility/min-order/stacking depend on live cart+promotion state, no validation result is cached and there is no cart-version cache key to reason about. The SRS "30s validation cache" (CONFLICT-5) is **rejected** for correctness; only config/cap are cached.
- **Invalidation (§16.3 → concrete):** `createVoucherWorkflow` / `updateVoucherWorkflow` / `deactivateVoucherWorkflow` (§11.6–11.8) call `invalidateVoucherCacheStep` → `DEL voucher:cfg:{code}` (old and new code on rename). `updateDiscountCapConfigWorkflow` (§11.9) → `DEL voucher:capcfg:active`. A dedicated cache-invalidation subscriber is **not required** — invalidation is inlined into the admin workflows that cause the change (simpler, no event round-trip); the optional `voucher-config-cache-invalidate.ts` subscriber (§13.4) is dropped unless config can change outside these workflows.

### 14.5 Redis-unavailable fallback — RESOLVED per use case (PD-11)

| Use case                        | Behavior when `REDIS_URL` unset / Redis errors                                                                                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rate limiting (§14.1)           | **Fail-open** — allow the apply, log a warning. Availability for real customers beats throttling a hypothetical attacker while infra is down (documented security trade-off; confirm at sign-off).                                                                                               |
| Config / cap cache (§14.4)      | **Fail-open to DB read** — cache miss semantics; correctness unaffected (DB authoritative).                                                                                                                                                                                                      |
| Concurrency locks (§14.2/§14.3) | **Not Redis-dependent** — the Locking Module has a **postgres provider** (`@medusajs/locking-postgres`, verified dep) usable without Redis, so locks still function; if locking is disabled entirely, the `cart.updated` revalidation (§11.5) and the DB guards (§14.3) keep the system correct. |
| Redemption coordination (§14.3) | **Unaffected** — the durable DB unique constraint + conditional update are authoritative and never depend on Redis.                                                                                                                                                                              |

Redis loss therefore degrades _protection/latency_, never _correctness or money_.

---

## 15. Migrations

- Do **not** hand-write migrations. Generate with the module's `db:generate` (skill `db-generate`) after models are defined; snapshot + migration land in `src/modules/voucher-engine/migrations/` (mirrors `suggestive-selling/migrations/*`).
- Command (from `apps/backend/`): `npx medusa db:generate voucherEngine` then `npx medusa db:migrate`. `[NEEDS_VERIFICATION — exact db:generate argument: module name vs module folder]`.
- Links may require running migrations after link definition (skill checklist: "Skipping migrations after creating module links"). The read-only links here create no new table (like the existing product link), but run `db:migrate` to be safe.
- Seed: `src/scripts/seed-vouchers.ts`, idempotent, default-exports `async ({ container }: ExecArgs)`, run via `npx medusa exec ./src/scripts/seed-vouchers.ts` (repo convention). Seeds one active `DiscountCapConfig` (50% = 5000 bps) and sample vouchers; resolves product/category ids by handle/name (runs after catalog seed, like `seed-suggestive-selling.ts`).

---

## 16. Test Plan

Framework: Jest via `TEST_TYPE` (verified). Naming per `.claude/rules`: unit `*.unit.spec.ts` in `__tests__/`; module integration in `src/modules/voucher-engine/__tests__/`; HTTP in `integration-tests/http/*.spec.ts`. **Create `integration-tests/setup.js`** (missing) before HTTP tests can run.

### 16.1 Unit (pure logic — no I/O) — `TEST_TYPE=unit`

| Test                                                              | Validates                   | SRS/Flow |
| ----------------------------------------------------------------- | --------------------------- | -------- |
| normalize-code: trim + uppercase; case-insensitive                | Rule 2                      | §7.1     |
| money: percentage floor, no float, integer only                   | INT-01, Rule 19             | §9.4     |
| calc: 10.4 under-cap reproduces 380,000 / 3,420,000               | VOUCH-003 happy, T-VOUCH-07 | §9.6     |
| calc: 10.5 cap-exceeded reproduces 490,000 / 2,350,000            | VOUCH-003 cap, T-VOUCH-08   | §9.7     |
| calc: EC-03 50%+50% clamps ≥1 VND, warning                        | EC-03, T-VOUCH-09           | §9.4     |
| calc: fixed voucher can't exceed eligible subtotal                | §22.2                       | §9.4     |
| calc: voucher max_discount_amount caps before global              | Rule 8, T-VOUCH: max amount | §9.3     |
| calc: item promo consumes entire cap → final voucher = 0          | §22.2                       | §9.5     |
| validate: each V1–V8 branch returns correct code, fail-fast stops | V1–V8, T-VOUCH-02..06       | §8, D-03 |

### 16.2 Module integration — `TEST_TYPE=integration:modules` (`src/modules/voucher-engine/__tests__/`)

Uses `@medusajs/test-utils` (present, v2.16.0 — verified repo, `package.json` devDeps) module test runner `[NEEDS_VERIFICATION #12 — exact 2.16 module test-runner import name]`.

- CRUD on VoucherConfig/UsageLog/DiscountCapConfig/VoucherScope.
- Unique `(voucher_id, order_id)` constraint rejects duplicate usage log (idempotency).
- Atomic conditional increment does not exceed `usage_limit` under sequential calls (concurrency-adjacent, T-VOUCH usage).

### 16.3 HTTP integration — `TEST_TYPE=integration:http` (`integration-tests/http/`)

Uses `medusaIntegrationTestRunner` `[NEEDS_VERIFICATION #12 — exact import in 2.16]`.
| Test | Validates |
|---|---|
| apply valid voucher → discount, total updated (SHUTTLE20 scenario) | VOUCH-001, T-VOUCH-01 |
| invalid code → `VOUCHER_NOT_FOUND` + Vietnamese message; cart unchanged | V1, T-VOUCH-02 |
| expired → `VOUCHER_EXPIRED` with date | V2, T-VOUCH-03 |
| per-user limit reached → `VOUCHER_USER_LIMIT_REACHED` | V4, T-VOUCH-04 |
| below min → `VOUCHER_MIN_ORDER_NOT_MET` + remaining | V5, T-VOUCH-05 |
| no eligible items → `VOUCHER_NO_ELIGIBLE_ITEMS` | V6, T-VOUCH-06 |
| remove voucher → totals reverted, no usage increment | VOUCH-004, T-VOUCH-10 |
| remove eligible items after apply → auto-removed (subscriber) | VOUCH-005/EC-02, T-VOUCH-11 |
| 5 failed attempts → `VOUCHER_RATE_LIMITED` (429) | SEC-02/EC-10, T-VOUCH-12 |
| replace flow: new fails → old remains | §7.2, §22.1 |
| admin create voucher → persisted | §7.6 |

### 16.4 Subscriber / event tests

- `order.placed` delivered twice → single usage log, single increment (idempotency, §22.4).
- `cart.updated` after cart drops below min → voucher auto-removed with reason (§22.3).

### 16.5 Concurrency tests

- concurrent successful redemptions near `usage_limit` → limit not exceeded (SRS §10 usage). Strategy RESOLVED (§14.3); depends on txn binding `[NV #10]`.
- apply voucher while last eligible item removed (EC-04) → no stale voucher persisted. Strategy RESOLVED (§14.2-C); depends on marker field `[NV #3a]` + attach mechanism `[NV #3]`.

### 16.6 Redis-fallback tests

- rate-limit with Redis unavailable → fail-open per §14.5. Strategy RESOLVED; depends on Redis client `[NV #9]`.

---

## 17. SRS Traceability Matrix

| SRS ref                               | Covered by (this spec)                                |
| ------------------------------------- | ----------------------------------------------------- |
| VOUCH-001 apply / replace             | §8.1, §11.1, §12                                      |
| VOUCH-002 V1–V8                       | §9, §8.4, D-03                                        |
| VOUCH-003 stacking + cap              | §10                                                   |
| VOUCH-004 remove                      | §11.2, §12                                            |
| VOUCH-005 auto-invalidation           | §11.3, §13.1                                          |
| V1–V8 (each)                          | §9 table                                              |
| EC-01 promo+voucher near cap          | §10.5                                                 |
| EC-02 eligible items removed          | §11.3, §16.3                                          |
| EC-03 zero/negative total             | §10.2, §10.6, §16.1                                   |
| EC-04 concurrent apply/remove         | §14.2-C (RESOLVED strategy; #3a binding), §16.5       |
| EC-06 apply→remove→reapply            | Rule 12/13; §11.2; §9.2 (V3/V4 skipped at revalidate) |
| EC-08 new promo tier on cart change   | §11.3, §11.5 (promo recalc before voucher)            |
| EC-10 brute-force                     | §14.1 (RESOLVED algorithm), §16.3                     |
| SEC-01 server-side truth              | §3 (cart authoritative), §10 (server calc)            |
| SEC-02 brute-force cooldown           | §14.1 (identity RESOLVED; #7 binding)                 |
| SEC-03 code format (min6/alnum/upper) | §5.1 decision, §8.1 validator, §11.6 create-validate  |
| SEC-04 admin auth / customer-scoped   | §12 (`AuthenticatedMedusaRequest`, publishable key)   |
| INT-01 integer money                  | §3, §5, §10, §16.1                                    |
| INT-02 atomic usage count             | §14.3 (RESOLVED; #10 binding)                         |
| INT-03 recalc from source             | Rule 18; §10; §11.10 (compensation re-derives)        |
| INT-04 immutable usage log            | §5.2 (snapshot + append-only enforcement), §11.4      |
| API §6.2 endpoints                    | §12 (+ admin update, discount-cap routes)             |
| Admin create/update/deactivate/cap    | §11.6–§11.9, §12                                      |
| Data model §5.2                       | §5 (+ CONFLICT-1/2)                                   |
| Workflows §7.2/7.3/7.5/7.6            | §11.1/§11.3/§11.4/§11.6–§11.9                         |

### 17.1 Reverse test-ID → coverage map (SRS §10.2 acceptance tests)

Every acceptance test has a home; concurrency/redemption/fallback tests are gated on their binding `[NV]` (§19.2).

| Test ID    | Scenario (SRS §10.2)                   | Test file (§16)                  | Depends on |
| ---------- | -------------------------------------- | -------------------------------- | ---------- |
| T-VOUCH-01 | valid voucher applied → discount/total | §16.3 http apply-voucher         | #2,#3      |
| T-VOUCH-02 | invalid code → error, cart unchanged   | §16.1 validate unit + §16.3 http | —          |
| T-VOUCH-03 | expired → expiry error w/ date         | §16.1 validate unit              | —          |
| T-VOUCH-04 | per-user limit → usage error           | §16.1 validate unit + §16.3 http | —          |
| T-VOUCH-05 | below min → remaining shown            | §16.1 validate unit              | #2         |
| T-VOUCH-06 | no eligible items → scope error        | §16.1 validate unit              | #2         |
| T-VOUCH-07 | promo 20% + voucher 10% under cap      | §16.1 calc unit (§10.4)          | — (pure)   |
| T-VOUCH-08 | promo 40% + voucher 20% cap-exceeded   | §16.1 calc unit (§10.5)          | — (pure)   |
| T-VOUCH-09 | 50%+50% → cap prevents negative        | §16.1 calc unit (§10.6, EC-03)   | — (pure)   |
| T-VOUCH-10 | remove → reverted, no usage increment  | §16.3 http remove-voucher        | #3         |
| T-VOUCH-11 | remove eligible items → auto-removed   | §16.3 http + §16.4 subscriber    | #5         |
| T-VOUCH-12 | 5 failed attempts → rate limited (429) | §16.3 http + §16.6               | #7,#9      |

---

## 18. Conflicts (recorded, not silently changed)

- **[CONFLICT-1] "VoucherConfig extends Promotion" (SRS §5.2, §2.1).** Medusa v2 modules do not support entity inheritance / extending a core module's models; repo convention mandates **standalone modules + read-only links** (`.claude/rules`). **Resolution (now evidence-backed, Technical Strategy Resolved):** VoucherEngine is a standalone `voucherEngine` module that **provisions and references a backing Medusa Promotion** (`VoucherConfig.promotion_id` → read-only Link to Promotion, §5.1/§6). The discount is carried by that native Promotion as a cart/line-item adjustment (verified mechanism, §14.2-A), so it participates in authoritative Cart/Order totals — which honors the SRS's _intent_ behind "extends Promotion" (be a promotion for totals purposes) without model inheritance. Verified: promotion apply path (`updateCartPromotionsWorkflow`) and Promotion fields (`admin/promotions/query-config.js`). Needs business sign-off on the reinterpretation only.
- **[CONFLICT-2] Scope as array columns vs linkable rows (SRS §5.2 `applicable_*_ids uuid[]`).** Repo convention forbids DB FKs and wires cross-module refs via Link Module, which needs a linkable text field per reference. **Resolution proposed:** normalize scope into `VoucherScope` rows (§5.4) with read-only links. Business meaning unchanged. Needs sign-off (PD-13).
- **[CONFLICT-3] Percentage unit ambiguity.** SRS §5.2 uses basis points (`2000 = 20.00%`); worked examples state plain percents. Spec adopts basis points; confirm (§5.1, §10.3).
- **[CONFLICT-4] Admin update HTTP method.** SRS API table implies PUT; `medusa-dev` skill mandates GET/POST/DELETE only, and update should be POST. Existing `suggestion-rules` uses PUT (pre-existing divergence). Spec uses `POST /admin/vouchers/:id`. Needs sign-off (§12).
- **[CONFLICT-5] "Voucher validation results cache TTL 30s" (SRS §2.1 / §9.1) vs cart-dependent staleness.** Caching a full validation result is unsafe because cart/promotion/eligibility change (Solution Flow §16.2). Spec caches only config/cap (safe), not full validation/apply result (PD-12).

---

## 19. Pending Decisions Register + `[NEEDS_VERIFICATION]` Index

### 19.1 Pending Decisions (from Solution Flow §21)

| PD            | Topic                                              | Status in this SPEC                                                                                                                                                                                                                                                                                                      | Blocks impl of                               |
| ------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| PD-01         | Voucher↔Cart association + total representation    | **Technically Verified mechanism** — discount = Promotion-driven **adjustment** via `updateCartPromotionsWorkflow` → authoritative cart+order totals (§14.2-A); metadata-only rejected. **Strategy Resolved** for cap-adjusted amount. Residual `[NV #3]` = exact create/add-promotion signature                         | apply/remove promotion steps, §14.2-A        |
| PD-02         | Source of item-level promotion + line totals       | **Technically Verified fields** (`carts/query-config.js`): `original_item_subtotal`, `item_subtotal`, `item_discount_total`, `items.adjustments.{amount,promotion_id,code}`, `items.product_id`/`categories.id` (§10.7). Residual `[NV #2]` = `item_subtotal` inclusion semantics (mitigated by per-line adjustment sum) | `loadCartContextStep` adapter, §10.7         |
| PD-03         | Successful-order event / trigger + propagation     | **Propagation Technically Verified** (order carries `*items.adjustments`+`discount_total`, §13.3). **Trigger Resolved**: sync `completeCartWorkflow` hook primary, `order.placed` subscriber fallback. Residual `[NV #6/#6a]` = event id + hook point                                                                    | redemption trigger, §13.2/§13.3              |
| PD-04         | Cart concurrency mechanism                         | **RESOLVED** — **Locking Module** (`Modules.LOCKING`, verified dep, postgres fallback) around read→compute→apply + latest-read recompute (not `updated_at` alone); native completion CONFLICT guard verified (§14.2-C). Residual `[NV #3a]` = lock API shape                                                             | apply/revalidate, §14.2-C                    |
| PD-05         | Atomic usage-count strategy                        | **RESOLVED** — unique `(voucher_id,order_id)` + conditional `UPDATE … WHERE usage_count<usage_limit` + per-user re-check, one txn (§14.3). Txn API `[NV #10]`                                                                                                                                                            | `atomic-increment`/`create-usage-log`, §14.3 |
| PD-06         | Customer segment source (V7)                       | **Deferred (approved)** — V7 no-op passes when unconfigured; stub. Not a code blocker for V1–V6/V8                                                                                                                                                                                                                       | `validate` V7, §9.4                          |
| PD-08         | Applied voucher after admin deactivation           | **RESOLVED (recommended)** — remove on next `cart.updated` revalidation (V1 re-run, §9.2/§11.8). Business owner to confirm                                                                                                                                                                                               | §11.8, revalidate                            |
| PD-09         | Real-time storefront update after async subscriber | **Deferred (approved)** — MVP refetch/polling                                                                                                                                                                                                                                                                            | §13.1                                        |
| PD-11         | Redis-unavailable fallback                         | **RESOLVED** — per-use-case table (§14.5): fail-open rate-limit/cache/lock; redemption unaffected (DB authoritative)                                                                                                                                                                                                     | §14.5                                        |
| PD-12         | Validation cache scope                             | **RESOLVED** — config/cap only (60s TTL); no cart-dependent/validation cache (§14.4)                                                                                                                                                                                                                                     | §14.4                                        |
| PD-13         | Product/category scoping relationship              | **RESOLVED toward** read-only links on `VoucherScope`; category linkable key `[NV #4]` pending                                                                                                                                                                                                                           | §5.4, §6                                     |
| PD-14         | Error/exception → HTTP mapping                     | **RESOLVED** (§8.4 + §9.3 counted-failure list); 429 `MedusaError` support `[NV #8]` pending                                                                                                                                                                                                                             | §8.4, §9                                     |
| PD-07 / PD-10 | purchase-history source / promo-tier recalc        | Deferred / covered by §11.3, §11.5                                                                                                                                                                                                                                                                                       | —                                            |

**Net after pass 2:** the three previously-BLOCKED clusters are now **evidence-backed** from shipped `@medusajs/medusa/dist/api/**` code — **PD-01** (promotion-adjustment mechanism verified), **PD-02** (calc-input fields verified), **PD-03** (cart→order adjustment propagation verified; trigger resolved to sync hook + fallback). None remains wholesale-BLOCKED; each has only a **narrow `[NV]`** (a workflow-input signature, an event-id string, a field-inclusion semantic, or a lock/txn API shape) confirmable in the transitive `@medusajs/core-flows|utils|cart|order` packages once `Grep`/`Glob` are available. PD-04, PD-05, PD-08, PD-11, PD-12, PD-14 remain RESOLVED. PD-06, PD-07, PD-09, PD-10 deferred by approval.

### 19.2 `[NEEDS_VERIFICATION]` index — **framework binding verification, not SRS gaps**

Every item below is an **exact-API/signature binding** in an installed `@medusajs/*` package that this session could not reach (transitive packages behind pnpm peer-hashed paths; `Grep`/`Glob` disabled). **None is a missing or unmet SRS requirement** — the SRS behaviour is fully specified; only the framework call shape is pending. Confirm each against the named package (or MedusaDocs MCP) before writing that step. The load-bearing ones for the apply/redeem path are: backing-Promotion **create/update/apply** workflow input signatures (`#3`), the exact **per-cart fixed-discount** representation (`#3`), `completeCartWorkflow` **hook point** (`#6a`), successful-order **fallback event id + payload** (`#6`), **Locking Module** API (`#3a`), and **transaction / native-update** API (`#10`).

| #               | Item                                                                                                                                                                                                              | File/section to check against                                                                      | Referenced in  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------- |
| #1              | Percentage unit convention (basis points, `value/10000`)                                                                                                                                                          | SRS §5.2 sign-off (business, not code)                                                             | §5.1, §10.3    |
| #2              | **Field names VERIFIED** (`carts/query-config.js`). Residual: exact discount-inclusion semantics of `item_subtotal` / `item_discount_total` / `discount_total`                                                    | transitive `@medusajs/cart` totals calculator (mitigated: sum per-line `adjustments.amount`)       | §10.7          |
| #3              | **Mechanism VERIFIED** (promotion adjustment via `updateCartPromotionsWorkflow`). Residual: `createPromotions`/`addPromotionsToCart`/`updateCartPromotions` **input signatures** + per-cart fixed-amount override | transitive `@medusajs/core-flows` cart/promotion definitions                                       | §14.2-A        |
| #3a             | `Modules.LOCKING` service API (`acquire`/`execute`/`release`) + default provider wiring                                                                                                                           | `@medusajs/locking` (verified dep) / framework                                                     | §14.2-C, §14.3 |
| #4              | `ProductModule.linkable.productCategory` + `PromotionModule.linkable.promotion` linkable keys                                                                                                                     | `@medusajs/medusa/product`, `@medusajs/medusa/promotion` (subpaths verified)                       | §6             |
| #5              | `cart.updated` coverage of all mutations + whether `updateCartPromotions` no-op re-emits it                                                                                                                       | transitive `@medusajs/core-flows` cart events                                                      | §13.1, §11.5   |
| #6              | Successful-order **event id** (`order.placed`?), fires-once, `data.id` (fallback path only)                                                                                                                       | transitive `@medusajs/utils` `OrderWorkflowEvents` / `@medusajs/core-flows` `completeCartWorkflow` | §13.2          |
| #6a             | Whether `completeCartWorkflow` exposes a **hook** for the synchronous redemption step (primary)                                                                                                                   | transitive `@medusajs/core-flows` `completeCartWorkflow.hooks`                                     | §13.3          |
| #6b             | ~~Order-level adjustment shape~~ **VERIFIED**: order carries `*items.adjustments` + `discount_total` + `metadata` (`orders/query-config.js`) — no longer open                                                     | (resolved)                                                                                         | §13.3          |
| #7              | Store request session-id / customer-id / cart-id source                                                                                                                                                           | `@medusajs/framework/http` store request types                                                     | §8.1, §14.1    |
| #8              | `MedusaError` 429 mapping in 2.16 (else raw `res.status(429)`)                                                                                                                                                    | `@medusajs/framework/utils` errors                                                                 | §8.4           |
| #9              | Redis client access pattern (cache module vs dedicated `ioredis`) for atomic ops                                                                                                                                  | project infra / `@medusajs/cache-redis`                                                            | §14            |
| #10             | Raw conditional `UPDATE` / manual transaction in a module service                                                                                                                                                 | `@medusajs/framework` service ORM/manager (`em.transactional`/`nativeUpdate`)                      | §14.3          |
| #11             | `db:generate` argument (module name vs folder)                                                                                                                                                                    | `@medusajs/cli`                                                                                    | §15            |
| #11a            | Postgres immutability trigger coexists with generated migrations                                                                                                                                                  | `@medusajs/framework` migration behavior                                                           | §5.2           |
| #12             | `@medusajs/test-utils` module + HTTP test-runner imports (present, v2.16.0 — verified repo)                                                                                                                       | `@medusajs/test-utils` exports                                                                     | §16.2/§16.3    |
| #13             | "min 1 VND" clamp mandatory vs policy-flagged                                                                                                                                                                     | SRS EC-03 sign-off (business)                                                                      | §10.2          |
| #14             | Cart/line money fields returned as `BigNumberValue` (number vs `{value}`) — normalize via `money.toInt` before arithmetic/comparison                                                                              | `@medusajs/types` `BigNumberValue` / cart DTO                                                      | §23.0–§23.4    |
| #3 (createStep) | Workflow `createStep`/`StepResponse` + `updateCartPromotionsWorkflow` import & input shape for §23.3–23.5 steps                                                                                                   | `@medusajs/framework/workflows-sdk`, `@medusajs/core-flows`                                        | §23.3–§23.5    |

---

## 20. Implementation Order

Build bottom-up so each layer is testable before the next. Do **not** start any slice whose blocking PD (§19.1) is unresolved.

1. **Models + service + migrations** (§5, §7, §15) — `db:generate`, `db:migrate`. No blockers (incl. usage-log snapshot + append-only overrides §5.2).
2. **Pure lib** (`normalize-code`, `money`, `calculate-discount`, `errors`) + **unit tests** (§16.1). No blockers — highest-value, fully testable now; reproduces §9.6/§9.7.
3. **Admin routes + workflows** (§11.6–§11.9, §12) — create/update/deactivate/discount-cap. No framework `[NV]` blockers (all VoucherEngine-owned CRUD); only CONFLICT-4 sign-off. Buildable early and unblocks seeding real vouchers.
4. **Links + seed** (§6, §15) — resolve `[NV #4]` (category linkable name).
5. **Validation step** V1–V6, V8 (§9) — V7 stub (PD-06). Cart-dependent checks (V5/V6) need the cart adapter → resolve PD-02 / `[NV #2]`.
6. **Apply/Remove workflows + Store routes** (§11.1/§11.2, §12) — mechanism VERIFIED (promotion adjustment); resolve only `[NV #3]` (promotion-apply signature), `[NV #3a]` (lock API), `[NV #2]` (adapter semantics).
7. **Rate limiting** (§14.1) — strategy RESOLVED; resolve `[NV #7]` (identity source), `[NV #9]` (Redis client).
8. **cart.updated subscriber + revalidate workflow** (§11.3, §11.5, §13.1) — resolve `[NV #5]`; PD-08 policy applied.
9. **Redemption: completion-hook (primary) + order.placed subscriber (fallback)** (§11.4, §13.2/§13.3) — propagation VERIFIED; resolve `[NV #6a]` (hook point), `[NV #6]` (fallback event id), `[NV #10]` (txn/lock API).
10. **Integration/subscriber/concurrency/Redis tests** (§16.2–16.6) — create `integration-tests/setup.js` first.

> Reordered from the previous pass: admin workflows (now slice 3) move ahead of validation/apply because they carry **no framework `[NV]` blockers** and let real vouchers be seeded for the later slices. See §22 for the ready/blocked classification behind this order.

---

## 21. Verification Commands

Run from the **inner** `hf-medusa-store/` workspace root unless noted.

```bash
# Type-check / build (catches workflow-composition + type errors) — run after every slice
pnpm --filter @dtc/backend build          # or: cd apps/backend && npm run build

# Generate + apply migrations (from apps/backend/)
npx medusa db:generate voucherEngine      # [NEEDS_VERIFICATION: arg]
npx medusa db:migrate

# Seed (after catalog seed)
npx medusa exec ./src/scripts/seed-vouchers.ts

# Tests (from apps/backend/)
pnpm test:unit                            # unit — discount math, validation branches
pnpm test:integration:modules            # module CRUD + constraints
pnpm test:integration:http               # apply/remove/admin over HTTP (needs integration-tests/setup.js)

# Lint
pnpm lint
```

**End-to-end manual check (after slice 6):** start backend (`pnpm backend:dev`), apply `POST /store/cart/voucher` against a seeded cart, confirm the returned cart total matches the §10 contract and the Vietnamese envelope; remove and confirm revert.

---

## 22. Implementation Readiness

**Overall classification: SRS-complete.** The SPEC covers every in-scope SRS functional requirement, edge case, security rule, data-integrity rule, and acceptance test (see the SRS Compliance Summary, §22.1). No open item is a missing SRS requirement; the only residuals are **framework API bindings** (§19.2) and business sign-offs (§18 conflicts, PD-08). V7/segment is deferred **because the SRS itself scopes the segment source out** — not a gap.

Each implementation slice is classified as **Ready for Implementation** (no blockers — can be written now), **Ready after minor verification** (buildable once one or two scoped `[NV]` framework bindings are confirmed — the _strategy/mechanism_ is fixed), or **Blocked** (a genuine unresolved design/business decision). "Owner" = who resolves the residual item: **Dev** = verify against installed source; **BO** = business-owner sign-off.

| Slice / component                                                                                                | Classification                     | Residual item(s)                                                                     | Owner                   |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------ | ----------------------- |
| Models + service + migrations (§5, incl. usage-log snapshot & append-only overrides)                             | **Ready for Implementation**       | —                                                                                    | —                       |
| Pure `lib/` (`normalize-code`, `money`, `calculate-discount`) + unit tests (§16.1, reproduces §10.4/§10.5/§10.6) | **Ready for Implementation**       | —                                                                                    | —                       |
| Error catalogue + Vietnamese envelope (`lib/errors.ts`, §8)                                                      | **Ready for Implementation**       | 429 `MedusaError` mapping `[NV #8]` (has fallback: raw `res.status(429)`)            | Dev                     |
| Admin create/update/deactivate + discount-cap workflows & routes (§11.6–§11.9, §12)                              | **Ready for Implementation**       | CONFLICT-4 POST-not-PUT (already decided)                                            | BO (confirm)            |
| Brute-force rate limiting (§14.1) — algorithm, keys, TTL, cooldown, fallback                                     | **Ready after minor verification** | identity source `[NV #7]`; Redis client `[NV #9]`                                    | Dev                     |
| Redis caching + invalidation (§14.4)                                                                             | **Ready after minor verification** | Redis client `[NV #9]`                                                               | Dev                     |
| Validation step V1–V6, V8 (§9)                                                                                   | **Ready after minor verification** | cart adapter `[NV #2]` (for V5/V6 inputs)                                            | Dev                     |
| Redemption atomicity + idempotency (§14.3) — unique constraint, conditional update, per-user re-check            | **Ready after minor verification** | txn/`nativeUpdate` API `[NV #10]`                                                    | Dev                     |
| Cart-change revalidation — sync + subscriber combination (§11.3, §11.5, §13.1)                                   | **Ready after minor verification** | `cart.updated` coverage/self-trigger `[NV #5]`; PD-08 policy                         | Dev; BO (confirm PD-08) |
| Apply / Remove workflows + store routes (§11.1/§11.2) — **promotion-adjustment mechanism VERIFIED**              | **Ready after minor verification** | `[NV #3]` promotion-apply input signature; `[NV #3a]` lock API                       | Dev                     |
| `loadCartContextStep` cart/promotion adapter (§10.7) — **fields VERIFIED**                                       | **Ready after minor verification** | `[NV #2]` `item_subtotal` inclusion semantics (mitigated by per-line adjustment sum) | Dev                     |
| Redemption trigger — **cart→order propagation VERIFIED**; sync hook primary + subscriber fallback (§13.2/§13.3)  | **Ready after minor verification** | `[NV #6a]` completion hook point; `[NV #6]` fallback event id                        | Dev                     |
| V7 segment validation (§9.4)                                                                                     | **Blocked (deferred by approval)** | PD-06 no segment source in scope; ships as no-op stub                                | BO                      |
| Scope links to Product/Category (§6)                                                                             | **Ready after minor verification** | category linkable key `[NV #4]`                                                      | Dev                     |
| HTTP / concurrency / subscriber / Redis-fallback tests (§16.3–§16.6)                                             | **Ready after minor verification** | `integration-tests/setup.js` missing (must create); test-runner import `[NV #12]`    | Dev                     |

**Readiness summary:**

- **Ready now (no blockers):** models/service/migrations, pure discount lib + unit tests, error/envelope catalogue, all admin workflows + routes. Coherent first delivery, fully testable without any framework `[NV]`.
- **Ready after minor verification (strategy/mechanism fixed, one binding each):** apply/remove (promotion adjustment **verified**), cart adapter (fields **verified**), redemption trigger (propagation **verified**), rate limiting, caching, validation step, redemption atomicity, revalidation, scope links, tests. Each needs a single confirmable API-shape/id/semantic from the transitive `@medusajs/*` packages; **none needs a new design decision.**
- **No remaining Blocked slices** for the three target gaps — pass 2 verified their mechanisms from shipped `@medusajs/medusa/dist/api/**`. What's left are narrow `[NV]` bindings (workflow input signatures, one event-id string, a hook-point, a field-inclusion semantic, lock/txn API shapes) in transitive packages reachable once `Grep`/`Glob` are enabled or via MedusaDocs MCP.
- **Deferred by approval (not blocking):** V7 segment (PD-06), real-time push (PD-09), purchase-history (PD-07), promo-tier recalc (PD-10 — covered by §11.5).

### 22.1 SRS Compliance Summary

The SPEC covers all in-scope Voucher requirements of `SRS_SuggestiveSelling_Voucher_v1.0`. (Full section-level mapping in §17; this is the checklist view.)

| SRS group      | Items                                               | Covered by                                                                                                                               |
| -------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Functional     | **VOUCH-001 … VOUCH-005**                           | §11.1 (apply/replace), §11.2 (remove), §11.3/§11.5 (revalidation), §8.1/§12 (apply+My-Vouchers list+replace-confirm), §9 (V-pipeline)    |
| Validation     | **V1 … V8**                                         | §9.0/§9.1 (apply-time full), §9.2 (revalidation subset V1,V2,V5,V6,V8), §9.0 (redemption V3,V4); fail-fast, Vietnamese-first (§8.3)      |
| Edge cases     | **EC-01, EC-02, EC-03, EC-04, EC-06, EC-08, EC-10** | §10.5/§10 (EC-01), §11.3 (EC-02), §10.2/§10.6 (EC-03), §14.2-C (EC-04), §9.2+Rule 12/13 (EC-06), §11.5 (EC-08), §14.1 (EC-10)            |
| Security       | **SEC-01 … SEC-04**                                 | §3+§10 server-side truth (SEC-01), §14.1 brute-force (SEC-02), §5.1/§8.1 code format (SEC-03), §12 admin auth + customer-scoped (SEC-04) |
| Data integrity | **INT-01 … INT-04**                                 | §5/§10 integer money (INT-01), §14.3 atomic usage (INT-02), Rule 18/§11 recalc-from-source (INT-03), §5.2 append-only usage log (INT-04) |

**Deliberate, flagged deviations needing business sign-off (not gaps):** "extends Promotion" → backed-by-Promotion (CONFLICT-1); percentage in basis points (CONFLICT-3); admin update `POST` not `PUT` (CONFLICT-4). **SRS-scoped-out:** customer-segment source (V7) — ships as a no-op stub per SRS §1.2/§2.3. **Not yet acceptance-criteria'd:** SRS §9.1 performance targets are addressed by design (Redis caching, no DB writes during calc) but lack explicit p95 test assertions — recommended follow-up, not an SRS functional gap.

---

## 23. Code-Level Implementation Blueprint — Focus Tasks

Full per-file contracts for the pricing-integrity tasks. Each file subsection uses the 13-point structure so an implementation agent writes it without redesign. Naming follows verified repo conventions (kebab-case files as in `suggestion-rule-item.ts`; camelCase functions as in `invalidateSuggestionCache`; PascalCase types; zod v4 validators as in `admin/suggestion-rules/validators.ts`; unit tests `*.unit.spec.ts` under `__tests__/` per `jest.config.js`). Comments in the written code must cite the SRS/task id, mirroring the existing modules (e.g. `// SRS INT-01`).

### 23.0 Task → file → SRS map, and global prohibitions

| Task       | Meaning                                                    | SRS anchor          | Primary file(s)                                                        |
| ---------- | ---------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------- |
| **3.3.1**  | Integer-only monetary calculation, no floating-point       | INT-01, Rule 19     | §23.1 `lib/money.ts`                                                   |
| **3.3.2**  | Original Cart subtotal calculation                         | §9.3/§10, VOUCH-003 | §23.2 `lib/calculate-discount.ts` + §23.3 `steps/load-cart-context.ts` |
| **3.3.14** | Final Cart total recalculated from authoritative Cart data | INT-03              | §23.4 `steps/verify-cart-totals.ts` (+ expected-total from §23.2)      |
| **3.8.3**  | Server-side-only discount calculation                      | SEC-01              | §23.5 route + §23.1–23.4 (all calc server-side)                        |
| **3.8.4**  | Cart total is the single pricing truth                     | INT-03/SEC-01       | §23.4 + §23.5 (route returns refetched Cart)                           |

**Global prohibitions (enforced by review + a lint note; apply to every file in §23).** Implementation MUST NOT:

- use floating-point for money — no non-integer percentages in arithmetic (percent is basis-point **integers**, `value/10000` via `Math.floor`);
- call `parseFloat`, `Number.parseFloat`, or `toFixed` anywhere in monetary paths;
- trust client-provided totals, discounts, eligibility, `promotion_id`, or amounts (§23.5 forbidden fields);
- mutate Cart totals directly (only the Cart Module recomputes; VoucherEngine applies/removes a Promotion — §14.2-A);
- perform any monetary calculation inside an API route handler (routes only validate → run workflow → return refetched Cart — §23.5).

`[NEEDS_VERIFICATION #14]` — Medusa 2.16 may return cart/line money fields as **`BigNumberValue`** (a number or `{ value, ... }`), not always a raw JS integer. Before any arithmetic/comparison, normalize each money field to a safe integer through a single helper (§23.1 `toInt`). Confirm the runtime shape against `@medusajs/types` `BigNumberValue` / the cart DTO; the algorithms below assume post-normalization integers.

### 23.1 `apps/backend/src/modules/voucher-engine/lib/money.ts` — integer money utilities (task 3.3.1)

1. **File path:** `apps/backend/src/modules/voucher-engine/lib/money.ts`
2. **Purpose:** the only place monetary primitives are manipulated; guarantees integer, safe-integer, floor-rounded, non-negative arithmetic (INT-01, Rule 19). Pure, no I/O, no framework imports.
3. **Exports (named):** `toInt`, `assertSafeInt`, `bps`, `clampMin`, `sumInts`, and const `BPS_DENOMINATOR = 10000`.
4. **Owned types:** `type Money = number` (branded doc-only alias; integer VND). No classes.
5. **Dependencies:** none (no imports). Deliberately framework-free so it is trivially unit-testable and reusable by pure calc.
6. **Function contracts:**
   - `toInt(value: unknown, label: string): number` — normalize a possibly-`BigNumberValue` money field to an integer; if `value` is `{ value }` unwrap it; reject non-finite/non-integer (`throw new MoneyError(...)`). Resolves `[NV #14]`.
   - `assertSafeInt(value: number, label: string): void` — throw unless `Number.isSafeInteger(value)`.
   - `bps(amount: number, basisPoints: number): number` — `assertSafeInt` both, return `Math.floor((amount * basisPoints) / BPS_DENOMINATOR)`. The only percentage primitive (basis-point → amount). **Floor** = round toward store, never fractional VND (§10.2).
   - `clampMin(value: number, floor = 0): number` — `Math.max(floor, value)`.
   - `sumInts(values: number[], label: string): number` — reduce with `assertSafeInt` per element and on the running total (overflow guard).
7. **Meaningful variables:** `BPS_DENOMINATOR` (10000). No mutable module state.
8. **Ordered algorithm (`bps`):** (a) `assertSafeInt(amount)`; (b) `assertSafeInt(basisPoints)`; (c) `product = amount * basisPoints`; (d) `assertSafeInt(product)` (catch overflow before divide); (e) `return Math.floor(product / 10000)`.
9. **Validation & guards:** integer-only; safe-integer bounds; no float branch exists; `bps` requires `0 ≤ basisPoints ≤ 10000` for discounts (caller passes validated config) — assert range.
10. **Errors:** throws a local `class MoneyError extends Error` (with `label`). Callers in steps catch and re-map to `VOUCHER_CALCULATION_FAILED` (§8.4) so raw errors never reach the client (§12.5).
11. **Side effects:** none (pure).
12. **Compensation:** n/a (pure).
13. **Mapped tests:** `lib/__tests__/money.unit.spec.ts` — `bps(3_800_000, 1000) === 380_000`; `bps(2_840_000, 2000) === 568_000` (feeds §10.5); floor case `bps(150_000, 2000)===30_000`; `toFixed`/`parseFloat` absent (grep assertion in test); `assertSafeInt` throws on `1e20`; `toInt({value: '30000'})===30000` (`[NV #14]`). (INT-01, Rule 19.)

### 23.2 `apps/backend/src/modules/voucher-engine/lib/calculate-discount.ts` — pure discount resolution (tasks 3.3.2, 3.3.14)

1. **File path:** `apps/backend/src/modules/voucher-engine/lib/calculate-discount.ts`
2. **Purpose:** the entire §10 calculation contract as a deterministic function of plain integers — original subtotal (3.3.2), voucher discount with both caps, and the **expected final Cart total** used later for verification (3.3.14). No I/O, no Medusa imports.
3. **Exports (named):** `calculateOriginalSubtotal`, `calculateItemPromotionDiscount`, `calculateEligiblePostPromotionSubtotal`, `calculateVoucherDiscount`; types `LineValue`, `VoucherDiscountInput`, `VoucherDiscountResult`.
4. **Owned types:**
   - `interface LineValue { line_id: string; unit_price: number; quantity: number; item_promotion_discount: number; is_eligible: boolean }` — one per cart line, item-promotion discount already summed from **non-voucher** adjustments (§23.3).
   - `interface VoucherDiscountInput { lines: LineValue[]; discount_type: 'percentage' | 'fixed_amount'; discount_value: number; max_discount_amount: number | null; global_cap_bps: number }`
   - `interface VoucherDiscountResult { original_subtotal: number; item_promotion_discount: number; post_promotion_subtotal: number; eligible_post_promotion_subtotal: number; raw_voucher_discount: number; voucher_discount_after_voucher_cap: number; maximum_combined_discount: number; final_voucher_discount: number; discount_capped: boolean; expected_final_cart_total: number }`
5. **Dependencies:** `./money` (`bps`, `clampMin`, `sumInts`, `assertSafeInt`). Nothing else.
6. **Function contracts:**
   - `calculateOriginalSubtotal(lines: LineValue[]): number` — `sumInts(lines.map(l => l.unit_price * l.quantity))` (each line asserted integer). = §10 `original_subtotal`.
   - `calculateItemPromotionDiscount(lines): number` — `sumInts(lines.map(l => l.item_promotion_discount))`. = §10 `item_promotion_discount`.
   - `calculateEligiblePostPromotionSubtotal(lines): number` — `sumInts(eligible lines → l.unit_price*l.quantity − l.item_promotion_discount)`, `clampMin(_,0)` per line.
   - `calculateVoucherDiscount(input): VoucherDiscountResult` — full pipeline (algorithm below).
7. **Meaningful variables:** `original_subtotal`, `item_promotion_discount`, `post_promotion_subtotal`, `eligible_post_promotion_subtotal`, `raw_voucher_discount`, `voucher_discount_after_voucher_cap`, `maximum_combined_discount`, `remaining_cap_capacity`, `final_voucher_discount`, `discount_capped`, `expected_final_cart_total` — names mirror §9.2/§10.1 exactly.
8. **Ordered algorithm (`calculateVoucherDiscount`) — mirrors §10.1 / Solution Flow §9.1:**
   1. `original_subtotal = calculateOriginalSubtotal(lines)`.
   2. `item_promotion_discount = calculateItemPromotionDiscount(lines)`.
   3. `post_promotion_subtotal = clampMin(original_subtotal − item_promotion_discount)`.
   4. `eligible_post_promotion_subtotal = calculateEligiblePostPromotionSubtotal(lines)`.
   5. `raw_voucher_discount =` percentage → `bps(eligible_post_promotion_subtotal, discount_value)`; fixed → `Math.min(discount_value, eligible_post_promotion_subtotal)` (fixed can't exceed eligible — §10.2).
   6. `voucher_discount_after_voucher_cap = max_discount_amount == null ? raw : Math.min(raw, max_discount_amount)` (Rule 8).
   7. `maximum_combined_discount = bps(original_subtotal, global_cap_bps)` (Rule 9 — cap on **original** subtotal).
   8. `remaining_cap_capacity = clampMin(maximum_combined_discount − item_promotion_discount)` (Rule 10/11 — item promo never reduced).
   9. `final_voucher_discount = clampMin(Math.min(voucher_discount_after_voucher_cap, remaining_cap_capacity))`.
   10. `discount_capped = final_voucher_discount < voucher_discount_after_voucher_cap`.
   11. `expected_final_cart_total = clampMin(original_subtotal − item_promotion_discount − final_voucher_discount)` (§10.1 `final_cart_total`; EC-03 min-1-VND policy handled by caller/`[NV #13]`).
9. **Validation & guards:** every intermediate through `money.ts` (integer/safe/floor); `discount_value` percentage asserted `≤ 10000`; all clamped `≥ 0`; deterministic (no `Date`/`random`).
10. **Errors:** propagates `MoneyError` → step maps to `VOUCHER_CALCULATION_FAILED`.
11. **Side effects:** none.
12. **Compensation:** n/a.
13. **Mapped tests:** `lib/__tests__/calculate-discount.unit.spec.ts` — reproduces §10.4 (→ `final=380_000`, `expected_final_cart_total=3_420_000`, T-VOUCH-07); §10.5 (→ `final=490_000`, `expected=2_350_000`, `discount_capped=true`, T-VOUCH-08); §10.6 (50%+50% → `final=0`/clamp, EC-03/T-VOUCH-09); fixed-voucher cap (§10.2); `max_discount_amount` before global cap (Rule 8); item-promo consumes entire cap → `final=0` (§10.5 boundary). Relationship to SRS: each asserted number equals the SRS §4.1 VOUCH-003 worked examples.

### 23.3 `apps/backend/src/workflows/voucher/steps/load-cart-context.ts` — authoritative Cart read + mapping (task 3.3.2)

1. **File path:** `apps/backend/src/workflows/voucher/steps/load-cart-context.ts`
2. **Purpose:** read the latest Cart from Medusa and map it to the pure calculator's `LineValue[]`, excluding VoucherEngine's own adjustment. The single adapter between framework money shapes and the pure layer.
3. **Exports:** `loadCartContextStep` (a `createStep(...)` from `@medusajs/framework/workflows-sdk` `[NV #3]`); type `CartContext`.
4. **Owned types:** `interface CartContext { cart_id: string; currency_code: string; lines: LineValue[]; original_subtotal: number; item_promotion_discount: number; post_promotion_subtotal: number; concurrency_marker: string }` (reuses `LineValue` from §23.2).
5. **Dependencies:** `ContainerRegistrationKeys.QUERY` / `remoteQueryObjectFromString` (verified in `carts/helpers.js`); `../../../modules/voucher-engine/lib/money` (`toInt`); `./`-local none.
6. **Function/step contract:** input `{ cart_id: string; voucher_promotion_id?: string }` → output `CartContext`. Reads exactly the verified fields (§10.7): cart `currency_code`, `original_item_subtotal`, `item_subtotal`, `item_discount_total`, `updated_at`; line `items.id`, `items.unit_price`, `items.quantity`, `items.product_id`, `items.product.categories.id`, `items.adjustments.{amount,promotion_id,code}`.
7. **Meaningful variables:** `raw_cart` (query result), `voucher_promotion_id` (to exclude own adjustment), per-line `line_item_promotion_discount`.
8. **Ordered algorithm:**
   1. `query.graph({ entity: 'cart', filters: { id: cart_id }, fields: [...§10.7] })` → `raw_cart`; if none → throw.
   2. For each `item`: `unit_price = toInt(item.unit_price)`, `quantity = toInt(item.quantity)`.
   3. `line_item_promotion_discount = sumInts(item.adjustments.filter(a => a.promotion_id !== voucher_promotion_id).map(a => toInt(a.amount)))` — **excludes VoucherEngine's own adjustment** (Rule 11; distinguishes by `promotion_id`, verified §10.7).
   4. `is_eligible` set later by `resolveEligibleItemsStep`; default `false` here (or fold scope-match in — keep here read-only, eligibility in its own step).
   5. Aggregate `original_subtotal`, `item_promotion_discount`, `post_promotion_subtotal` via `calculate*` (§23.2) for cross-checking against cart aggregates.
   6. `concurrency_marker = raw_cart.updated_at` (`[NV #3a]`).
9. **Validation & guards:** `toInt` on every money field (`[NV #14]`); if `item_discount_total` (cart aggregate) ≠ Σ line promotion discounts (excluding voucher) → log a warning and **trust the per-line sum** (mitigation for `[NV #2]` semantics); missing/empty `adjustments` → treat as `0` (no item promo); negative computed line value → `clampMin`.
10. **Errors:** cart-not-found or malformed money → `VOUCHER_CALCULATION_FAILED` (safe; cart untouched).
11. **Side effects:** read-only (no mutation).
12. **Compensation:** none (read-only step).
13. **Mapped tests:** module-integration `src/modules/voucher-engine/__tests__/load-cart-context.spec.ts` — seeds a cart with an item promotion + a voucher adjustment, asserts the voucher adjustment is excluded and `item_promotion_discount` equals the item-promo only; empty-adjustments cart → `0`. (Feeds T-VOUCH-01/05/06.)

### 23.4 `apps/backend/src/workflows/voucher/steps/verify-cart-totals.ts` — authoritative-total verification (tasks 3.3.14, 3.8.4)

1. **File path:** `apps/backend/src/workflows/voucher/steps/verify-cart-totals.ts`
2. **Purpose:** after the voucher Promotion is applied (§11.1 step 9), prove the Cart Module's own recomputed totals match VoucherEngine's internal calculation. The internal number is used **only** as an assertion oracle; the refetched Cart total is the single pricing truth (3.8.4, INT-03).
3. **Exports:** `verifyCartTotalsStep`.
4. **Owned types:** `interface VerifyTotalsInput { cart_id: string; promotion_id: string; final_voucher_discount: number; expected_final_cart_total: number }`; `interface VerifyTotalsOutput { cart: unknown /* refetched authoritative cart */; verified: true }`.
5. **Dependencies:** QUERY/`refetchCart`-style read (verified `carts/helpers.js`); `../../../modules/voucher-engine/lib/money` (`toInt`).
6. **Step contract:** input `VerifyTotalsInput` → output `VerifyTotalsOutput`.
7. **Meaningful variables:** `cart` (refetched), `applied_adjustment_total` (Σ `items.adjustments[].amount where promotion_id === promotion_id`), `authoritative_total = toInt(cart.total)`, `TOLERANCE = 0` (exact integer equality — no rounding slack).
8. **Ordered algorithm:**
   1. Refetch the cart with §10.7 fields + `total`, `discount_total`, `items.adjustments`.
   2. `applied_adjustment_total = sumInts(cart.items.flatMap(i => i.adjustments).filter(a => a.promotion_id === input.promotion_id).map(a => toInt(a.amount)))`.
   3. **Assert** `applied_adjustment_total === input.final_voucher_discount` (the voucher discount Medusa recorded equals what VoucherEngine computed).
   4. **Assert** `toInt(cart.total) === input.expected_final_cart_total`.
   5. On either mismatch → throw `VOUCHER_CALCULATION_FAILED`.
   6. Return `{ cart, verified: true }` — the **refetched** cart is what flows to the response.
9. **Validation & guards:** exact integer equality (`TOLERANCE = 0`); `toInt` normalization (`[NV #14]`); never writes a total.
10. **Errors:** `VOUCHER_CALCULATION_FAILED` (§8.4). Message to client is the safe Vietnamese envelope; the mismatch detail (expected vs actual) is logged internally only (§12.5, §18.6).
11. **Side effects:** read-only.
12. **Compensation:** on this step's throw, the workflow runs `applyVoucherPromotionStep`'s compensation → `updateCartPromotionsWorkflow REMOVE` the voucher code, so the Cart recomputes to its pre-voucher state (never a stale write-back — Rule 18). No custom total is persisted.
13. **Why no custom total:** persisting or returning a VoucherEngine-computed total would create a second pricing source that could diverge from Cart/Order at payment/completion (violates 3.8.4/INT-03/SEC-01). The internal `expected_final_cart_total` exists solely to fail fast if the Promotion mechanism produced a different number than intended.
14. **Mapped tests:** http-integration `integration-tests/http/apply-voucher.spec.ts` asserts the response cart `total` equals the §10.4 contract (`3_420_000`) and that a deliberately mismatched fixture triggers `VOUCHER_CALCULATION_FAILED` with the cart reverted (no voucher adjustment remains). (T-VOUCH-01; INT-03.)

### 23.5 `apps/backend/src/api/store/cart/voucher/route.ts` + `validators.ts` — server-side-only enforcement (tasks 3.8.3, 3.8.4)

1. **File paths:** `apps/backend/src/api/store/cart/voucher/route.ts`, `.../validators.ts`
2. **Purpose:** thin HTTP boundary. Validates the minimal client input, runs `applyVoucherWorkflow` / `removeVoucherWorkflow`, and returns the **authoritative refetched Cart** + Vietnamese envelope. Performs **zero** monetary calculation (3.8.3).
3. **Exports:** `POST`, `DELETE` (route); `ApplyVoucherSchema`, `ApplyVoucherBody` (validators).
4. **Owned types:** `ApplyVoucherBody = z.infer<typeof ApplyVoucherSchema>`.
5. **Dependencies:** `@medusajs/framework/http` (`MedusaRequest`,`MedusaResponse`), `Modules.WORKFLOW_ENGINE` resolve (pattern verified in `carts/[id]/complete/route.js`), the two workflows, the error→envelope mapper (`lib/errors`).
6. **Contracts:**
   - `ApplyVoucherSchema` (zod v4, **`.strict()`** so unknown keys are rejected): `{ code: z.string().min(6).regex(/^[A-Za-z0-9]+$/), cart_id: z.string().min(1), confirm_replace: z.boolean().optional() }`. `code` normalized to upper in the workflow (not the route).
   - `POST(req: MedusaRequest<ApplyVoucherBody>, res)` → `{ success, cart, voucher, discount_amount, original_discount, discount_capped, message }` (§8.1). `cart` = the refetched authoritative cart from `verifyCartTotalsStep`.
   - `DELETE(req, res)` → `{ success, cart, message }`.
7. **Meaningful variables:** `code`, `cart_id`, `confirm_replace` — **the only** client-supplied values.
8. **Ordered algorithm (`POST`):** (a) body already validated by `validateAndTransformBody(ApplyVoucherSchema)` in `middlewares.ts`; (b) resolve WORKFLOW_ENGINE; (c) `run(applyVoucherWorkflowId, { input: { code, cart_id, customer_id: req.auth_context?.actor_id ?? null, confirm_replace } })` — `customer_id` taken from the **server** auth context, never the body (`[NV #7]`); (d) map workflow error → envelope (§8.4); (e) `res.json(result)` where `result.cart` is the refetched cart.
9. **Validation & guards — client field policy (3.8.3):**
   - **May submit:** `code`, `cart_id`, `confirm_replace`.
   - **MUST NEVER submit (rejected by `.strict()`):** `discount_amount`, `final_voucher_discount`, any `*_total`, `original_discount`, `discount_capped`, `promotion_id`, `voucher_id`, `usage_count`, `eligible_item_ids`, `customer_id`, `min_order_value`, or any monetary/eligibility field.
   - **Always loaded server-side:** cart contents/totals (Cart Module), voucher rules (`VoucherConfig`), backing Promotion, global cap (`DiscountCapConfig`), customer identity (auth context).
10. **Errors:** business errors → typed envelope with `MedusaError` mapping (§8.4); rate limit → 429 (`[NV #8]`); never leak raw errors (§12.5).
11. **Side effects:** none in the route itself; all mutation is inside the workflow.
12. **Compensation:** n/a at route level (workflow owns compensation).
13. **Mapped tests:** `integration-tests/http/apply-voucher.spec.ts` — (a) a body containing `discount_amount`/`final_voucher_discount` → 400 (strict rejection), proving tampering has no effect (SEC-01/T-VOUCH tamper); (b) valid apply → response `cart.total` equals server calculation (3.8.4); (c) `remove` → totals reverted, no usage increment (T-VOUCH-10).

> **Readiness of §23 files:** with the contracts above, `lib/money.ts` and `lib/calculate-discount.ts` are **Ready for Implementation** (no framework `[NV]`; fully unit-testable now). `load-cart-context.ts`, `verify-cart-totals.ts`, and the store route are **Ready after minor verification** — they need only `[NV #3]` (`createStep`/`updateCartPromotionsWorkflow` shapes), `[NV #7]` (auth-context field), `[NV #14]` (`BigNumberValue` normalization), all confirmable in installed `@medusajs/*`.

---

> **STOP.** This is a planning artifact only. No source code has been created or modified. Await manual review and approval before implementation. Pass 2 verified the three cart/order/promotion mechanisms against shipped `@medusajs/medusa/dist/api/**` (see top verification log); §23 adds code-level contracts for the pricing-integrity tasks. Before writing each slice, confirm its remaining narrow `[NEEDS_VERIFICATION]` binding (§19.2) against the named transitive `@medusajs/*` package (reachable with `Grep`/`Glob` or MedusaDocs MCP).
