# Project: RallyGear – Badminton Equipment & Accessories Store

**Platform:** MedusaJS v2
**Feature:** Suggestive Selling (Product-Level & Cart-Level Recommendations)
**Document Level:** BA / Solution Design
**Purpose:** Approved solution-flow contract for generating developer-level specifications.
**Status:** Draft – requires manual review before generating `SPEC.md`
**Source of Truth:** SRS – Suggestive Selling Engine v1.0 (companion: SRS – Voucher at Checkout)

This document defines how the **SuggestionEngine** solution behaves at business and system-flow level.
It does **not** define source-code folders, files, functions, classes, database decorators, workflow-step names, or implementation details.

**Process:** BA → DEV (`plan.md`) → approve → implement

---

## 0. Document Control

### 0.1 Version History

| Version | Date | Author | Change |
| --- | --- | --- | --- |
| 0.1 | 2026-07-08 | BA | Initial draft from SRS v1.0 |
| 0.2 | 2026-07-08 | BA | Expanded flows, state models, worked examples, decision tables, rollout plan |

### 0.2 Related Documents

| Document | Relationship |
| --- | --- |
| SRS – Suggestive Selling Engine v1.0 | Source of truth for requirements (SUGG-1xx…4xx), edge cases (EC-xx), NFRs, test checklist (T-xx) |
| SRS – Voucher at Checkout | Owns discount validation/calculation rules (VOUCH-xxx); this solution binds to it through contract points C-01…C-06 only |
| Solution Flow – Voucher at Checkout (VoucherEngine) | Companion solution-flow contract; template and structural reference for this document |
| `SPEC.md` (to be generated) | Developer-level specification derived from this document after approval |
| `plan.md` (DEV) | Implementation plan produced by developers against `SPEC.md`; must preserve traceability IDs |

### 0.3 Conventions Used in This Document

- **SF-xx** — Solution Flow defined in Section 5. Flows are the primary contract unit.
- **BR-xx** — Normative Business Rule defined in Section 6. Rules are referenced by flows and must be independently testable.
- **SUGG-xxx / EC-xx / T-xx / SEC-xx / INT-xx / C-xx** — IDs carried over verbatim from the SRS for traceability. This document never renumbers SRS IDs.
- **"The system"** — the SuggestionEngine solution as a black box. Internal component names in Section 3 are responsibility labels, not code artifacts.
- **Money** — all amounts are integers in VND smallest unit (1 = 1 VND). Examples use realistic RallyGear catalog prices.
- **MUST / MUST NOT / SHOULD / MAY** — RFC-2119 semantics. Anything marked MUST maps to a Must-Have SRS requirement and blocks release.

### 0.4 Approval Workflow for This Document

1. BA completes draft (this version).
2. Manual review by: Product Owner (business rules, KPI definitions), Tech Lead (feasibility of flow contracts on MedusaJS v2), VoucherEngine owner (Section 10 contract), QA Lead (traceability, Section 15).
3. Open items in Section 17 resolved and folded into the flows.
4. Status flips to **Approved**; only then is `SPEC.md` generated. Any post-approval change re-opens review for the affected flows only.

---

## 1. Solution Overview

### 1.1 Business Context

RallyGear sells badminton equipment where the *primary* purchase (a racket, a pair of shoes) almost always implies *secondary* purchases (string, grip, bag, socks, shuttlecocks). Today those secondary purchases leak to competitors or later sessions. The SuggestionEngine closes that gap by recommending the right complementary item at the moment of highest intent:

- On the **product detail page**, while the customer evaluates a primary item → "Complete Your Setup".
- On the **cart page**, when the basket's composition reveals gaps, brand affinity, threshold proximity, or bulk-upgrade opportunities → "You Might Also Need".

The engine is deliberately **conservative by design**: it would rather show nothing than show something irrelevant, out of stock, already owned, already in the cart, or already dismissed. Every requirement about hiding sections, filtering, and dismissal exists to protect the shopping experience — the SRS is explicit that suggestions must "preserve a friction-free shopping experience".

### 1.2 Business Objectives & Success Metrics

| Objective | KPI | Definition (normative — see Section 13) | Direction |
| --- | --- | --- | --- |
| Increase basket size | Average Order Value (AOV) | Mean order total (post-discount) over period | ↑ |
| Increase cross-sell | Attachment Rate | % of orders containing ≥ 1 line item with suggestion attribution | ↑ |
| Prove rule quality | Add Rate per rule | adds ÷ impressions, per rule | ↑ |
| Protect UX | Dismissal Rate per rule | dismissals ÷ impressions, per rule | ↓ (watch metric) |
| Protect page speed | Product page LCP | Unchanged vs. pre-launch baseline (suggestions are lazy) | = |

The attribution model (Flow SF-09) is what makes these KPIs *measurable per rule* — this is a hard business requirement, not an analytics nice-to-have.

### 1.3 Scope

**In scope (this solution):**

- Product-level suggestion evaluation and display contract: "Complete Your Setup", 3–5 slots, tiered rules, ≤ 1 upsell slot.
- Cart-level suggestion evaluation and display contract: "You Might Also Need", up to 3 slots, rules CR-01…CR-04 including the threshold nudge with progress information.
- Three-tier rule model: Tier 1 manual curation, Tier 2 category complement, Tier 3 behavioral (**data model and rule schema only in Phase 1**; evaluation deferred to Phase 2 with no migration required).
- Exclusion filtering (six conditions) applied identically at both touchpoints, with slot backfill.
- One-tap add-to-cart with compact variant selector, 3-second undo window, and mandatory attribution metadata.
- Session-scoped dismissal memory with context separation and guest→customer merge on login.
- Suggestion refresh on every cart mutation; result caching with hard 5-minute TTL, synchronous invalidation, and O(1) versioned invalidation for cart rules.
- Interaction analytics (impression / tap / add_to_cart / dismiss), order-level attribution, per-rule performance reporting.
- Admin rule lifecycle via API: CRUD, scheduling windows, priority with conflict detection, dry-run preview, bulk import of manual curations, category-complement map management.
- Integration contract with Promotion/Voucher subsystem (C-01…C-06).

**Out of scope:**

- Voucher validation, discount calculation, stacking, capping (VoucherEngine solution flow).
- Catalog management, browsing/menu, authentication, payment (MoMo, Payoo, COD), order tracking, store locator.
- ML training pipelines, collaborative-filtering models, experiment management UI and significance reporting (Phase 2).
- CMS/Admin UI screens — admin behavior is API-only in this phase; UI is a separate workstream consuming the same APIs.
- Email / push recommendation campaigns.

### 1.4 Assumptions

| ID | Assumption | Impact if false |
| --- | --- | --- |
| A-01 | Every storefront session (guest or authenticated) has a stable `session_id` available to both the suggestion APIs and the event tracking pipeline | Dismissal memory and analytics sessionization break; Open Item OI-01 |
| A-02 | Each customer/guest resolves to exactly one "assigned store" for stock purposes at evaluation time | Stock filter (BR-02b) is ambiguous; Open Item OI-02 |
| A-03 | Promotional thresholds (e.g., free-shipping level) are configured in and readable from the Promotion subsystem — never duplicated inside suggestion rules | CR-02 badges could contradict checkout; Open Item OI-04 |
| A-04 | Product categories carry a durable/consumable classification (or an equivalent category list exists) | 30-day exclusion exemption (BR-02d) cannot be evaluated; Open Item OI-03 |
| A-05 | Sales-rank data (last 30 days) is available per product at evaluation time with acceptable freshness | Tier 2 and CR-01 ordering degrade to arbitrary order |
| A-06 | The platform emits a cart-change event on every cart mutation that both this engine and VoucherEngine can consume independently | Flows SF-06 and contract C-03 break |

### 1.5 Design Principles (normative)

1. **Never degrade the page.** Suggestion failure of any kind — evaluation error, timeout > 2s, cache outage, analytics outage — collapses to a *hidden section*, never an error state, never a blocked render (SUGG-205, INT-03, EC-12).
2. **Never lie about money.** Card prices are informational; the cart API is the only authoritative price source (C-05, SEC-02). Threshold badges are descriptive promises computed with the same math checkout uses (C-04), and even then checkout remains authoritative (EC-06).
3. **Never compute discounts.** Suggested items are ordinary line items to the pricing system (C-01, C-02). The engine's job ends at proposing products and tagging provenance.
4. **Respect "no".** A dismissal hides that suggestion in that context for the whole session, regardless of which rule proposes it again (SUGG-105, EC-09). No dark patterns: the upsell slot is a labeled badge, never pre-selected (SUGG-106).
5. **Everything measurable.** Every impression, tap, add, and dismissal is tracked with rule provenance; every suggested line item that survives to an order carries attribution (SUGG-301/302). If it can't be measured, it didn't happen.
6. **Bounded staleness.** No customer ever sees suggestion data older than 5 minutes, and cart-affecting changes invalidate synchronously (INT-04).
7. **Server decides.** All evaluation, filtering, ranking, enrichment server-side. The client renders, taps, and reports — nothing more (SEC-01…04).

---

## 2. Actors & Touchpoints

| Actor | Touchpoint | Goals | Key flows |
| --- | --- | --- | --- |
| **Customer — guest** | Product page, cart page | Complete a setup in one purchase; not be nagged | SF-01…SF-06; parity guaranteed by BR-08 |
| **Customer — authenticated** | Product page, cart page | Same, plus benefit from purchase-history awareness (30-day exclusion) | SF-01…SF-06, SF-05 login merge |
| **Storefront application** | Store suggestion APIs, add API, event API, dismiss API | Render sections fast; report interactions without blocking UX | SF-01…SF-06, SF-08 |
| **Admin / Merchandiser** | Admin rule APIs, complement-map API, import API, preview API | Run merchandising campaigns without code changes; QA rules before activation | SF-07, SF-10 |
| **Business Analyst** | Rule analytics API | Measure attachment rate, per-rule funnel, attributed revenue | SF-08, SF-09, Section 13 |
| **Commerce platform** (Cart, Product, Inventory, Pricing, Order, Promotion — built-in modules) | Internal queries + cart-change events | Provide source data; accept attributed line items; keep module boundaries clean (Link-pattern, no direct DB coupling) | All flows |
| **VoucherEngine** (companion custom module) | Shared cart-change events; line-item attribution flags | Revalidate vouchers on cart change; read attribution when reporting; never be blocked by suggestions | SF-03, SF-06, Section 10 |
| **Analytics pipeline** | Append-only event stream | Aggregate funnels and attribution with ≤ 15 min freshness | SF-08 |

---

## 3. Solution Components (business-level responsibilities)

Each component below is a **responsibility boundary**, not a code artifact. DEV may realize them as one MedusaJS module with internal services; the boundaries below define *what must be separable and testable*, not *how to structure folders*.

| # | Component | Responsibility | Owns data concept (Section 8) |
| --- | --- | --- | --- |
| 1 | **Rule Store** | Persist suggestion rules with type (product / cart), tier, priority, active flag, validity window, experiment fields. Enforce uniqueness of (type, tier, priority). Soft-delete only. | Suggestion Rule, Rule Item, Cart Condition |
| 2 | **Category Complement Map** | Ranked business mapping that drives Tier 2 backfill and CR-01 gap detection. Seeded: Rackets → Strings, Grips, Bags; Shoes → Socks, Insoles; Shuttlecocks → Tubes (bulk); Apparel → Wristbands, Headbands. Admin-manageable; duplicate pairs rejected. | Category Complement |
| 3 | **Evaluation Engine** | The seven-stage pipeline (context → rules → candidates → filter → rank/limit → enrich → cache) for both contexts. Entirely read-only against commerce data; deterministic given identical inputs (a hard requirement for dry-run preview to be trustworthy). | Cached Result (writes) |
| 4 | **Exclusion Filter** | Apply the six exclusion conditions (BR-02) identically in both contexts; report *which* filter removed *which* candidate (consumed by dry-run preview); trigger backfill. | — |
| 5 | **Attribution Tracker** | Create attribution transactionally with a suggested add; preserve through quantity changes; destroy with line-item removal; copy to order line at placement. Orphans impossible by construction (INT-05). | Line-Item Attribution |
| 6 | **Dismissal Memory** | Session-scoped set of (context × product) pairs, TTL = session, hard cap 24h; merge guest→customer on login; never persisted across sessions in Phase 1. | Dismissal Set |
| 7 | **Suggestion Cache** | 5-min TTL result cache per (product × store) and per cart; synchronous deletion on cart mutation; per-key deletion on product-rule change; version-counter lazy invalidation for cart-rule changes; 60-second advisory stock snapshots. | Cached Result |
| 8 | **Event Stream** | Accept batched interaction events (≤ 10/request), enum-and-id payloads only, rate-limited, fire-and-forget, append-only, immutable; anonymization of rows > 13 months. | Suggestion Event |
| 9 | **Admin Rule Service** | Rule CRUD + scheduling + priority conflict (409) + dry-run preview (no cache, no events) + bulk import with row-level validation. Every successful change triggers cache invalidation as a mandatory, synchronous side effect. | (operates on 1, 2) |

**Collaboration sketch (narrative):** The storefront talks only to the Evaluation Engine (reads), the add path (SF-03), the dismissal path (SF-05), and the Event Stream (writes). The Evaluation Engine reads from the Rule Store, the Complement Map, the commerce platform (products, categories, cart, inventory, prices, order history), and the Dismissal Memory, then writes to the Suggestion Cache. Cart mutations — from any source — invalidate the cache and fan out to both this engine and VoucherEngine through the platform's cart-change event. Admin changes flow through the Admin Rule Service, which writes the Rule Store / Complement Map and invalidates caches in the same operation.

---

## 4. End-to-End Narrative (worked example)

A single walkthrough that touches most flows; DEV should be able to replay this scenario as a smoke test after implementation.

> **Cast:** Linh, a guest shopper in Ho Chi Minh City. Free-shipping threshold: **7,000,000 VND** (matching the SRS acceptance example). Store's global discount cap: 50%.
>
> 1. Linh opens **Yonex Astrox 99 Pro** (4,500,000 VND). After the page paints, "Complete Your Setup" loads lazily (SF-01) showing: *BG65 String* (150,000), *Astrox Racket Bag* (890,000, custom label "Best Match"), *Yonex Cushion Grip* (45,000) — all Tier 1 manual curations in admin order — plus a Tier 2 backfill *Yonex Towel Grip* and, in slot 5, *Astrox 100 ZZ* (5,600,000, +24%) labeled **Upgrade Pick** (BR-05).
> 2. Linh dismisses the bag (SF-05). The card slides away; the slot backfills with the next Tier 2 candidate. A `dismiss` event is recorded. The bag will not reappear **on any product page** this session — but may appear in the cart context (EC-09).
> 3. Linh taps **Add** on *BG66 Ultimax String* — it has variants [White, Yellow, Red] and no default, so a bottom sheet opens (SF-03 variant branch). Red is out of stock at her assigned store: visible, disabled, labeled. She picks Yellow → line item added with attribution `{rule, product_view, source: Astrox 99 Pro}`, toast "BG66 Ultimax String added to cart — Undo".
> 4. She taps **Undo** within 3 seconds (SF-04): the line item and its attribution vanish, the card returns, **no dismissal is recorded** — undo means "not now", not "never".
> 5. She adds the racket itself, then a pair of **Yonex 65Z shoes** (2,200,000) from another page. Each mutation synchronously deletes the cart's suggestion cache and fires the cart-change event to both engines (SF-06).
> 6. On the **cart page** (subtotal 6,700,000 after a 10% item promotion on the shoes — the post-item-promotion number is what counts, C-04): CR-01 fires (racket, no string), CR-02 fires (within 15% of the 7,000,000 threshold; remaining = 300,000 → candidates priced 300,000–600,000, badge "Add for FREE shipping!", `threshold_info {7,000,000 / 6,700,000 / 300,000}` renders a progress bar), CR-03 fires (all-Yonex cart). Top 3 unique products across the rules are shown; the first proposing rule wins the badge (BR-04).
> 7. Linh adds the CR-02 item (a 350,000 VND shuttlecock tube). Threshold crossed; on the next evaluation CR-02 no longer fires; CR-04 now proposes the 3-tube bundle (consumable at qty 1).
> 8. She logs in to check out. Her guest dismissal set merges into her customer scope (SF-05); the 30-day purchase exclusion now applies — it turns out she bought a *Yonex Cushion Grip* 12 days ago (durable), so that card disappears (EC-10).
> 9. She applies a 20% voucher. VoucherEngine does its thing; suggestion attribution on her line items is untouched (C-06). She places the order. Attribution for the string and the tube is copied onto the order lines (SF-09); tomorrow the BA sees +2 converted items and their revenue against the responsible rules.

---

## 5. Solution Flows

Every flow specifies: trigger, preconditions, postconditions, main flow, alternate/exception flows, business rules invoked, events emitted, and SRS traceability. Flows are the unit DEV plans against; `plan.md` MUST reference flows by SF-id.

---

### SF-01 — Display Product-Level Suggestions

**Traceability:** SUGG-101, SUGG-102, SUGG-106, SUGG-205 · EC-05 · T-PL-01…07, T-PL-12

**Trigger:** Customer opens a product detail page. The suggestion request is issued **lazily after primary content** — it MUST NOT participate in, delay, or compete with the page's largest contentful paint.

**Preconditions:**
- Source product is resolvable (it may be inactive — see alternate A4).
- Session identity (guest or customer) and assigned store are resolvable.

**Postconditions:**
- Either a ranked, enriched list of 1–5 suggestions is returned and rendered, or an empty success result is returned and the section is not rendered at all. No third outcome exists.

**Main flow:**

| # | Step | Behavior |
| --- | --- | --- |
| 1 | Request | Storefront requests suggestions for (product, store, session). |
| 2 | Cache check | If a fresh cached result exists for (product × store): filter out entries this session has dismissed (dismissals are per-session and therefore never cached inside shared results), return, go to step 9. |
| 3 | Resolve context | Load: source product (with category, brand), customer profile if authenticated, session dismissal set, current cart contents, assigned store. |
| 4 | Load rules | Load rules where type = product, active, and *now* inside the validity window; order by tier then priority ascending. If a rule carries an experiment key, apply deterministic bucketing by hash of session id and its traffic split — losing bucket rules are simply not loaded (SUGG-304, Phase 1 = bucketing only). |
| 5 | Generate candidates | **Tier 1:** manual curations whose source is this product, in admin display order, carrying custom labels. **Tier 2:** only if fewer than 3 Tier 1 candidates *survive filtering* — top sellers (last-30-day sales rank) from this product's complementary categories per the Complement Map, enough to fill to the 3-minimum. **Tier 3:** skipped in Phase 1, always skipped for guests. |
| 6 | Filter | Apply BR-02 (six exclusions). Freed slots backfill: same tier first, then lower tier. Record filter provenance (needed by SF-07 dry-run; discarded in normal serving). |
| 7 | Rank & limit | Order: tier → (display order for Tier 1 / sales rank for Tier 2). Deduplicate by product. Evaluate the upsell slot per BR-05: at most one, rendered last. Cap at 5 total. |
| 8 | Enrich & cache | For each survivor: current price, discount price if any, default variant, `requires_variant_selection`, stock status; write result to cache with 5-min TTL. |
| 9 | Render | Section renders with per-card: image, name, price, discount price, optional label ("Best Match", "Upgrade Pick"), one-tap **Add**, dismiss control (X / swipe). Impressions fire per SF-08 once a card is ≥ 50% visible for ≥ 1s. |

**Alternate & exception flows:**

| ID | Condition | Behavior |
| --- | --- | --- |
| A1 | 0 eligible after filtering | Success response with empty list; section not rendered — never an empty shell, a lone skeleton, or an error (EC-05). |
| A2 | 1–2 eligible | Render what exists. The "3-minimum" governs *backfill effort*, not a display gate: the section renders from 1 item up. |
| A3 | Evaluation error or timeout > 2s | Section silently hidden. Page unaffected. Error is logged server-side; nothing surfaces to the customer (INT-03). |
| A4 | Source product inactive/unpublished | No suggestions are evaluated (the page itself is the platform's concern); empty success. |
| A5 | No manual rules AND no complement mapping for the category | Section not rendered (SUGG-101 third acceptance criterion). |

**Business rules invoked:** BR-01 (tiering & backfill), BR-02 (exclusions), BR-05 (upsell slot), BR-07 (money), BR-08 (guest parity).

**Events emitted:** `impression` per rendered card (via SF-08).

---

### SF-02 — Display Cart-Level Suggestions

**Traceability:** SUGG-201, SUGG-202, SUGG-205 · EC-05, EC-06 · T-CL-01…06, T-CL-10

**Trigger:** Cart page render, or the storefront re-fetching after a cart mutation (SF-06).

**Preconditions:** A cart exists (may be empty — alternate A2). Session and store resolvable.

**Postconditions:** Ranked, enriched list of 0–3 suggestions plus optional `threshold_info`; empty list ⇒ section hidden.

**Main flow:**

| # | Step | Behavior |
| --- | --- | --- |
| 1 | Request | Storefront requests cart suggestions (default limit 3). |
| 2 | Cache check | Cached entry valid only if its embedded cart-rules version equals the current global counter (BR-06). On hit: dismissal-filter, return. |
| 3 | Resolve context | Load cart line items with categories, brands, quantities, and the **post-item-promotion subtotal**; customer profile if any; dismissal set; store. |
| 4 | Load rules | type = cart, active, in window, ordered by priority. Experiment bucketing as in SF-01. |
| 5 | Evaluate CR-01…CR-04 in fixed priority order | See rule semantics table below. Each fired rule yields an ordered candidate list with rule provenance and (for CR-02) badge text. |
| 6 | Merge & dedupe | Union candidates preserving rule order; deduplicate by product — **the first (highest-priority) rule that proposed a product owns its badge** (BR-04). |
| 7 | Filter | Apply BR-02 identically to product level (SUGG-201: "All SUGG-102 exclusion filters apply identically at cart level"). |
| 8 | Rank, limit, enrich, cache | Cap at 3. Enrich as in SF-01, plus `threshold_info { target, current, remaining }` when CR-02 fired. Cache with embedded rules-version. |
| 9 | Render | Below the line-item list and above the order summary on mobile; sidebar on desktop. CR-02 card carries its badge; the frontend renders the threshold progress bar from `threshold_info`. |

**Cart rule semantics (normative):**

| Rule | Fires when | Candidates | Ordering | Badge |
| --- | --- | --- | --- | --- |
| **CR-01 Category gap** | Cart contains a category X that has a mapped complement Y, and no item of Y is in the cart | Top sellers of Y | Sales rank (30-day) | — |
| **CR-02 Threshold nudge** | Post-item-promotion subtotal is within 15% *below* a promotional threshold (voucher discount excluded — C-04) | Products with `remaining ≤ price ≤ remaining × 2` | Sales rank | "Add for FREE shipping!" or the promotion's admin-configured label |
| **CR-03 Brand affinity** | All cart items share one brand | Same-brand accessories | Sales rank | — |
| **CR-04 Consumable upsell** | A consumable item sits in cart at quantity 1 | The bulk/multipack version of that same item at better per-unit price | (single candidate per matching line) | — |

**Worked CR-02 example:** threshold 7,000,000; post-item-promotion subtotal 6,700,000 → within 15% (6,700,000 ≥ 7,000,000 × 0.85 = 5,950,000) → `remaining` = 300,000 → candidate price band **[300,000 … 600,000]** → `threshold_info = { target: 7,000,000, current: 6,700,000, remaining: 300,000 }`. A 20% voucher pulling the *payable total* to 5,360,000 changes **nothing** — CR-02 math never sees vouchers (T-CL-10).

**Alternate & exception flows:**

| ID | Condition | Behavior |
| --- | --- | --- |
| A1 | Multiple rules fire, > 3 unique candidates | Top 3 after dedupe; badge per BR-04. No product ever appears twice. |
| A2 | Empty cart | No cart rule can fire; empty success; section hidden. |
| A3 | 0 after filtering | Empty success, section hidden (EC-05). |
| A4 | Error / timeout > 2s | Section silently hidden; the cart page — including totals and checkout CTA — is never blocked (SUGG-205). |
| A5 | Threshold crossed between evaluations (price change, EC-06) | Badge is descriptive, not a price guarantee; checkout shipping calculation is authoritative; on the next evaluation CR-02 simply re-fires (or not) with fresh `remaining`. |

**Business rules invoked:** BR-02, BR-03 (CR ordering), BR-04 (dedupe/badge), BR-06 (versioned cache), BR-07, BR-08.

---

### SF-03 — One-Tap Add of a Suggested Item

**Traceability:** SUGG-103, SUGG-104 · EC-02, EC-03, EC-07 · SEC-01 · T-PL-08, T-PL-09, T-IN-03, T-IN-04

**Trigger:** Customer taps **Add** on any suggestion card (either context).

**Preconditions:** A rendered suggestion card exists; the storefront holds its attribution payload `{ rule_id, source_context, source_product_id }` from the evaluation response.

**Postconditions (success):** Exactly one new line item (qty 1) exists in the cart with a live attribution record; caches invalidated; cart-change cascade started; UX shows Added-state + Undo toast.

**Main flow (single or default variant):**

| # | Step | Behavior | On failure |
| --- | --- | --- | --- |
| 1 | Submit | Storefront sends: product, variant (default), qty 1, attribution payload, and a **client request identifier** (idempotency — EC-03). | — |
| 2 | Validate product | Product and variant must be active & published. | Reject with validation error; card refreshes. |
| 3 | Validate attribution | The submitted rule must be active **or recently active** (grace covers EC-04 staleness). Unknown/forged rules ⇒ the whole request is rejected; nothing is added; analytics cannot be poisoned (SEC-01). | 422-class rejection. |
| 4 | Authoritative stock check | Real inventory check at the assigned store — the 60-second advisory stock snapshot is **bypassed** here. | Conflict: "{Product} just went out of stock. We've updated your suggestions." Storefront refreshes the suggestion section (EC-02). |
| 5 | Idempotency gate | If (cart, product, rule, client-request-id) was already processed: return the **existing** line item unchanged — quantity never silently doubles (EC-03). | — |
| 6 | Add + attribute | Line item added; attribution record created **in the same transaction/compensable unit** — if attribution creation fails, the line item add is rolled back (INT-05). | Full rollback; generic retryable error. |
| 7 | Track | `add_to_cart` event emitted fire-and-forget; never blocks the response. | Swallowed; buffered per EC-12. |
| 8 | Cascade | Cart suggestion cache deleted; platform cart-change event fires → SF-06 (this engine) **and** voucher revalidation (C-03) run independently. | — |
| 9 | UX | Card flips to "Added ✓" for 3 s, then is replaced by the next eligible suggestion (if any). Toast: "{Product Name} added to cart" with a 3-second **Undo** (→ SF-04). | — |

**Variant-selection branch (SUGG-104):**

- Condition: the suggested product has multiple variants and **no default variant** is configured.
- Tapping Add opens a **compact selector** — bottom sheet on mobile, popover on desktop — never a navigation to the full product page.
- The selector shows **only** variant-level facts needed to choose: purchasable variants at the assigned store, per-variant price differences, one confirm button. Out-of-stock variants are shown disabled with an "Out of stock" label (so the customer understands why a color is missing rather than suspecting a bug).
- Confirm ⇒ continue at Main-flow step 1 with the chosen variant, identical attribution and toast behavior.
- **Closing the sheet is a no-op**: no add, and explicitly **not a dismissal** — the card stays.

**Business rules invoked:** BR-02 (the card shown was pre-filtered, but stock is re-checked authoritatively), BR-07, BR-09 (attribution lifecycle).

**Events emitted:** `add_to_cart` (success path only).

---

### SF-04 — Undo a Suggested Add

**Traceability:** SUGG-103 (undo clause) · EC-11 · T-PL-10, T-PL-11

**Trigger:** Customer taps **Undo** inside the 3-second toast window.

**Preconditions:** An attributed line item created by SF-03 exists.

**Postconditions (success):** Line item and its attribution are gone; suggestion caches invalidated so the card can reappear; **no dismissal recorded**.

**Main flow:**

| # | Step | Behavior |
| --- | --- | --- |
| 1 | Eligibility | Verify: the line item still exists, carries suggestion attribution, **and its quantity is unchanged since the add**. Any quantity change means the customer engaged with the item — undo is off the table. |
| 2 | Remove | Remove the line item; the attribution record is destroyed with it (BR-09). Compensable: if the flow fails mid-way, the removal is rolled back — the cart never ends in a half-state. |
| 3 | Restore | Invalidate suggestion caches so the next evaluation can re-propose the card. Explicitly do **not** write to Dismissal Memory. |
| 4 | Cascade | The removal is an ordinary cart mutation → SF-06 fires, including voucher revalidation (this matters: if the undone item was the only voucher-eligible item, EC-08 semantics apply). |

**Exception flow:** Undo arrives after the window closed, or after a quantity change ⇒ refused as **expired/gone**; the storefront hides the Undo affordance; the customer uses normal cart controls (which also destroy attribution on removal — BR-09).

**Semantic note (normative):** *Undo ≠ dismissal.* Undo says "not now"; dismissal says "not this session". Conflating them (e.g., recording a dismissal on undo "to be safe") is a defect.

---

### SF-05 — Dismiss a Suggestion (and Login Merge)

**Traceability:** SUGG-105, SUGG-204 · EC-09, EC-10 · T-PL-06, T-CL-08

**Trigger:** Customer taps the card's **X** (or swipes away on mobile).

**Main flow:**

| # | Step | Behavior |
| --- | --- | --- |
| 1 | Record | Dismissal Memory stores the pair **(source_context × suggested_product)** under the session's scope (customer scope if authenticated, session scope if guest). Lifetime = session, hard cap 24h. |
| 2 | UX | Card removed immediately; slot backfilled by the next eligible candidate from the current evaluation (no full re-evaluation needed just for a dismissal). |
| 3 | Track | `dismiss` event recorded per SF-08. |

**Scoping rules (normative — these answer every "will it come back?" question):**

| Question | Answer | Why |
| --- | --- | --- |
| Same product, same context, *different rule*? | Stays hidden all session | Dismissal keys on (context × product), not rule (EC-09) |
| Same product, *other* context (product page ↔ cart)? | Eligible | Context types are separate scopes (EC-09) |
| Next session? | Eligible again | Phase 1 dismissals never persist across sessions (SUGG-105) |
| Customer closed the variant sheet without choosing? | Not a dismissal | SF-03 variant branch is explicit on this |
| Customer tapped Undo? | Not a dismissal | SF-04 semantic note |

**Login merge (SUGG-204, EC-10):** When a guest authenticates mid-session:
1. The guest dismissal set is **merged into** the customer-scoped set for the remainder of the session (union, same TTL cap).
2. Subsequent evaluations additionally gain the 30-day purchase exclusion (BR-02d) from the customer's order history and, in Phase 2, Tier 3 eligibility. This MAY remove cards the guest was just seeing — that is correct behavior, not flicker to be suppressed.

---

### SF-06 — Cart Change → Refresh & Cascade

**Traceability:** SUGG-203 · C-03 · EC-01, EC-08 · T-CL-07, T-IN-01, T-IN-02

**Trigger:** *Any* cart mutation, from any source: manual add, suggested add (SF-03), undo (SF-04), removal, quantity change, merge-on-login.

**Main flow:**

| # | Step | Behavior |
| --- | --- | --- |
| 1 | Synchronous invalidation | The mutating operation deletes this cart's suggestion cache entry **in the same operation** — never "let the TTL handle it". |
| 2 | Fan-out | The platform's cart-change event reaches two independent consumers: (a) this engine's re-evaluation trigger, (b) VoucherEngine revalidation. Contract: neither consumer blocks the other; neither blocks the mutation; failure of one never suppresses the other (C-03). |
| 3 | Fresh evaluation | The next cart-suggestion read runs SF-02 from scratch. Consequences fall out naturally: a just-added string ⇒ CR-01 stops firing; a just-added suggested item ⇒ excluded by the in-cart filter (EC-01); a crossed threshold ⇒ CR-02 stops firing. |
| 4 | UX during re-evaluation | Skeleton loader **in the suggestion section only**. Line items, totals, promotions, checkout CTA: never blocked, never skeletonized because of suggestions. |

**Interaction case (EC-08, normative):** Customer removes a suggested item that happened to be the cart's only voucher-eligible item →
- VoucherEngine auto-removes the voucher under its own rule (VOUCH-005(c)) and owns the customer-facing reason message;
- this engine does nothing special — and on the next evaluation it MAY legitimately re-suggest the removed item (it is no longer in cart and was never dismissed). Both behaviors together are correct; suppressing the re-suggestion would be a defect.

---

### SF-07 — Admin Rule Lifecycle & Cache Coherence

**Traceability:** SUGG-401, SUGG-402, SUGG-403, SUGG-404 · EC-04 · T-AD-01…04

**Trigger:** Admin (authenticated, admin role — SEC-03) creates / updates / deactivates a rule, or edits the category complement map.

**Sub-flow 7a — Create / Update:**

| # | Step | Behavior |
| --- | --- | --- |
| 1 | Validate shape | Product rules: name, tier, priority, validity window, ordered items (source product → suggested product, display order, optional custom label). Cart rules: one or more typed conditions (`category_missing`, `threshold_near`, `brand_match`, `consumable_upsell`) with JSON parameters — parameters are **data**, so tuning (e.g., threshold_pct 15 → 10) never needs a schema change. |
| 2 | Priority conflict | (type, tier, priority) must be unique among rules. Collision ⇒ refuse with a conflict response (409-class); nothing is written. |
| 3 | Persist | Write rule. Scheduling: `valid_from` / `valid_to` nullable = always active; at evaluation only rules active AND inside the window load, ordered tier → priority ascending. |
| 4 | Invalidate — same operation | **Product rules:** delete the cached results of every source product the rule references (before and after images of the rule, on update). **Cart rules:** bump the global cart-rules version counter — every cart cache entry self-invalidates lazily on its next read, O(1) regardless of how many carts exist (BR-06). |

**Sub-flow 7b — Deactivate (soft delete):** flip active → false; rule stops loading at evaluation; historical analytics stay fully queryable against it; invalidation as in 7a-4. Hard deletes do not exist in this solution.

**Bounded-staleness guarantee (EC-04):** a customer who already holds a rendered result may keep seeing a deactivated rule's suggestion for at most the 5-minute TTL. Tapping Add on it still succeeds — the *product* is real; only the rule retired. No customer-facing error; the attribution records the rule that was active at add time (this is why SF-03 step 3 accepts "recently active" rules).

**Sub-flow 7c — Dry-run preview (SUGG-404, Should-Have):**
- Input: a source product id (product rules) **or** a synthetic cart payload (cart rules).
- Output: exactly what the engine would serve **plus** the full reject list — every filtered-out candidate annotated with the removing filter: `in_cart | out_of_stock | dismissed | recent_purchase | self | inactive`.
- Guarantees: **no cache writes, no analytics events** — a merchandiser can preview a hundred times without polluting metrics. Determinism of the Evaluation Engine (Section 3, #3) is what makes preview results trustworthy as a QA gate before activation.

**Sub-flow 7d — Complement map management:** ranked (source category → complement category) pairs; duplicate pair ⇒ conflict response; changes invalidate like cart-rule changes (they affect Tier 2 and CR-01 everywhere).

---

### SF-08 — Interaction Tracking

**Traceability:** SUGG-301, SUGG-303 · SEC-04, SEC-05 · EC-12 · INT-02 · T-AN-01

**Trigger:** Four interaction moments, defined precisely:

| Action | Definition (normative) |
| --- | --- |
| `impression` | Card rendered ≥ 50% visible in viewport for ≥ 1 continuous second. One impression per card per evaluation render — re-scrolling past the same card in the same render does not multi-count. |
| `tap` | Customer tapped the card **body** (navigating to the product). Tapping Add is *not* a tap event — it produces `add_to_cart`. |
| `add_to_cart` | SF-03 completed successfully (emitted server-side at step 7, so it can't be forged or lost to a dropped client). |
| `dismiss` | SF-05 completed. |

**Event payload (every event):** rule, source context (`product_view | cart`), source product (nullable — null for cart context), suggested product, customer (nullable), session, action, tier, slot position, timestamp.

**Transport contract:**
- Client-side events batched, **max 10 per request**, fire-and-forget; server accepts asynchronously (202-style) — ingestion never sits on a rendering or interaction critical path.
- **No free-text fields.** Enums and identifiers only; anything else rejected (SEC-04 — injection into the analytics pipeline is structurally impossible).
- Rate limit: 60 requests/min per session (SEC-04).
- Outage behavior (EC-12): client buffers locally with a hard bound (max 100 events / 5 min) and retries; when the buffer overflows, oldest events drop silently. Rendering and add-to-cart are **never** blocked by analytics availability.

**Storage contract:** append-only, immutable (INT-02) — corrections happen only in the aggregation layer, never by mutating events. Rows older than 13 months are anonymized (customer id nulled — SEC-05). Volume expectation: write-heavy; the SRS mandates monthly partitioning by creation date for analytics queries.

**Reporting (SUGG-303, Should-Have):** per rule and date range: impressions, taps, adds, dismissals, CTR (taps ÷ impressions), add rate (adds ÷ impressions), dismissal rate (dismissals ÷ impressions), converted items, attributed revenue, attachment contribution. Freshness ≤ 15 minutes via async aggregation of the stream. Formal KPI definitions: Section 13.

---

### SF-09 — Order Placement Attribution

**Traceability:** SUGG-302 · C-06 · T-AN-02, T-AN-03

**Trigger:** An order is placed from a cart containing ≥ 1 attributed line item.

**Main flow:**

| # | Step | Behavior |
| --- | --- | --- |
| 1 | Copy | For each attributed cart line item, copy `{ suggestion_rule_id, source_context, tier }` onto the corresponding **order** line item. |
| 2 | Persist through pricing | Voucher application, discount capping, or voucher removal at any point before placement never stripped the attribution (C-06) — so the copy at placement is complete. |
| 3 | Aggregate | The analytics layer counts the converted item and its revenue against the responsible rule (visible in per-rule analytics within the 15-min freshness window). |

**Attribution lifecycle rules (BR-09, restated here because SF-09 is where they pay off):**

| Cart event before placement | Attribution outcome |
| --- | --- |
| Quantity changed (up or down, ≥ 1) | **Preserved** — the intent originated from a suggestion |
| Line item deleted | **Destroyed** with the line item |
| Same product manually re-added after deletion | **No attribution** — a manual add is a manual add (T-AN-03) |
| Undo (SF-04) | Destroyed (special case of deletion) |
| Voucher applied / capped / removed | Untouched (C-06, T-IN-01) |

---

### SF-10 — Bulk Import of Manual Curations *(Could-Have)*

**Traceability:** SUGG-405

**Trigger:** Admin uploads CSV/JSON of manual product-to-product links — the onboarding path for RallyGear's ~2,000-SKU catalog.

**Main flow:**
1. Accept rows of `(source_product_id, suggested_product_id, display_order, label)`.
2. Validate **row-by-row**, independently: products must exist and be resolvable; self-links rejected (BR-02e applies at authoring time too); duplicate (source, suggested) pairs within the upload or against existing curations rejected.
3. Respond with `{ accepted, rejected: [{ row, reason }] }` — partial success is the designed outcome; one bad row never poisons the batch.
4. Accepted rows land as Tier 1 rule items; cache invalidation per SF-07 sub-flow 7a-4 for every referenced source product.

---

## 6. Business Rules Catalog (normative)

Rules are numbered BR-xx and referenced by flows. Each is independently testable.

### BR-01 — Tiering & Backfill (SUGG-101)

| Tier | Source | When it contributes | Ordering within tier |
| --- | --- | --- | --- |
| 1 — Manual curation | Admin product-to-product links | Always first | Admin display order |
| 2 — Category complement | Top sellers (last 30 days) from mapped complementary categories | Only when Tier 1 yields **< 3 survivors after filtering**; fills up to the 3-minimum (may fill to 5 if Tier 1 is empty) | Sales rank |
| 3 — Behavioral | Purchase/browsing signals | **Phase 2.** Schema/data model accept `tier = behavioral` today so Phase 2 needs no migration. Evaluation skips it in Phase 1, and always for guests | (Phase 2) |

Display gates: section renders from **1** eligible item; target fill 3–5 (product) / ≤ 3 (cart); an empty result hides the section entirely.

### BR-02 — Exclusion Filter (SUGG-102) — identical in both contexts

A candidate is removed if **any** of the following holds:

| Cond. | Exclusion | Notes |
| --- | --- | --- |
| (a) | Already in the customer's cart — **any variant** | Product-level match, not variant-level |
| (b) | Out of stock at the assigned store — **all variants** | One purchasable variant keeps the product eligible; per-variant availability is then handled in the SF-03 selector |
| (c) | Dismissed this session **in this context type** | SF-05 scoping table governs |
| (d) | Purchased by this customer within the last 30 days — **durables only** | Consumables exempt: strings, shuttlecocks, grips, socks (list ownership: OI-03). Guests: not evaluable → skipped (BR-08) |
| (e) | Candidate = source product | Self-suggestion guard (product context only) |
| (f) | Inactive, unpublished, or outside its sales window | Product-level lifecycle |

Backfill on removal: same tier first, then lower tiers. Filter provenance is recorded for dry-run preview and discarded in normal serving.

### BR-03 — Cart-Rule Priority (SUGG-201)

Cart rules evaluate in the fixed order **CR-01 → CR-02 → CR-03 → CR-04**. Priority is about candidate ordering and badge ownership, not exclusivity — multiple rules may fire simultaneously.

### BR-04 — Merge, Dedupe & Badge Ownership (SUGG-201)

Union all fired rules' candidates in rule-priority order → deduplicate by product → **first proposing rule wins the badge** → cap at 3. A product proposed by CR-01 and CR-02 shows once, with no badge unless CR-01 ranks after CR-02 for it — which cannot happen given fixed ordering, so in practice: a CR-02 badge appears only on products CR-01 did not already claim.

### BR-05 — Upsell Slot (SUGG-106, Should-Have)

At most **1** of the 5 product-level slots. Qualification: same category as source; price **+10% to +40%** above source; strictly better sales rank **or** admin "featured" flag (OI-06). Presentation: labeled **"Upgrade Pick"**, rendered **last**, differentiated by label badge only — **no dark patterns, no pre-selection, no default-checked anything**. All BR-02 filters apply. No qualifying candidate ⇒ the slot reverts to a normal complementary suggestion.

### BR-06 — Cache Coherence

| Cache | Scope | TTL | Invalidation |
| --- | --- | --- | --- |
| Product suggestions | (product × store) | 5 min | Per-key delete on any rule change referencing that source product; on stock-out event for a suggested product |
| Cart suggestions | cart | 5 min | Synchronous delete on any cart mutation; **lazy version check** — each entry embeds the cart-rules version counter at write time and is treated as a miss when the counter has moved (counter increments on any cart-rule or complement-map change) |
| Stock snapshot | (product × store) | 60 s | Expiry only — **advisory**; SF-03 always re-checks authoritatively |
| Dismissals | session | session (≤ 24h) | Expiry; merged on login |

Worst-case staleness for any customer-visible suggestion data: **5 minutes** (INT-04).

### BR-07 — Money

Integers, smallest currency unit, VND (1 = 1). No floating point in threshold math, price bands, enrichment, or analytics revenue (INT-01). Percentage computations round toward the customer's benefit where an ambiguity exists (e.g., price-band boundaries are inclusive).

### BR-08 — Guest / Authenticated Parity (SUGG-204)

| Capability | Guest | Authenticated |
| --- | --- | --- |
| Product & cart suggestions | ✔ full | ✔ full |
| Dismissals | ✔ keyed by session | ✔ keyed by customer |
| 30-day purchase exclusion (BR-02d) | ✖ skipped (no history) | ✔ |
| CR-03 brand analysis | ✔ cart data only | ✔ cart data only (same — by design) |
| Tier 3 behavioral | ✖ always | ✖ Phase 1 / ✔ Phase 2 |
| Login mid-session | → dismissals merge; BR-02d activates (EC-10) | — |

### BR-09 — Attribution Lifecycle (SUGG-302, INT-05)

Created **transactionally** with the suggested add (SF-03 step 6 — orphans impossible by construction). Preserved through quantity changes. Destroyed with line-item deletion (including undo). Never re-created by manual re-add. Never touched by any voucher operation (C-06). Copied to the order line at placement (SF-09).

### BR-10 — Non-Fatal Everything (INT-03)

Any failure in evaluation, caching, enrichment, or tracking degrades to a hidden section or a silently dropped event. The only customer-visible errors this solution may produce are: the SF-03 stock conflict (EC-02, with its friendly message) and the SF-04 expired-undo refusal (EC-11, which merely hides the Undo affordance).

---

## 7. State Models

### 7.1 Suggestion Card (frontend contract)

```
 (evaluation) ──▶ RENDERED ──impression rule met──▶ SEEN
     SEEN ──tap body──▶ (navigate to product; card unchanged)
     SEEN ──tap Add, single/default variant──▶ ADDING ──success──▶ ADDED✓ (3s) ──▶ REPLACED-BY-NEXT
     SEEN ──tap Add, multi-variant──▶ SELECTOR-OPEN ──confirm──▶ ADDING
                                   └──close sheet──▶ SEEN            (no dismissal)
     ADDED✓ ──Undo within 3s──▶ RESTORED (card returns; no dismissal)
     ADDING ──stock conflict (EC-02)──▶ SECTION-REFRESH (card disappears with message)
     SEEN ──X / swipe──▶ DISMISSED (this context, this session) ──▶ slot backfilled
```

### 7.2 Attribution Record

```
 CREATED (with line item, transactional)
   ├─ quantity change ──▶ CREATED (unchanged)
   ├─ voucher applied/capped/removed ──▶ CREATED (unchanged, C-06)
   ├─ line item deleted / undo ──▶ DESTROYED (terminal)
   └─ order placed ──▶ COPIED-TO-ORDER-LINE (terminal for the cart-side record)
```

### 7.3 Cache Entry (cart suggestions)

```
 WRITTEN {payload + rules_version v} 
   ├─ read & version==current & TTL alive ──▶ HIT
   ├─ read & version<current ──▶ LAZY-MISS (re-evaluate, rewrite)
   ├─ cart mutation ──▶ DELETED (synchronous)
   └─ TTL 5min ──▶ EXPIRED
```

---

## 8. Data Concepts (business-level, not schema)

DEV derives the physical model in `SPEC.md`; this section fixes *what must exist and how it behaves*, aligned with SRS Section 8 without prescribing decorators or table names.

| Concept | Captures | Lifecycle & integrity contract |
| --- | --- | --- |
| **Suggestion Rule** | Name; type (product / cart); tier (manual / category / behavioral); priority; active flag; validity window; experiment key + traffic split (nullable, Phase 1 fields-only) | Unique (type, tier, priority). Soft-delete only. Historical analytics remain queryable against deactivated rules |
| **Rule Item** | Ordered (source product → suggested product) link with display order and optional custom label ("Best Match", "Upgrade Pick") | Belongs to a product-type rule; product references via the platform's cross-module Link pattern — no foreign-key coupling into the Product module |
| **Cart Condition** | Typed condition (`category_missing` / `threshold_near` / `brand_match` / `consumable_upsell`) with JSON parameters (e.g., `{source_category, target_category}`, `{threshold_pct: 15, max_price_multiple: 2}`) | Belongs to a cart-type rule; parameters are data — tuning requires no schema change |
| **Category Complement** | Ranked (source category → complement category) pair, active flag | Seeded per Section 3 #2; duplicate pairs rejected; category references via Link pattern |
| **Suggestion Event** | One interaction with full provenance (rule, context, source product nullable, suggested product, customer nullable, session, tier, slot, action, timestamp) | Append-only, immutable (INT-02); write-heavy — partitioned monthly by creation date; customer id anonymized after 13 months (SEC-05) |
| **Line-Item Attribution** | (cart line item → rule, context, source product nullable, tier, attributed-at) | BR-09 lifecycle; linked to the cart line via Link pattern; copied into order-line metadata at placement |
| **Dismissal Set** | Session-scoped set of `{context}:{product}` entries | TTL = session, ≤ 24h; guest set unions into customer scope on login; never cross-session in Phase 1 |
| **Cached Result** | Enriched suggestion list (+ `threshold_info` for carts; + embedded rules-version for cart keys) | BR-06 governs entirely |

**Module-boundary contract (MedusaJS v2 specific, still non-implementation):** the SuggestionEngine is a self-contained custom module. All references into built-in modules (Product, ProductCategory, Cart line items) use the **Link pattern**; consumption of cart changes uses the platform's **event/subscriber** mechanism; multi-step operations with side effects (SF-03, SF-04, SF-07 invalidation) are **compensable orchestrations** — each mutating step declares its rollback, read-only steps declare none (SRS Section 10). Naming those workflows/steps is `SPEC.md`'s job, not this document's.

---

## 9. Caching & Invalidation Strategy (scenario view)

The same rules as BR-06, expressed as "what happens when":

| # | Event | Product-suggestion caches | Cart-suggestion caches | Stock snapshots | Dismissals |
| --- | --- | --- | --- | --- | --- |
| 1 | Cart mutation (any) | untouched | **this cart's entry deleted synchronously** | untouched | untouched |
| 2 | Product rule created/updated/deactivated | **per-key delete for every referenced source product** | untouched | untouched | untouched |
| 3 | Cart rule or complement map changed | untouched (complement changes also delete affected product keys — Tier 2 depends on the map) | **version counter bumped → all entries lazy-miss on next read, O(1)** | untouched | untouched |
| 4 | Suggested product stock-out event | **affected product keys deleted** | (next read after any cart mutation refreshes anyway) | expires ≤ 60s | untouched |
| 5 | Customer dismisses | untouched (dismissals filter at read time — shared caches never contain per-session state) | untouched (same) | untouched | **entry added** |
| 6 | Login | untouched | untouched | untouched | **guest set merges into customer set** |
| 7 | Nothing for 5 minutes | expired | expired | expired (60s) | alive ≤ session |

Design consequence worth stating explicitly for DEV: **per-session data (dismissals) never enters shared caches.** Cached results are session-agnostic; dismissal filtering is applied at read time. This is what lets one cache entry serve every visitor of a product page.

---

## 10. Integration Contract with Promotion / VoucherEngine

Authoritative discount rules live in the Voucher solution flow (VOUCH-003). This solution binds to exactly six contract points — nothing else about vouchers may be assumed:

| ID | Contract | Worked example |
| --- | --- | --- |
| **C-01** | A suggested line item with its own item-level promotion receives it exactly as a manually added item would. Attribution never affects price. | BG65 String 150,000 with "30% off strings" ⇒ 105,000 — identical whether added via suggestion or search. |
| **C-02** | Ordering: item promotions first (on original prices) → voucher second (on the post-promotion subtotal) → global discount cap (default 50% of **original** subtotal) last, **reducing only the voucher**, never item promotions. | Original 1,000,000; item promos −300,000 → 700,000; 40% voucher −280,000 → 420,000; total discount 580,000 > cap 500,000 ⇒ voucher trimmed to −200,000; item promos intact. Engine's role in all of this: none (EC-07). |
| **C-03** | Adding/removing a suggested item emits the same cart-change event as any mutation → suggestion refresh **and** voucher revalidation, independent consumers. | SF-03 step 8, SF-06 step 2. |
| **C-04** | CR-02 threshold math = post-item-promotion subtotal, **voucher excluded** — byte-identical to Promotion-module threshold evaluation, so a nudge badge never promises what checkout won't honor. | SF-02 worked example; T-CL-10. |
| **C-05** | Card prices are informational enrichment; the cart API is the only authoritative price source. Client tampering has no monetary effect. | SEC-02. |
| **C-06** | Voucher application, capping, or removal never strips attribution metadata. | BR-09; T-IN-01. |

**Anti-contract (things this engine explicitly must NOT do):** compute any discount; write anything the Pricing/Promotion modules own; special-case attributed items in any pricing path; suppress a legitimate re-suggestion because a voucher event happened (EC-08); block or be blocked by voucher revalidation.

---

## 11. Edge-Case Decision Matrix

Every row is a must-pass behavior with its rationale — DEV treats these as executable acceptance scenarios, QA maps them to T-xx tests.

| ID | Scenario | Contracted behavior | Rationale |
| --- | --- | --- | --- |
| EC-01 | Add suggested item on product page → open cart | Cart evaluation is fresh (cache was synchronously invalidated); the item is excluded by BR-02a | The most common journey must never re-suggest what was just added |
| EC-02 | Stock-out between render and Add | Authoritative check at execution → conflict + "{Product} just went out of stock. We've updated your suggestions." + section refresh | Advisory 60s snapshots are for display; money-adjacent actions re-verify |
| EC-03 | Double-tap / two devices adding simultaneously | Idempotency on (cart, product, rule, client-request-id) → single line item; duplicate returns the existing item | Quantity must never silently double |
| EC-04 | Rule deactivated under warm caches | Staleness ≤ 5-min TTL; Add on a stale card still succeeds; attribution records the rule active at add time; zero customer-facing errors | Products outlive rules; punishing the customer for admin timing is unacceptable |
| EC-05 | Everything filtered out | Empty success + hidden section — never an error, never placeholders | Principle 1 |
| EC-06 | Price change drops cart back under threshold after a nudge add | Badge is descriptive, not a guarantee; checkout shipping calc authoritative; CR-02 may re-fire with fresh `remaining` | Principle 2 |
| EC-07 | 30% item promo + 20% voucher approaching the 50% cap | Engine does nothing special: promo intact, VoucherEngine trims voucher, attribution preserved | C-01/02/06 |
| EC-08 | Remove the only voucher-eligible (suggested) item | Voucher auto-removed by VoucherEngine with its message; item becomes re-suggestible | Two correct behaviors, independently owned |
| EC-09 | Dismissed product proposed by another rule / other context | Same context: hidden all session regardless of rule. Other context: eligible | SF-05 scoping table |
| EC-10 | Guest logs in mid-session | Dismissals merge; BR-02d activates and may remove visible cards — correct, not flicker | BR-08 |
| EC-11 | Undo after window / after quantity change | Refused as expired; Undo affordance hidden; normal cart controls take over (attribution destroyed on removal) | SF-04 |
| EC-12 | Tracking endpoint down/slow | Client buffers (≤ 100 events / 5 min) + retry; overflow drops oldest; UX never blocked | Principle 1; analytics loss is acceptable, UX loss is not |

---

## 12. Non-Functional Contract

### 12.1 Performance (p95 unless noted)

| Operation | Target | Conditions |
| --- | --- | --- |
| Product-level suggestion load | < 800 ms | Cache-hit dominated; cold miss: DB evaluation < 500 ms + cache write. Lazy — never in the LCP path |
| Cart-level evaluation | < 600 ms | Triggered async post-mutation; skeleton in section only |
| One-tap add incl. authoritative stock check | < 500 ms | Stock check hits Inventory directly; add + attribution in one compensable unit |
| Event ingestion (batched) | < 200 ms, async accept | Append-only insert; aggregation offline |
| Cache hit rate | > 85% | Monitored continuously; alert below threshold |
| Analytics freshness | ≤ 15 min | Async aggregation |
| Sustained evaluation throughput | 500 evaluations/sec | Campaign-peak sizing; stateless workers, horizontal scale |

### 12.2 Reliability & Integrity

- INT-01 — integer money everywhere (BR-07).
- INT-02 — immutable event stream; corrections in aggregation only.
- INT-03 — non-fatal degradation everywhere (BR-10).
- INT-04 — bounded staleness: hard 5-min TTL + synchronous invalidation + O(1) versioned cart invalidation.
- INT-05 — attribution transactional with the line item; orphans impossible by construction.

### 12.3 Security & Privacy

- SEC-01 — server-side evaluation only; client-submitted attribution validated against active/recently-active rules; forgery ⇒ rejection, nothing added, analytics unpoisoned.
- SEC-02 — card prices informational; cart API authoritative; client tampering has no monetary effect.
- SEC-03 — admin APIs: authenticated + admin role. Storefront APIs scoped to the requesting session/customer; no session can read another's dismissals or suggestions.
- SEC-04 — event payloads: enums + ids only, no free text; batch endpoint rate-limited 60 req/min/session.
- SEC-05 — Tier 3 signals are first-party only under the published privacy policy; session identifiers rotate on logout; event rows > 13 months anonymized.

---

## 13. Analytics & KPI Definitions (normative)

So that BA, DEV, and QA compute the same numbers:

| Metric | Formula | Grain |
| --- | --- | --- |
| Impressions | count(action = impression) | rule × day (and rollups) |
| CTR | taps ÷ impressions | rule × date range |
| Add rate | adds ÷ impressions | rule × date range |
| Dismissal rate | dismissals ÷ impressions | rule × date range |
| Converted items | count of order line items carrying attribution for the rule | rule × date range |
| Attributed revenue | Σ (order-line paid amount) over converted items | rule × date range |
| Attachment rate | orders with ≥ 1 attributed line ÷ all orders | store × date range |
| Attachment contribution | rule's converted-item orders ÷ all attached orders | rule × date range |
| Add→purchase conversion | converted items ÷ adds | rule × date range |

Notes: (1) "paid amount" is post-all-discounts — attribution revenue must not be inflated by pre-voucher prices; (2) an order with two attributed lines from two rules counts once for attachment rate, once per rule for contribution; (3) impressions from dry-run previews do not exist by construction (SF-07c emits no events).

---

## 14. Rollout & Phasing

| Capability | Phase 1 (this release) | Phase 2 |
| --- | --- | --- |
| Tier 1 manual + Tier 2 complement | ✔ | ✔ |
| Tier 3 behavioral | schema + `tier=behavioral` accepted; evaluation skipped | evaluation on (collaborative filtering) |
| Experimentation (SUGG-304) | `experiment_key` + `traffic_split` fields + deterministic bucketing | management UI + significance reporting |
| Dismissal persistence | session only (≤ 24h) | cross-session candidate (product decision) |
| Bulk import (SF-10) | Could-Have — schedule permitting | ✔ |
| Admin UI | ✖ (API only) | separate workstream on same APIs |

**Launch prerequisites:** complement map seeded (Section 3 #2); initial Tier 1 curations imported for hero SKUs; per-rule analytics visible before enabling for 100% traffic; NFR dashboard (cache hit rate, p95s, error-hide rate) live.

**Suggested rollout guardrail (BA recommendation, not SRS-mandated):** enable product-level first, cart-level one week later; watch dismissal rate per rule — any rule with dismissal rate > add rate over a meaningful sample is a candidate for deactivation via SF-07b, which is a zero-deploy operation by design.

---

## 15. Acceptance Traceability

`plan.md` MUST map every flow to the SRS test checklist; QA signs off against this table.

| Solution flow | SRS acceptance tests |
| --- | --- |
| SF-01 Product-level display | T-PL-01, T-PL-02, T-PL-03, T-PL-04, T-PL-05, T-PL-06, T-PL-07, T-PL-12 |
| SF-02 Cart-level display | T-CL-01, T-CL-02, T-CL-03, T-CL-04, T-CL-05, T-CL-06, T-CL-10 |
| SF-03 One-tap add (+variants) | T-PL-08, T-PL-09, T-IN-03, T-IN-04, T-AN-04 |
| SF-04 Undo | T-PL-10, T-PL-11 |
| SF-05 Dismissal & login merge | T-PL-06, T-CL-08 |
| SF-06 Cart-change cascade | T-CL-07, T-CL-09, T-IN-01, T-IN-02 |
| SF-07 Admin lifecycle & preview | T-AD-01, T-AD-02, T-AD-03, T-AD-04 |
| SF-08 Tracking | T-AN-01 |
| SF-09 Order attribution | T-AN-02, T-AN-03 |
| SF-10 Bulk import | (tests to be authored with SUGG-405 if scheduled) |

Coverage check: all 26 SRS tests (12 T-PL, 10 T-CL/T-IN cart-side, 4 T-AN, 4 T-AD — per SRS Section 13) are claimed by at least one flow. Unmapped tests at `plan.md` review time are a blocking finding.

---

## 16. Risks

| # | Risk | Likelihood | Impact | Mitigation in this design |
| --- | --- | --- | --- | --- |
| R-01 | Sales-rank data stale or missing → Tier 2 / CR-01 quality collapses | M | M | A-05; fallback ordering must be defined in `SPEC.md` (e.g., newest-first); monitored via per-rule add rate |
| R-02 | Threshold config drift between suggestion math and checkout | L | H | C-04 single-source contract (A-03/OI-04); T-CL-10 regression test |
| R-03 | Cache invalidation bug → stale suggestions beyond 5 min | M | M | Hard TTL as backstop regardless of invalidation correctness (INT-04) |
| R-04 | Event volume under campaign load stresses ingestion | M | L | Async accept, batching, rate limit, monthly partitioning; loss is bounded and acceptable (EC-12) |
| R-05 | Over-suggestion harms UX / brand ("pushy") | M | H | Dismissal memory, hidden-section defaults, no dark patterns (BR-05), dismissal-rate watch metric with zero-deploy rule deactivation |
| R-06 | Guest store-assignment ambiguity blocks stock filtering | M | M | OI-02 must close before `SPEC.md` |

---

## 17. Open Items for Manual Review (blockers for `SPEC.md`)

| ID | Item | Owner | Blocking |
| --- | --- | --- | --- |
| OI-01 | **Session lifetime definition.** SRS caps dismissal memory at "session, max 24h" — confirm the platform's actual session TTL so Dismissal Memory, analytics sessionization, and the 24h cap agree. | Tech Lead | SF-05, SF-08 |
| OI-02 | **Assigned-store resolution for guests.** Geo default? Explicit picker? First page visit? Stock filtering (BR-02b) and SF-03 step 4 depend on a deterministic answer. | PO + Tech Lead | SF-01/02/03 |
| OI-03 | **Consumable list ownership.** BR-02d hardcodes four consumable categories. Admin-configurable in Phase 1, or fixed list? | PO | BR-02 |
| OI-04 | **Threshold source of truth.** Confirm CR-02 reads thresholds (and their admin-configured badge labels) from Promotion-subsystem configuration — never duplicated in suggestion rules. | VoucherEngine owner | SF-02, C-04 |
| OI-05 | **Experiment bucketing determinism.** Confirm hash function and salt policy for `hash(session_id)` so Phase 2 buckets are reproducible against Phase 1 traffic. | Tech Lead | SF-01/02 step "load rules" |
| OI-06 | **Upsell "featured" flag.** Existing product attribute or new admin-managed flag? | PO | BR-05 |
| OI-07 | **SF-10 scheduling.** Bulk import is Could-Have; decide in or out for Phase 1 launch (affects onboarding plan for ~2,000 SKUs). | PO | SF-10, Section 14 |

---

## 18. Glossary

| Term | Definition |
| --- | --- |
| Attachment rate | % of orders containing ≥ 1 line item with suggestion attribution |
| Attribution | Provenance metadata `{rule, context, tier, source product}` carried by a line item added through a suggestion |
| Backfill | Filling freed/empty slots from the same tier, then lower tiers, after filtering |
| Context (source context) | Where a suggestion is shown: `product_view` or `cart`; the scope unit for dismissals |
| Dismissal | Explicit customer rejection (X / swipe) hiding a (context × product) pair for the session |
| Suggested line item | A cart line item carrying live attribution |
| Threshold nudge | CR-02: recommending affordable items that push the cart over a promotional threshold |
| Tier | Rule priority band: 1 manual, 2 category complement, 3 behavioral (Phase 2) |
| Upsell slot | The single optional "Upgrade Pick" slot (BR-05) |
| Undo window | The 3-second period after a suggested add during which SF-04 is available |
| Compensable operation | A multi-step operation where every mutating step declares a rollback, per MedusaJS workflow semantics — named steps are `SPEC.md` territory |

---

*Solution Flow v0.2 (Draft) — Suggestive Selling — RallyGear / MedusaJS v2.*
*Requires manual review (Section 0.4) and closure of OI-01…OI-07 before `SPEC.md` generation.*