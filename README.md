# Attendra

**The AI front desk for every business.**

Attendra is a multi-tenant SaaS platform that gives any appointment-, reservation- or
order-based business an AI agent that answers phone calls, website and in-app
conversations (and later WhatsApp), books appointments, takes reservations and food
orders, and hands off to a human when it should. Businesses manage everything —
locations, services, staff, menus, hours, agent behaviour — from a dashboard. Customers
get one global account to see and manage everything they have booked or ordered across
every business on the platform.

> Status: **design phase.** This repository currently holds the product and technical
> documentation. Code is built phase by phase, following [the roadmap](docs/product/roadmap.md).

---

## Documentation map

Start here, in this order:

| # | Document | What it answers |
|---|---|---|
| 1 | [docs/product/prd.md](docs/product/prd.md) | What we are building, for whom, and why |
| 2 | [docs/product/requirements.md](docs/product/requirements.md) | Numbered functional and non-functional requirements |
| 3 | [docs/product/roadmap.md](docs/product/roadmap.md) | Build phases and what ships in each |
| 4 | [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture: components, runtime processes, data flow |
| 5 | [BACKEND.md](BACKEND.md) | Backend structure, API conventions, auth, logging, caching, jobs |
| 6 | [FRONTEND.md](FRONTEND.md) | Frontend apps, feature-based architecture, state management |
| 7 | [docs/data-model/README.md](docs/data-model/README.md) | Data model conventions and the full table catalogue |
| 8 | [docs/features/](docs/features/README.md) | One document per feature: rules, flows, endpoints, events |
| 9 | [docs/adr/](docs/adr/README.md) | Architecture decision records: why each major choice was made |
| — | [docs/product/glossary.md](docs/product/glossary.md) | Shared vocabulary used across all documents |

Documentation rules (so the docs never contradict each other) are in
[docs/README.md](docs/README.md).

---

## Repository layout (target)

The monorepo is created in Phase 0. Target layout:

```
attendra/
├── apps/
│   ├── api/          NestJS — HTTP API, webhooks, WebSocket gateway      (BACKEND.md)
│   ├── worker/       NestJS — BullMQ consumers, schedulers, outbox relay  (BACKEND.md)
│   ├── media/        Node — real-time voice media gateway                (ARCHITECTURE.md §6)
│   ├── dashboard/    Vite + React — business dashboard                   (FRONTEND.md)
│   ├── admin/        Vite + React — platform super-admin console          (FRONTEND.md)
│   ├── customer/     Next.js — customer app + public business pages       (FRONTEND.md)
│   └── widget/       Preact — embeddable voice/chat widget                (FRONTEND.md)
├── packages/
│   ├── contracts/    Zod schemas + API route registry (single source of truth)
│   ├── api-client/   Typed client built from contracts (web + future mobile)
│   ├── ui/           Design system (Radix + Tailwind) for web apps
│   ├── i18n/         Locale utilities and UI translation catalogues
│   ├── utils/        Pure shared helpers (time, money, ids)
│   └── config/       Shared tsconfig, lint and format configs
├── docs/             Product, data model, features, ADRs
├── docker-compose.yml
├── .env.example
├── ARCHITECTURE.md
├── BACKEND.md
└── FRONTEND.md
```

---

## Local development

### Requirements

- Node.js 22 LTS (`.nvmrc`), pnpm 10 (`corepack enable` picks the pinned version)
- PostgreSQL 17 with the `pgvector`, `btree_gist` and `citext` extensions
- Redis 7

### Option A — Docker (recommended)

```bash
cp .env.example .env
docker compose up -d          # postgres (with pgvector), redis, mailpit
```

| Service | Address | Credentials |
|---|---|---|
| PostgreSQL | `localhost:5432` | db `attendra`, user `attendra`, password `attendra` |
| Redis | `localhost:6379` | no password (local only) |
| Mailpit (dev email inbox) | SMTP `localhost:1025`, UI http://localhost:8025 | — |

### Option B — Native installs

Create the same database and user so `.env.example` works unchanged:

```sql
CREATE USER attendra WITH PASSWORD 'attendra' CREATEDB;
CREATE DATABASE attendra OWNER attendra;
\c attendra
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
-- Runtime role: row-level security applies to it (BACKEND.md §7).
CREATE ROLE attendra_app LOGIN PASSWORD 'attendra_app' NOBYPASSRLS;
GRANT CONNECT ON DATABASE attendra TO attendra_app;
```

Run Redis on the default port with `maxmemory-policy noeviction` (required by BullMQ).

> These credentials are for local development only. Real environments read secrets
> from the environment, never from committed files — see [BACKEND.md §12](BACKEND.md#12-configuration-and-secrets).

### First run

```bash
pnpm install
pnpm db:migrate          # applies migrations as the owner role
pnpm db:seed             # idempotent seeds
pnpm dev                 # api on :4000 + worker, rebuilding on change
```

### Everyday commands

| Command | What it does |
|---|---|
| `pnpm lint` / `pnpm lint:fix` | ESLint (type-aware + architectural boundaries) |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm test` | unit → integration → e2e (`test:unit`, `test:int`, `test:e2e`); integration and e2e need the services above |
| `pnpm build` | builds all packages and apps (Turborepo, cached) |
| `pnpm db:generate` | generates a migration from Drizzle schema changes (review the SQL) |
| `pnpm db:reset` | drops and re-migrates the **local** database (refuses elsewhere) |
| `pnpm api:client` | regenerates `packages/api-client` (OpenAPI from the route registry → typed client); CI fails if stale |
| `pnpm api:scenarios` | runs API scenarios against a running API → `reports/api-scenarios/<timestamp>.md` |

Manual requests: `apps/api/http/*.http` (VS Code REST Client / JetBrains HTTP Client).
