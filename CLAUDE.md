# hf-medusa-store

Headless e-commerce platform on **Medusa 2.16**. pnpm + Turborepo monorepo.

## ⚠️ Repository layout — two nested folders

```
hf-medusa-store/            <- git root (docker-compose.yml here)
└── hf-medusa-store/        <- pnpm workspace root — RUN ALL pnpm/turbo COMMANDS HERE
    └── apps/
        ├── backend/        <- @dtc/backend    (Medusa 2.16)
        └── storefront/     <- @dtc/storefront (Next.js 15, port 8008)
```

**Always `cd hf-medusa-store` (the inner folder) before any pnpm/turbo command.**

## Recommended tooling

Install the official Medusa Claude Code plugin for framework guidance:
`/plugin marketplace add medusajs/medusa-agent-skills` then `/plugin install medusa-dev@medusa`.
Project-specific conventions live in `.claude/rules/project-conventions.md`.

## Tech stack

- Package manager: **pnpm 11.8.0** (Node >= 20) — never use npm or yarn
- Monorepo: **Turborepo**
- Backend: **Medusa 2.16.0** (Postgres + Redis), TypeScript
- Storefront: **Next.js 15**, React 19, Tailwind, Stripe

## Common commands (run from the inner `hf-medusa-store/`)

| Task | Command |
|------|---------|
| Backend dev server | `pnpm backend:dev` |
| Storefront dev server (port 8008) | `pnpm storefront:dev` |
| Seed backend data | `pnpm backend:seed` |
| Build all | `pnpm build` |
| Lint all | `pnpm lint` |
| Test all | `pnpm test` |

Backend tests (from `apps/backend/`):
- `pnpm test:unit`
- `pnpm test:integration:http`
- `pnpm test:integration:modules`

## Backend structure (`apps/backend/src/`)

- `api/admin`, `api/store` — REST endpoints
- `modules/` — custom modules (e.g. `suggestive-selling`)
- `workflows/`, `subscribers/`, `jobs/`, `links/` — Medusa building blocks
- `scripts/`, `migration-scripts/` — seeds & data migration
- `admin/` — admin dashboard customizations (i18n)

## Storefront structure (`apps/storefront/src/`)

- `app/[countryCode]/` — Next.js App Router, multi-region
- `modules/` — UI grouped by domain (cart, checkout, products, …)
- `lib/` — shared context, data fetching, hooks, utils

## Conventions

- **Commits:** Conventional Commits with scope — `feat(backend): …`, `fix(storefront): …`, `fix(admin): …`, `chore: …`
- **Branches:** `<type>/<kebab-description>` — e.g. `feat/suggestive-selling-foundation`
- Secrets live in `.env` (gitignored); commit only `.env.template`
- TypeScript throughout; respect existing ESLint/Prettier config

## Current work

- `suggestive-selling` module (cross-sell / complementary products) — under active development
