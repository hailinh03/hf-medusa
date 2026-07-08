---
description: Project-specific conventions for hf-medusa-store the official Medusa plugin can't infer
---

# Project-specific conventions

Generic Medusa/Next.js patterns come from the official **medusa-dev** plugin. This file only
captures decisions unique to THIS repository.

## Repo layout & tooling
- Two nested `hf-medusa-store/` folders; the pnpm workspace root is the INNER one — run every pnpm/turbo command there.
- Packages are scoped `@dtc/*` (not `@medusajs`). Root shortcuts use Turbo filters: `pnpm backend:dev`, `pnpm storefront:dev`, `pnpm backend:seed`.
- Storefront dev server runs on port **8008**.
- Redis is OPTIONAL — infra modules load only when `REDIS_URL` is set (in-memory fallback). Never assume Redis is present.
- `react-router` / `react-router-dom` are pinned to **6.30.4** via pnpm overrides (single copy for the admin dashboard). Do not bump independently.

## Backend
- **`src/modules/suggestive-selling/` is the canonical template** for new modules — copy its shape:
  - `index.ts` exports a `<THING>_MODULE` constant + default `Module(...)`.
  - `service.ts` default-exports a class extending `MedusaService({ ...models })`.
  - Models: `model.define('snake_case', …)`, one per file; store cross-module references as plain `model.text()` id fields wired via the **Link Module** (`defineLink(… readOnly: true)`), NOT DB foreign keys.
  - Register the module in `apps/backend/medusa-config.ts` (`{ resolve: './src/modules/<name>' }`).
- Seed/exec scripts live in `src/scripts/`, default-export `async ({ container }: ExecArgs)`, must be idempotent, run via `npx medusa exec ./src/scripts/<file>.ts`.
- Code comments cite the SRS spec section they implement (e.g. `SUGG-001`, "SRS §5.1").
- Most of `api/`, `workflows/`, `subscribers/`, `jobs/` are still starter stubs — when adding real code, follow the medusa-dev plugin's guidance.

## Storefront (`apps/storefront/src/`)
- Use path aliases `@lib/*`, `@modules/*`, `@pages/*` (baseUrl `./src`).
- Call the Medusa SDK ONLY from `src/lib/data/*` (`"use server"`); use the single shared `sdk` instance in `src/lib/config.ts` — never create a second client.
- Routes live under `src/app/[countryCode]/`; page `params` are typed as Promises; use `generateStaticParams` over region country codes.
- Organize features as `src/modules/<feature>/` split into `components/` (leaf UI) and `templates/` (page composition).
- Styling: Tailwind with `@medusajs/ui-preset`; use `clsx` for class merging.

## Testing (backend only)
- Set `TEST_TYPE` (use scripts `pnpm test:unit` / `test:integration:modules` / `test:integration:http`).
- Naming: unit `*.unit.spec.ts` inside `__tests__/`; module integration in `src/modules/<name>/__tests__/`; HTTP in `integration-tests/http/*.spec.ts`.
