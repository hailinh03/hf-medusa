# VoucherEngine Implementation Progress

## 2026-07-13 — Pricing Calculation Foundation

### Task 3.3.1 — Integer-only monetary calculation

**Status:** Done

**Implemented:**

- `toInt(value, label)` normalizes any Medusa `BigNumberValue` shape (verified against installed `@medusajs/types`
  `dist/totals/big-number.d.ts`: `BigNumberJS | number | string | IBigNumber`) to a JS-safe integer. Handles plain
  `number`, numeric `string` (via `Number()`, never `parseFloat`), `{ numeric }` (IBigNumber), `{ value }` (
  BigNumberRawValue), and BigNumberJS-like objects via `.toNumber()`/`.valueOf()`. Rejects non-finite, non-integer, or
  unrecognized shapes.
- `assertSafeInt(value, label)` — throws unless `Number.isSafeInteger(value)`.
- `bps(amount, basisPoints)` — the only percentage primitive; `basisPoints` is an integer (2000 = 20.00%), denominator
  fixed at `BPS_DENOMINATOR = 10000`; computes `Math.floor((amount * basisPoints) / 10000)` with an explicit overflow
  guard on the intermediate product before dividing; asserts `0 ≤ basisPoints ≤ 10000`.
- `clampMin(value, floor = 0)` — floors a value at a minimum (used to prevent negative discounts/totals).
- `sumInts(values, label)` — reduces a list with a per-element and running-total safe-integer guard (overflow
  detection).
- `MoneyError` — local error class; all guard functions throw this, never a raw `Error`.
- No floating-point percentage multipliers, no `parseFloat`, no `Number.parseFloat`, no `toFixed` anywhere in the file (
  asserted by a unit test that greps the source).

**Files created:**

- `apps/backend/src/modules/voucher-engine/lib/money.ts`
- `apps/backend/src/modules/voucher-engine/lib/__tests__/money.unit.spec.ts`

**Files modified:**

- None

**Key symbols added:**

- `toInt`, `assertSafeInt`, `bps`, `clampMin`, `sumInts`, `BPS_DENOMINATOR`, `MoneyError`, `type Money`

**Tests executed:**

- `TEST_TYPE=unit npx jest src/modules/voucher-engine/lib/__tests__/money.unit.spec.ts` — **Passed**, 23/23 tests (
  source-hygiene grep, `toInt` normalization of all four BigNumberValue shapes, integer/overflow rejection, `bps`
  reproducing 380,000 and 568,000 from the SRS worked examples, floor rounding, `clampMin`, `sumInts`).

**Remaining work:**

- None for this task's own scope. `[NEEDS_VERIFICATION #14]` (BigNumberValue runtime shape) is now resolved/verified
  against installed `@medusajs/types`, not just hedged.

---

### Task 3.3.2 — Original Cart subtotal calculation

**Status:** Done (pure logic + Cart adapter both implemented and typechecked; no live-Cart integration test run — see
Remaining work)

**Implemented:**

- `calculateOriginalSubtotal(lines)` — sums `unit_price * quantity` per line (each asserted as a safe integer) via
  `sumInts`.
- `calculateItemPromotionDiscount(lines)` — sums each line's already-computed `item_promotion_discount`.
- `calculateEligiblePostPromotionSubtotal(lines)` — sums `(unit_price*quantity − item_promotion_discount)` clamped to 0,
  over eligible lines only.
- `loadCartContextStep` (workflow step) reads the Cart via `query.graph({ entity: "cart", filters: { id }, fields })` (
  container-resolved `ContainerRegistrationKeys.QUERY`), using exactly the verified authoritative field list from
  `@medusajs/medusa/dist/api/store/carts/query-config.js` (SPEC §10.7): `items.unit_price`, `items.quantity`,
  `items.product_id`, `items.product.categories.id`, `items.adjustments.{amount,promotion_id,code}`, cart
  `currency_code`/`updated_at`.
- Item-level promotion adjustments are read per line from `items.adjustments[].amount`. VoucherEngine's OWN adjustment
  is excluded by filtering out any adjustment whose `promotion_id` equals the voucher's backing-Promotion id (
  `input.voucher_promotion_id`) before summing — this is the concrete implementation of Rule 11 / SPEC §10.7's "
  distinguish by `promotion_id`" rule.
- All money fields are normalized through `toInt` before any arithmetic (no trust in raw Medusa numeric shapes).
- Client input is never trusted for any of these values — `loadCartContextStep` takes only `cart_id` (+ optional
  `voucher_promotion_id`) and reads everything else from the server-side Cart via `query.graph`.

**Files created:**

- `apps/backend/src/modules/voucher-engine/lib/calculate-discount.ts` (also covers 3.3.14, documented there)
- `apps/backend/src/modules/voucher-engine/lib/__tests__/calculate-discount.unit.spec.ts`
- `apps/backend/src/workflows/voucher/steps/load-cart-context.ts`

**Files modified:**

- None

**Key symbols added:**

- `calculateOriginalSubtotal`, `calculateItemPromotionDiscount`, `calculateEligiblePostPromotionSubtotal` (pure)
- `loadCartContextStep`, `loadCartContextStepId`, types `LoadCartContextInput`, `CartContext` (workflow step)

**Tests executed:**

- `TEST_TYPE=unit npx jest src/modules/voucher-engine/lib/__tests__/calculate-discount.unit.spec.ts` — **Passed**, part
  of the 33/33 result reported under 3.3.14 below (original-subtotal and item-promotion-discount aggregation are
  asserted directly, plus indirectly through every `calculateVoucherDiscount` fixture).
- `npx tsc --noEmit -p tsconfig.json` — **Passed** (exit 0), confirming `load-cart-context.ts` compiles against the real
  `@medusajs/framework/workflows-sdk` and `@medusajs/framework/utils` types.
- No module-integration test (`src/modules/voucher-engine/__tests__/load-cart-context.spec.ts` per SPEC §23.3) was
  created or run — it requires a seeded Cart with real item-promotion + voucher adjustments, which needs the
  out-of-scope apply/promotion pieces (see Remaining work).

**Remaining work:**

- Module-integration test for `loadCartContextStep` against a real seeded Cart (SPEC §23.3 test 13) — deferred; needs a
  Cart with an actual applied Promotion adjustment to seed against, which this session does not create (see
  `applyVoucherPromotionStep`, out of scope).
- `resolveEligibleItemsStep` (V6 scope matching, sets `is_eligible`) is explicitly out of scope this session;
  `loadCartContextStep` currently defaults every line's `is_eligible` to `false`, exactly as documented in its own code
  comment.
- `[NEEDS_VERIFICATION #2]` (exact inclusion semantics of Medusa's own `item_subtotal`/`item_discount_total` aggregate
  fields) remains open; mitigated as designed — the implementation sums per-line `items.adjustments[].amount` directly
  rather than trusting the cart-level aggregate.

---

### Task 3.3.14 — Final Cart total recalculation from authoritative Cart data

**Status:** Done (pure pipeline fully implemented/tested; verification step implemented and typechecked; no live
end-to-end run — see Remaining work)

**Implemented:**

- `calculateVoucherDiscount(input)` implements the complete SPEC §10.1 pipeline in the fixed order: (1) original
  subtotal, (2) item-level promotion discount, (3) post-promotion subtotal, (4) eligible post-promotion subtotal, (5)
  raw voucher discount (percentage via `bps`, or fixed via
  `Math.min(discount_value, eligible_post_promotion_subtotal)`), (6) voucher-specific `max_discount_amount` cap, (7)
  `maximum_combined_discount` = `bps(original_subtotal, global_cap_bps)`, (8) remaining global-cap capacity =
  `clampMin(maximum_combined_discount − item_promotion_discount)`, (9) `final_voucher_discount` =
  `clampMin(min(voucher_discount_after_voucher_cap, remaining_cap_capacity))`, (10) `expected_final_cart_total` =
  `clampMin(original_subtotal − item_promotion_discount − final_voucher_discount)`.
- `expected_final_cart_total` is computed purely as an internal verification oracle; the pure function does not apply
  the SPEC `[NEEDS_VERIFICATION #13]` "min 1 VND" floor (deliberately left unresolved per the SPEC's own open item —
  clamped only to 0, not to 1).
- `verifyCartTotalsStep` (workflow step) refetches the authoritative Cart (`query.graph`, fields
  `id, total, discount_total, items.id, items.adjustments.{amount,promotion_id}`), sums the adjustment amounts whose
  `promotion_id` matches the voucher's backing Promotion, and asserts **exact integer equality** (no tolerance) against
  both `input.final_voucher_discount` (the recorded adjustment) and `input.expected_final_cart_total` (against
  `cart.total`). On either mismatch it logs the expected/actual values via the container-resolved logger and throws
  `MedusaError(MedusaError.Types.UNEXPECTED_STATE, "VOUCHER_CALCULATION_FAILED")`. On success it returns
  `{ cart, verified: true }` where `cart` is the refetched authoritative object — no custom total is constructed.
- Promotion-removal compensation on verification failure is **not implemented as code in this step** (the step is
  read-only by design, per SPEC §23.4 point 12: "on this step's throw, the workflow runs `applyVoucherPromotionStep`'s
  compensation"). That compensating step (`applyVoucherPromotionStep`) is itself out of scope this session (it requires
  the backing-Promotion apply mechanism, `[NEEDS_VERIFICATION #3]`), so the full compensation chain cannot be exercised
  end-to-end yet. This is documented, not silently assumed.

**Files created:**

- `apps/backend/src/workflows/voucher/steps/verify-cart-totals.ts`
- (calculation logic itself is in `calculate-discount.ts`, created under 3.3.2)

**Files modified:**

- None

**Key symbols added:**

- `calculateVoucherDiscount`, types `VoucherDiscountInput`, `VoucherDiscountResult` (pure)
- `verifyCartTotalsStep`, `verifyCartTotalsStepId`, types `VerifyTotalsInput`, `VerifyTotalsOutput`, `RawVerifiedCart` (
  workflow step)

**Tests executed:**

- `TEST_TYPE=unit npx jest src/modules/voucher-engine/lib/__tests__/calculate-discount.unit.spec.ts` — **Passed**, 15/15
  tests. Reproduces SPEC §10.4 exactly (`final_voucher_discount=380,000`, `expected_final_cart_total=3,420,000`), §10.5
  exactly (`final=490,000` capped from `raw=568,000`, `discount_capped=true`, `expected=2,350,000`), §10.6/EC-03 (item
  promo alone consumes the entire cap → `final=0`), voucher-specific `max_discount_amount` capping before the global
  cap, and fixed-amount-voucher-never-exceeds-eligible-subtotal. One test-fixture bug was found and fixed during this
  session (a `global_cap_bps` value that accidentally became the binding constraint in a fixed-amount test, confounding
  the intended assertion) — the underlying calculation logic itself required no changes.
- Combined with money.ts and validators.ts: `TEST_TYPE=unit npx jest` (full unit suite) — **Passed**, 56/56 tests, 3
  suites.
- `npx tsc --noEmit -p tsconfig.json` — **Passed** (exit 0).
- `npx medusa lint` — **Passed**, 0 errors (12 pre-existing warnings elsewhere in the repo, none from voucher-engine
  files).
- `npx medusa build` — **Passed**: "Backend build completed successfully" and "Frontend build completed successfully";
  confirmed the compiled output at `.medusa/server/src/workflows/voucher/steps/verify-cart-totals.js` and
  `.../load-cart-context.js` exists.
- No HTTP-integration test (`integration-tests/http/apply-voucher.spec.ts` per SPEC §23.4 test 14) was created or run —
  it requires a running database, a seeded cart, and the full apply workflow (out of scope this session, see Remaining
  work).

**Remaining work:**

- HTTP-integration test asserting the response `cart.total` equals `3,420,000` for the §10.4 scenario, and that a
  deliberately mismatched fixture triggers `VOUCHER_CALCULATION_FAILED` with the cart reverted — deferred; requires the
  full `applyVoucherWorkflow` (out of scope, see Task 3.8.3/3.8.4 below).
- `applyVoucherPromotionStep`'s actual Promotion-removal compensation (the code that runs when `verifyCartTotalsStep`
  throws) is not implemented — out of scope this session (SPEC §11.1 step 9, `[NEEDS_VERIFICATION #3]`,
  backing-Promotion apply mechanism).
- `[NEEDS_VERIFICATION #13]` (whether the "min 1 VND" clamp is mandatory) remains an open business decision,
  deliberately not implemented per the SPEC's own instruction.

---

### Task 3.8.3 — Server-side-only discount calculation

**Status:** Partially Done

**Implemented:**

- `ApplyVoucherSchema` (zod, `.strict()`) accepts **only** `code`, `cart_id`, and optional `confirm_replace`. Any other
  key — including every forbidden pricing/identity/eligibility field explicitly listed in the task (`discount_amount`,
  `final_voucher_discount`, any `*_total`, `promotion_id`, `voucher_id`, `eligible_item_ids`, `customer_id`,
  `usage_count`, `min_order_value`, `discount_capped`, etc.) — is **rejected** by zod's strict-mode validation (
  unrecognized keys fail parsing rather than being silently stripped).
- `RemoveVoucherSchema` (zod, `.strict()`) accepts only `cart_id` for the DELETE flow, with the same strict rejection.
- Both schemas import `z` from `@medusajs/framework/zod` (repo lint convention, verified re-export of the real `zod`
  package), matching the project's `@medusajs/zod-import-source` rule.
- `middlewares.ts` was updated to wire `validateAndTransformBody(ApplyVoucherSchema)` on `POST /store/cart/voucher` and
  `validateAndTransformBody(RemoveVoucherSchema)` on `DELETE /store/cart/voucher`. `defineMiddlewares` is a declarative
  matcher config (verified: `@medusajs/framework/dist/http/utils/define-middlewares.js` performs no existence check
  against registered routes), so this wiring is safe/inert even though `route.ts` does not exist yet.
- **`route.ts` (the actual `POST`/`DELETE` handlers) was NOT created.** Per the SPEC (§11.1, §23.5) the route must run
  `applyVoucherWorkflow` / `removeVoucherWorkflow`. Those workflows require pieces explicitly out of scope for this
  session per the task's own "Scope boundaries" (VoucherConfig model + lookup, V1–V8 validation, rate limiting,
  backing-Promotion creation/apply). Composing a stand-in workflow out of only this session's pieces would misrepresent
  what SPEC §11.1 defines as `applyVoucherWorkflow` and was explicitly rejected as an approach (would violate "do not
  silently change the SPEC to fit an implementation shortcut"). Importing a route that references a non-existent
  workflow would either break the backend build or 500 at runtime — both worse than an honest, documented gap.
- Because there is no route handler, "the route performs no monetary calculation" and "the route returns the
  authoritative refetched Cart" cannot yet be demonstrated end-to-end — only the validator layer (client-field
  rejection) is verified.

**Files created:**

- `apps/backend/src/api/store/cart/voucher/validators.ts`
- `apps/backend/src/api/store/cart/voucher/__tests__/validators.unit.spec.ts`

**Files modified:**

- `apps/backend/src/api/middlewares.ts` (added the two `/store/cart/voucher` matcher entries)

**Key symbols added:**

- `ApplyVoucherSchema`, `ApplyVoucherBody`, `RemoveVoucherSchema`, `RemoveVoucherBody`

**Tests executed:**

- `TEST_TYPE=unit npx jest src/api/store/cart/voucher/__tests__/validators.unit.spec.ts` — **Passed**, 23/23 tests,
  including a parameterized test asserting rejection of every forbidden field named in the task description.
- `npx tsc --noEmit -p tsconfig.json` — **Passed** (exit 0), confirming `middlewares.ts` compiles with the new imports.
- `npx medusa lint` — **Passed**, 0 errors, no warnings on the new/modified files.
- `npx medusa build` — **Passed**; confirmed `.medusa/server/src/api/store/cart/voucher/validators.js` exists in the
  compiled output.

**Remaining work:**

- `apps/backend/src/api/store/cart/voucher/route.ts` (POST/DELETE handlers) — blocked on `applyVoucherWorkflow` /
  `removeVoucherWorkflow` (SPEC §11.1/§11.2), which require: the `VoucherConfig` model + lookup step, V1–V8 validation,
  and the backing-Promotion apply mechanism (`[NEEDS_VERIFICATION #3]`) — all explicitly out of scope for this session.
- Once the route exists, an HTTP-integration test must assert: a body containing a forbidden pricing field is rejected
  with 400 (proving tampering has no effect), and a valid apply returns a `cart.total` matching the server calculation.

---

### Task 3.8.4 — Cart total as the single pricing truth

**Status:** Partially Done

**Implemented:**

- The Cart Module is architecturally kept authoritative in every piece built this session: `loadCartContextStep` only
  _reads_ the Cart (no mutation); `verifyCartTotalsStep` refetches the Cart AFTER the (not-yet-implemented) Promotion
  mutation and compares the refetch against the internal calculation, never the other way around.
- `verifyCartTotalsStep` returns `{ cart, verified: true }` where `cart` is the refetched object straight from
  `query.graph` — no field of it is overwritten, and no parallel "expected total" object is substituted in its place.
  `expected_final_cart_total` (from `calculate-discount.ts`) is used strictly as the comparison oracle inside the
  `if (authoritative_total !== input.expected_final_cart_total)` guard and is never written back onto the cart or
  returned as a cart field.
- No code in this session persists, caches, or returns a custom `final_total` (or equivalent) as an alternative pricing
  source. `cart.metadata` is not touched by anything implemented this session.
- **End-to-end confirmation that "the Store API returns the refetched Cart" cannot yet be made** — there is no route
  handler yet (see 3.8.3), so the chain "workflow refetches Cart → Store API returns it" is only proven up to the
  workflow-step boundary (`verifyCartTotalsStep`'s own output), not through an actual HTTP response. I am NOT claiming
  the full request→response flow returns the refetched Cart, because that flow does not exist yet.

**Files created:**

- None beyond those listed under 3.3.14 (`verify-cart-totals.ts`) and 3.3.2 (`load-cart-context.ts`), which are the
  files implementing this task's rules.

**Files modified:**

- None

**Key symbols added:**

- None beyond `verifyCartTotalsStep`/`loadCartContextStep` already listed above.

**Tests executed:**

- Same as Task 3.3.14 (`calculate-discount.unit.spec.ts`, full unit suite, `tsc --noEmit`, `medusa lint`,
  `medusa build`) — all **Passed**, as reported there.

**Remaining work:**

- `applyVoucherPromotionStep` (writes the Promotion adjustment onto the Cart) is not implemented — out of scope this
  session. Without it, `verifyCartTotalsStep` has never been exercised against a live mutated Cart, only typechecked and
  lint-checked.
- The Store API route (3.8.3) is required before "Cart total is the only customer-facing total" can be demonstrated
  end-to-end rather than just architecturally enforced in the code that exists.

---

### Session verification summary

**Commands executed:**

- `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --silent --runInBand --forceExit` (various scopings,
  then full suite) — **Passed**, final full run: 3 suites, 56/56 tests passed.
- `npx tsc --noEmit -p tsconfig.json` — **Passed** (exit 0), run twice (before and after a mid-session fix), both clean.
- `npx medusa lint` — **Passed**, 0 errors both before and after the logger fix (12 pre-existing warnings, unrelated to
  this session's files, remained unchanged in count).
- `npx medusa build` — **Passed**: "Backend build completed successfully (3.30s)" and "Frontend build completed
  successfully (22.91s)"; verified compiled `.js` output exists for every new file under `.medusa/server/`.

**Framework bindings verified (against installed `@medusajs/*` 2.16.0, reached via the pnpm virtual-store sibling
trick — reading `node_modules/.pnpm/@medusajs+framework@2.16.0_.../node_modules/@medusajs/*` directly):**

- `createStep` / `StepResponse` — exact signatures confirmed in
  `@medusajs/workflows-sdk/dist/utils/composer/create-step.d.ts` and `.../helpers/step-response.d.ts` (including the
  documented `createStep(name, invokeFn, compensateFn?)` example).
- `ContainerRegistrationKeys.QUERY = "query"` and `ContainerRegistrationKeys.LOGGER` — confirmed in
  `@medusajs/utils/dist/common/container.d.ts`.
- `query.graph({ entity, filters, fields })` → `Promise<{ data: any[] }>` — confirmed via the `Query`/
  `RemoteQueryFunction` type in `@medusajs/types/dist/modules-sdk/remote-query.d.ts`, and the exact usage pattern
  cross-checked against the shipped `@medusajs/medusa/dist/api/store/carts/[id]/complete/route.js`. Confirmed that
  `"cart"` has no static `RemoteQueryEntryPoints` typing, so `data` is untyped `any[]` for this entity — justifying the
  hand-specified `RawCart`/`RawVerifiedCart` interfaces.
- `BigNumberValue = BigNumberJS | number | string | IBigNumber` and `IBigNumber { numeric, raw?, valueOf() }` —
  confirmed in `@medusajs/types/dist/totals/big-number.d.ts`. This fully resolves `[NEEDS_VERIFICATION #14]` from the
  SPEC (previously only hedged).
- `MedusaError.Types` members (`NOT_FOUND`, `UNEXPECTED_STATE`, etc.) and constructor signature
  `(type, message, code?, ...params)` — confirmed in `@medusajs/utils/dist/common/errors.d.ts`.
- `AuthContext { actor_id, actor_type, ... }` on `MedusaStoreRequest.auth_context?` — confirmed in
  `@medusajs/framework/dist/http/types.d.ts`. This resolves `[NEEDS_VERIFICATION #7]` (customer identity source for a
  future route.ts: `req.auth_context?.actor_id`).
- `@medusajs/framework/zod` re-exports the real `zod` package (`@medusajs/deps/dist/zod.d.ts`: `export * from "zod"`) —
  confirmed, and used instead of importing `zod` directly to match the repo's own `@medusajs/zod-import-source` lint
  rule (the existing `admin/suggestion-rules/validators.ts` has this exact warning; the new file does not).
- `defineMiddlewares` is a pure declarative config transform with no dependency on a route existing — confirmed in
  `@medusajs/framework/dist/http/utils/define-middlewares.js`.

**Unresolved framework bindings:**

- `[NEEDS_VERIFICATION #2]` — exact inclusion semantics of Medusa's cart-level aggregate fields (`item_subtotal` vs
  `item_discount_total`); mitigated (not blocking) by summing per-line adjustments directly instead of trusting the
  aggregate.
- `[NEEDS_VERIFICATION #3]` — exact `createPromotionsWorkflow`/`updateCartPromotionsWorkflow` input signatures for
  applying the voucher's cap-adjusted amount as a Promotion adjustment. Not reached this session (transitive
  `@medusajs/core-flows`); blocks `applyVoucherPromotionStep`, which is out of scope.
- `[NEEDS_VERIFICATION #3a]` — exact optimistic-concurrency marker field; `updated_at` used as the candidate in
  `loadCartContextStep`, unconfirmed against a version-specific field.
- `[NEEDS_VERIFICATION #13]` — whether the "min 1 VND" floor on `expected_final_cart_total` is mandatory (business
  decision, deliberately not implemented).
- All other SPEC §19.2 items unrelated to this session's five tasks (rate limiting, redemption, admin workflows,
  subscribers, etc.) remain as recorded in the SPEC — not touched this session.

**Overall session status:** Partially Completed

**Notes:**

- Explicit scope exclusions honored: no admin voucher APIs, no usage redemption/usage logs, no Redis rate
  limiting/caching, no Cart-change or order subscribers, no customer segmentation, no storefront UI, no unrelated
  validation rules or refactoring were implemented.
- No business formula in the SPEC was changed. The EC-03 "minimum 1 VND" clamp was deliberately NOT added to
  `expected_final_cart_total` — it remains an open item (`[NEEDS_VERIFICATION #13]`) per the SPEC's own instruction, not
  silently resolved.
- Two genuine repo-infrastructure gaps were fixed as necessary prerequisites for running any test at all (not business
  logic): `apps/backend/integration-tests/setup.js` was missing and referenced by `jest.config.js`'s `setupFiles`, which
  caused Jest to fail validation before running a single test; a minimal placeholder file was created. This was flagged
  as missing in the SPEC itself (§3, §16) prior to this session.
- The most significant scope decision this session: `apps/backend/src/api/store/cart/voucher/route.ts` was deliberately
  NOT created. Building it would have required either (a) fabricating a stand-in `applyVoucherWorkflow` out of only this
  session's in-scope pieces — which would misrepresent the real SPEC §11.1 workflow and violate the instruction not to
  silently shortcut the SPEC — or (b) importing/referencing workflows that do not exist, which would break the build or
  fail at runtime. The validators and middleware wiring for that route are complete and tested; only the handler is
  deferred, and the exact blocking dependency (`applyVoucherWorkflow`/`removeVoucherWorkflow`, which need
  `VoucherConfig` + lookup + V1–V8 + backing-Promotion apply, all explicitly out of scope) is documented above.

---

## 2026-07-13 — Eligible-Item Resolution, Combined Discount, Global-Cap Default & Cap Explanation

Continuation session. Reused the existing `lib/money.ts`, `lib/calculate-discount.ts` pipeline, and
`workflows/voucher/steps/load-cart-context.ts` adapter from the prior entry above — no duplicate calculation path was
created. Pre-coding inspection confirmed no `VoucherScope`/`DiscountCapConfig` models exist and no workflow steps beyond
`load-cart-context.ts`/`verify-cart-totals.ts` exist; `load-cart-context.ts` was hardcoding every line's `is_eligible`
to `false`.

### Task 3.3.3 — Item-level Promotions applied before voucher calculation

**Status:** Done

**Implemented:** Already correct in the existing `calculateVoucherDiscount` pipeline (steps 1–3: `original_subtotal` →
`item_promotion_discount` → `post_promotion_subtotal`, all computed before step 5's `raw_voucher_discount`). No code
change required this session. Verified (not just asserted) by the §10.4/§10.5 worked-example tests, which pin
`item_promotion_discount` as an input to the voucher-discount steps that follow it.

**Files created/modified:** None new for this task specifically.

**Symbols:** None new; existing `calculateOriginalSubtotal`, `calculateItemPromotionDiscount`,
`calculateVoucherDiscount`.

**Tests:** Existing `calculate-discount.unit.spec.ts` worked-example tests (§10.4, §10.5) — **Passed**.

**Remaining work:** None at the pure-logic level. The ordering guarantee is only as strong as `load-cart-context.ts`'s
read of item-level adjustments, which remains unexercised against a live seeded Cart (documented in the prior entry,
unchanged this session).

---

### Task 3.3.4 — Post-promotion line values and Cart subtotal

**Status:** Done

**Implemented:** Extracted the previously-inline per-line post-promotion calculation into an exported pure helper
`postPromotionLineValue(line)` = `clampMin(unit_price * quantity − item_promotion_discount)`, and reused it inside
`calculateEligiblePostPromotionSubtotal` (single code path, no duplication). Cart-level `post_promotion_subtotal` was
already correct (`clampMin(original_subtotal − item_promotion_discount)`) and unchanged.

**Files modified:**

- `apps/backend/src/modules/voucher-engine/lib/calculate-discount.ts` — added `postPromotionLineValue`;
  `calculateEligiblePostPromotionSubtotal` now maps through it instead of an inline closure.

**Symbols added:** `postPromotionLineValue`.

**Tests:**

- New `describe("postPromotionLineValue (task 3.3.4)")` — 2 tests (line value net of its own discount; floors at 0 when
  discount exceeds the line total) — **Passed**.
- Existing `calculateEligiblePostPromotionSubtotal` tests continue to pass unchanged (same computed values, now routed
  through the shared helper).

**Remaining work:** None.

---

### Task 3.3.5 — Eligible-item resolution (unscoped / product-scoped / category-scoped)

**Status:** Partially Done — pure resolution logic Done and unit-tested; not connected to a real scope data source or a
live Cart.

**Implemented:**

- New pure function `resolveEligibleItems(lines, scope)` in `calculate-discount.ts`.
  `scope: { product_ids: string[], category_ids: string[] }` — both empty means unscoped (every line eligible);
  otherwise a line is eligible if its `product_id` is in `scope.product_ids` OR any of its `category_ids` is in
  `scope.category_ids` (OR-combination). Returns new `LineValue[]` objects (no mutation).
- `LineValue` extended with optional `product_id?: string | null` and `category_ids?: string[]` fields, so
  `resolveEligibleItems` has data to match against. Made optional (not required) specifically so every existing test
  fixture that builds a `LineValue` literal without these fields keeps compiling — eligibility resolution and discount
  calculation stay decoupled.
- `load-cart-context.ts` updated to populate `product_id`/`category_ids` on each mapped line (it already read
  `items.product_id`/`items.product.categories.id` into `CART_CONTEXT_FIELDS` from the prior session, but was discarding
  them). `is_eligible` is still left `false` there — scope matching is a distinct step, not this read-only mapping step.
- New workflow step `resolveEligibleItemsStep` (`workflows/voucher/steps/resolve-eligible-items.ts`) — a thin
  `createStep` wrapper that calls `resolveEligibleItems` on `{ lines, scope }` and returns `{ lines }`. **Deliberate
  divergence from SPEC §11.10's literal `{ scopes, line_items } -> { eligible: EligibleItemDTO[] }` shape** (documented
  in the file's header comment): returning full `LineValue[]` with `is_eligible` set, rather than an id list, avoids a
  second re-filter pass before `calculateVoucherDiscount` consumes it.
- No `VoucherScope` DB model (SPEC §5.4) was built — out of scope per the "reuse existing code / don't create duplicate
  calculation paths" instruction and the advisor consultation; `scope` is accepted as a plain input, matching how
  `discount_type`/`discount_value`/`global_cap_bps` are already passed into `calculateVoucherDiscount` without a live
  model lookup.

**Files created:**

- `apps/backend/src/workflows/voucher/steps/resolve-eligible-items.ts`

**Files modified:**

- `apps/backend/src/modules/voucher-engine/lib/calculate-discount.ts` (added `VoucherScope`, `resolveEligibleItems`,
  `LineValue.product_id`/`category_ids`)
- `apps/backend/src/workflows/voucher/steps/load-cart-context.ts` (populates `product_id`/`category_ids` on mapped
  lines)

**Symbols added:** `VoucherScope`, `resolveEligibleItems`, `resolveEligibleItemsStep`, `resolveEligibleItemsStepId`,
`ResolveEligibleItemsInput`, `ResolveEligibleItemsOutput`.

**Tests:**

- New `describe("resolveEligibleItems (task 3.3.5)")` — 6 tests: unscoped → all eligible; product-scoped → only matching
  line; category-scoped → only matching line; product+category OR-combination; a line with no `product_id`/
  `category_ids` stays ineligible under a scoped voucher; input lines are not mutated. **Passed.**
- `resolveEligibleItemsStep` itself has **no dedicated test** — only `npx tsc --noEmit` confirms it compiles against the
  real `@medusajs/framework/workflows-sdk` types. It is not exercised against a real Cart or wired into any workflow.

**Remaining work / unresolved bindings:**

- `VoucherScope` DB model + migration (SPEC §5.4) not built — there is no real caller that sources
  `{ product_ids, category_ids }` from persisted data; it is a plain input shape only.
- `resolveEligibleItemsStep` is not wired into any workflow (no `applyVoucherWorkflow` exists) and not exercised against
  a live seeded Cart with real `product_id`/category associations — typecheck-only, consistent with
  `load-cart-context.ts`'s and `verify-cart-totals.ts`'s status from the prior session.
- This is why the task is marked **Partially Done** rather than Done: the resolution algorithm itself is complete and
  tested, but "resolution for a real voucher against a real cart" is not yet connected end-to-end.

---

### Task 3.3.6 — Percentage voucher on eligible post-promotion value

**Status:** Done (pre-existing, now additionally pinned by the new discount_capped matrix tests)

**Implemented:** Unchanged — `raw_voucher_discount = bps(eligible_post_promotion_subtotal, discount_value)` for
`discount_type === "percentage"`. No code change this session.

**Tests:** Existing §10.4/§10.5 tests plus the new discount_capped matrix tests (all percentage-type) — **Passed**.

**Remaining work:** None at the pure-logic level.

---

### Task 3.3.7 — Fixed voucher bounded by eligible post-promotion value

**Status:** Done (pre-existing)

**Implemented:** Unchanged — `raw_voucher_discount = Math.min(discount_value, eligible_post_promotion_subtotal)` for
`discount_type === "fixed_amount"`. No code change this session.

**Tests:** Existing "does not exceed the eligible post-promotion subtotal" test — **Passed** (re-run as part of the full
suite this session, unchanged assertions).

**Remaining work:** None.

---

### Task 3.3.8 — Voucher-specific `max_discount_amount`

**Status:** Done (pre-existing, now additionally asserts `cap_explanation` is null)

**Implemented:** Unchanged calculation (
`voucher_discount_after_voucher_cap = max_discount_amount == null ? raw : Math.min(raw, max_discount_amount)`). Added
one assertion to the existing test: `expect(result.cap_explanation).toBeNull()`, confirming the voucher's own cap does
not trigger the global-cap explanation.

**Files modified:** `calculate-discount.unit.spec.ts` (one added assertion to the existing test).

**Tests:** Existing "caps the voucher discount before the global cap is applied" test, now with the added
`cap_explanation` assertion — **Passed**.

**Remaining work:** None.

---

### Task 3.3.9 — Combined discount = item Promotions + final voucher discount

**Status:** Done

**Implemented:** New field `combined_discount` on `VoucherDiscountResult`, computed as
`sumInts([item_promotion_discount, final_voucher_discount])`. Named and documented distinctly from the pre-existing
`maximum_combined_discount` (the cap _threshold_, `bps(original_subtotal, global_cap_bps)`) to avoid conflating the
two — a one-word-different, opposite-meaning naming trap flagged during design.

**Files modified:** `apps/backend/src/modules/voucher-engine/lib/calculate-discount.ts` (
`VoucherDiscountResult.combined_discount`, computed in `calculateVoucherDiscount`).

**Symbols added:** `VoucherDiscountResult.combined_discount`.

**Tests:**

- §10.4 worked example: `combined_discount` = 900,000 + 380,000 = **1,280,000** — **Passed**.
- §10.5 worked example (capped): `combined_discount` = 1,860,000 + 490,000 = **2,350,000**, and asserted equal to
  `maximum_combined_discount` (they coincide exactly when `discount_capped` is true) — **Passed**.

**Remaining work:** None. Not yet consumed by any route/response payload (no route exists — see 3.8.3 in the prior
entry).

---

### Task 3.3.10 — Server-side global discount cap with default 50%

**Status:** Partially Done — default value implemented server-side and tested; no persisted/admin-configurable override
mechanism exists.

**Implemented:** New exported constant `DEFAULT_GLOBAL_CAP_BPS = 5000` (50.00%, SRS §5.2 `DiscountCapConfig` default) in
`calculate-discount.ts`. Deliberately **not** wired as a hidden default inside `calculateVoucherDiscount` —
`global_cap_bps` remains a required, explicit input to the pure function, so the calculation never silently assumes a
cap value; a caller (future workflow step) is expected to resolve the active cap (persisted override, or this default)
and pass it in explicitly.

**Files modified:** `apps/backend/src/modules/voucher-engine/lib/calculate-discount.ts`.

**Symbols added:** `DEFAULT_GLOBAL_CAP_BPS`.

**Tests:** New `describe("DEFAULT_GLOBAL_CAP_BPS (task 3.3.10)")` — asserts the value is `5000` — **Passed**.

**Remaining work / unresolved bindings:**

- `DiscountCapConfig` DB model + migration (SPEC §5.3) not built — out of scope this session (same rationale as
  `VoucherScope` above: no model/migration work was authorized for this batch of calculation-layer tasks). There is
  currently no step that reads a persisted override and falls back to `DEFAULT_GLOBAL_CAP_BPS`; the constant exists but
  nothing calls it yet.
- Enforcement of whatever cap value IS supplied is already Done and tested (§10.5) — only the _configuration source_ (
  default + admin override) is the gap, which is why this is Partial rather than Blocked or Done.

---

### Task 3.3.11 — Reduce only the voucher discount when combined discount exceeds the cap

**Status:** Done (pre-existing, now additionally pinned by the discount_capped matrix tests)

**Implemented:** Unchanged — `remaining_cap_capacity = clampMin(maximum_combined_discount − item_promotion_discount)`
never subtracts from `item_promotion_discount` itself; only
`final_voucher_discount = clampMin(min(voucher_discount_after_voucher_cap, remaining_cap_capacity))` is reduced. No code
change this session.

**Tests:** Existing §10.5/EC-03 tests plus the new discount_capped matrix ("true when the voucher cap binds first but
the global cap binds tighter" explicitly proves only the voucher portion is reduced, `item_promotion_discount` stays
untouched in every case) — **Passed**.

**Remaining work:** None.

---

### Task 3.3.12 — Set `discount_capped` only when the global cap reduces the voucher discount

**Status:** Done

**Implemented:** No code change — the existing formula
`discount_capped = final_voucher_discount < voucher_discount_after_voucher_cap` was already correct (it is true iff
`remaining_cap_capacity`, i.e. the global cap, is the binding constraint). This session added the dedicated proof that
was previously missing.

**Files modified:** `calculate-discount.unit.spec.ts` — new
`describe("calculateVoucherDiscount — discount_capped semantics matrix (task 3.3.12)")`.

**Tests:** 4 new cases, all **Passed**:

1. Neither cap binds → `false`.
2. Only the voucher's own `max_discount_amount` binds → `false`.
3. Only the global cap binds → `true`, with the correct `cap_explanation`.
4. The voucher cap binds first, but the global cap binds tighter still → `true` (proves `discount_capped` tracks the
   _final_ binding constraint, not "was any cap applied at all").

**Remaining work:** None.

---

### Task 3.3.13 — Generate the Vietnamese `cap_explanation`

**Status:** Done

**Implemented:**

- `formatVnd(amount)` — Vietnamese integer-VND display formatting:
  `` `${new Intl.NumberFormat('vi-VN').format(amount)}₫` ``. Verified via a throwaway Node script that
  `Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' })` inserts a space before `₫` ("568.000 ₫"), which
  does NOT match the SPEC's established convention ("30.000₫", no space) — so the plain decimal formatter is used and
  `₫` appended manually. Also confirmed this environment's Node has full ICU (
  `process.config.variables.icu_small === false`), so `vi-VN` formatting is reliable.
- `CapExplanation` type (
  `{ code: "VOUCHER_DISCOUNT_CAPPED", message_vi, message_params: { original_amount, final_amount } }`) and
  `buildCapExplanation(originalAmount, finalAmount)`, matching the exact SPEC §8.4 message template:
  `"Ưu đãi từ mã giảm giá đã được điều chỉnh từ {original_amount} xuống {final_amount} theo chính sách giảm giá tối đa"`.
- `VoucherDiscountResult.cap_explanation: CapExplanation | null` — populated with
  `buildCapExplanation(voucher_discount_after_voucher_cap, final_voucher_discount)` when `discount_capped` is true,
  `null` otherwise. `original_amount`/`final_amount` map to `voucher_discount_after_voucher_cap`/
  `final_voucher_discount` respectively, matching the SPEC §10.5 worked example (568,000 → 490,000) exactly.

**Files modified:** `apps/backend/src/modules/voucher-engine/lib/calculate-discount.ts`.

**Symbols added:** `formatVnd`, `CapExplanation`, `buildCapExplanation` (module-private),
`VoucherDiscountResult.cap_explanation`.

**Tests:**

- New `describe("formatVnd (task 3.3.13)")` — `formatVnd(30_000) === "30.000₫"`, `formatVnd(568_000) === "568.000₫"`,
  `formatVnd(0) === "0₫"` — **Passed**.
- §10.5 worked-example test now asserts the exact `cap_explanation` object (code, `message_vi`, `message_params`) — *
  *Passed**.
- discount_capped matrix "only the global cap binds" case asserts a second, independently-computed `cap_explanation`
  value (200,000 → 100,000) — **Passed**.
- Every non-capped test asserts `cap_explanation` is `null` — **Passed**.

**Remaining work:** Not yet consumed by any route/response envelope (no route exists — see 3.8.3 in the prior entry).
The full `lib/errors.ts` message-envelope catalogue (all error codes, not just this one success-path message) remains
out of scope, as it was not part of this task list.

---

### Session verification summary (this session)

**Commands executed (from `apps/backend/`, all actually run, all results below are real):**

- `TEST_TYPE=unit npx jest --testPathPattern="voucher-engine"` — **Passed**, 47/47 tests, 2 suites.
- `TEST_TYPE=unit npx jest` (full unit suite) — **Passed**, 70/70 tests, 3 suites.
- `npx tsc --noEmit -p tsconfig.json` — **Passed** (exit 0, no output).
- `npx medusa lint` — **Passed**, 0 errors; 12 pre-existing warnings, all in unrelated `suggestion-rules`/seed files,
  none from voucher-engine files (unchanged count from the prior session).
- `npx medusa build` — **Passed**: "Backend build completed successfully (4.76s)" and "Frontend build completed
  successfully (18.09s)".

**Framework bindings verified this session:**

- `Intl.NumberFormat('vi-VN')` digit grouping and `Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' })`
  spacing behavior — verified empirically via a Node script (see 3.3.13 above), not assumed. Full-ICU availability in
  this Node install confirmed (`process.config.variables.icu_small === false`).
- No new `@medusajs/*` bindings were touched beyond what was already verified in the prior session's entry (
  `createStep`/`StepResponse` reused as-is in `resolve-eligible-items.ts`); `items.product_id`/
  `items.product.categories.id` were already verified fields in `load-cart-context.ts`'s `CART_CONTEXT_FIELDS` from the
  prior session — only their _usage_ (populating `LineValue`) changed this session, not the field list itself.

**Unresolved bindings / deferred design decisions (new this session):**

- `VoucherScope` DB model + migration (SPEC §5.4) — deliberately not built; deferred exactly as documented under Task
  3.3.5. Flagging explicitly so this can be vetoed on review if a persisted model was actually expected in this batch.
- `DiscountCapConfig` DB model + migration (SPEC §5.3) — deliberately not built; deferred exactly as documented under
  Task 3.3.10, same flag.
- `resolveEligibleItemsStep` — typecheck-only, not wired into any workflow, not exercised against a live Cart.

**Overall session status:** Partially Completed

**Notes:**

- Explicit scope exclusions honored: no Store routes, no redemption, no Redis, no subscribers, no customer segmentation,
  no analytics, no storefront UI, no unrelated refactoring were implemented.
- No approved formula was changed. `discount_capped`'s formula, `remaining_cap_capacity`'s formula, and the
  fixed/percentage voucher-discount formulas are byte-for-byte unchanged from the prior session — this session only
  added tests pinning them and new fields/functions alongside them.
- Client pricing data is still never trusted anywhere touched this session — `resolveEligibleItemsStep`'s `scope` input,
  like `discount_type`/`discount_value`/`global_cap_bps` before it, is a server-side workflow input, never sourced from
  the Store API request body (the `.strict()` validators from the prior session already reject any such client-supplied
  field).
- No money is calculated in an HTTP route this session — no route file was touched or created.
- Nothing writes directly to Cart totals this session — `resolveEligibleItemsStep` only decorates in-memory
  `LineValue[]`, never touches `cart.total`/`cart.metadata`.
