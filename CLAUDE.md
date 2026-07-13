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


# Local Repository Rules

## Repository inspection

* Prefer the built-in `Read`, `Grep`, and `Glob` tools for inspecting repository files, `node_modules`, and installed package source.
* Do not use Bash commands such as `grep`, `sed`, `awk`, `find`, `head`, `tail`, or `cat` merely to read or search source files.
* Do not use shell variables, pipes, redirects, command chains, or compound Bash commands for repository inspection.
* Do not delegate source inspection to subagents that rely on Bash commands.
* If a source file cannot be inspected with `Read`, `Grep`, or `Glob`, mark the related item as `[NEEDS_VERIFICATION]` instead of requesting Bash permission.

## Bash usage

* Use Bash only for tasks that cannot reasonably be completed with the built-in inspection tools.
* When Bash is required, use one simple, single-purpose command.
* Do not run migrations, database mutation commands, destructive Git commands, Docker cleanup commands, dependency installation, deployment commands, or other destructive operations without explicit user approval.

## Current VoucherEngine task

* Only modify:

  `.claude/specs/voucher-engine/SPEC.md`

* Do not create or modify source code, migrations, tests, routes, workflows, modules, configuration files, or seed files.

* After revising the SPEC, stop and wait for manual review and approval.
