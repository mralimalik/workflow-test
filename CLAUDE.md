# CLAUDE.md — Attendra

Instructions for Claude (and any contributor) working in this repository. Read this first,
every session.

## What this project is

**Attendra** — a multi-tenant SaaS "AI front desk" for any appointment-, reservation- or
order-based business. Organizations have many locations; an AI agent answers phone calls,
a website widget and an in-app chat, books appointments, takes reservations and food
orders, and hands off to humans. Customers have one global account across all businesses.
Full intent: [docs/product/prd.md](docs/product/prd.md).

**Current state:** design complete; implementation is starting with **Phase 0 —
Foundation**. Follow [docs/plans/phase-0-foundation.md](docs/plans/phase-0-foundation.md)
milestone by milestone and keep its tracker and checklists up to date.

## Read before working

| Need | Read |
|---|---|
| Doc map and "one fact, one place" rules | [docs/README.md](docs/README.md) |
| Vocabulary | [docs/product/glossary.md](docs/product/glossary.md) |
| Requirement IDs | [docs/product/requirements.md](docs/product/requirements.md) |
| Phase scope | [docs/product/roadmap.md](docs/product/roadmap.md) |
| System architecture | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Backend structure and API conventions | [BACKEND.md](BACKEND.md) |
| Frontend architecture | [FRONTEND.md](FRONTEND.md) |
| Tables and columns | [docs/data-model/](docs/data-model/README.md) |
| Feature behaviour, endpoints, events | [docs/features/](docs/features/README.md) |
| Why decisions were made | [docs/adr/](docs/adr/README.md) |

Read the docs relevant to the task **before** writing code. If something isn't specified,
ask, or propose a doc change — don't invent behaviour silently.

## Working agreement

1. **Build in order.** Finish and verify one milestone before starting the next. The
   order is **backend first** (Part A), then **UI** (Part B).
2. **No UI work until the user has shared design references and approved the design
   system** (plan milestone B0). Never invent a visual style for real screens before that.
3. **Docs are the source of truth.** When implementation refines a decision, update the
   owning doc in the same change (see ownership table in docs/README.md). Never duplicate
   a fact across docs — link to its owner.
4. **No hardcoded business logic.** Nothing industry- or customer-specific in code;
   everything business-specific is tenant data configured through the dashboard.
5. **Ask before** changing a decision recorded in an ADR, adding a major dependency, or
   changing scope/phase. Record accepted changes as a new ADR.
6. **Quality bar:** production-grade, industry-standard code — not prototype or tutorial
   code. The UI target is a premium, data-dense, fintech-grade product, not plain forms.
7. **Use current official docs, not memory.** Before using a library API, check its latest
   docs/changelog for the installed version (methods, deprecations, new features worth
   using). Doc websites are often blocked in the cloud sandbox; read the docs source from
   GitHub (`raw.githubusercontent.com/<org>/<repo>/<branch>/…`), `npm view`, or the docs and
   `.d.ts` files shipped in `node_modules`.
8. **Built-in first** ([ADR-0013](docs/adr/0013-nestjs-12-built-in-first.md)): use what Node,
   NestJS or official `@nestjs/*` packages provide before adding a third-party package;
   when one is needed, choose a widely used, maintained one over custom code. Prefer
   mainstream stable versions (e.g. Node LTS) over the newest release.
9. **Report honestly:** say what was tested and how; if something is skipped or failing,
   say so with the output.

## Stack (fixed by ADRs)

pnpm + Turborepo monorepo · Node 22 · TypeScript strict · **NestJS 12 (Express adapter)** ·
**PostgreSQL 17** (`btree_gist`, `citext`, `pgvector`) · **Drizzle ORM** · **Zod 4** contracts (Nest-native
validation, OpenAPI 3.1 via zod-openapi, openapi-fetch client — [ADR-0014](docs/adr/0014-zod-contracts-openapi.md)) · Redis + **BullMQ** · Socket.IO · pino ·
OpenTelemetry · Vitest + Supertest + Playwright · Stripe (Billing + Connect) ·
OpenAI / Azure OpenAI Realtime · Twilio · Vite + React 19 + TanStack Router/Query +
Zustand + Tailwind + Radix (dashboard, admin) · Next.js (customer app) · Preact (widget).

## Non-negotiable engineering rules

### Backend
- **Module boundaries** ([BACKEND.md §3](BACKEND.md#3-module-architecture)): controllers →
  application services → domain (pure) → infrastructure. A module reads/writes only its
  own tables; other modules use its `*.public.ts` exports or its events.
- **Tenancy** ([BACKEND.md §7](BACKEND.md#7-multi-tenancy-and-data-access)): every tenant
  table has `organization_id`, RLS enabled + forced, indexes leading with
  `organization_id`. Tenant data is accessed only via `db.tenantTx()`. Runtime DB role
  never bypasses RLS. Out-of-tenant or out-of-scope resources return `404`.
- **IDs:** UUIDv7 generated in the app; never serial/auto-increment. Human-facing
  references use reference codes (`BK-XXXXXX`).
- **Data conventions** ([data model README §1](docs/data-model/README.md#1-conventions)):
  UTC `timestamptz`, IANA timezones per location, money as integer minor units +
  currency, enums as text + CHECK with values from `packages/contracts`, JSONB always
  Zod-validated, soft delete only for configuration, snapshots on transactional records.
- **Correctness in the database:** double-booking prevented by exclusion constraints;
  uniqueness, FKs and checks enforced in SQL, not only in code.
- **API** ([BACKEND.md §5](BACKEND.md#5-api-conventions)): contracts first in
  `packages/contracts`; camelCase JSON; RFC 9457 problem+json errors with stable `code`;
  cursor pagination; `Idempotency-Key` on creating POSTs; `If-Match`/`ETag` on versioned
  config; state transitions are action endpoints (`POST …/cancel`), never `PATCH status`.
- **Side effects** go through the transactional outbox → BullMQ; consumers are idempotent.
- **Auth:** cookie sessions + CSRF for web; Argon2id; OTPs/tokens stored hashed; realms
  (`user`, `customer`, `platform_admin`) never interchangeable.
- **Secrets:** provider credentials envelope-encrypted; never logged, cached in Redis, or
  returned by the API.
- **Logging:** structured pino with request context; no bodies, transcripts, secrets or
  raw PII in logs. Business history goes to `audit_logs` / `*_events`.
- **Caching:** only per the cache catalogue ([BACKEND.md §9.2](BACKEND.md#92-cache-catalogue));
  never on write paths; event-driven invalidation.
- **Migrations:** forward-only, reviewed SQL, expand → migrate → contract.

### Frontend
- Feature-based structure; features import each other only via `index.ts`
  ([FRONTEND.md §3](FRONTEND.md#3-feature-based-architecture)).
- **State homes:** server state → TanStack Query; URL state → router search params;
  UI-only state → Zustand (never copies of server data); forms → react-hook-form with
  contract Zod schemas.
- API access only through `packages/api-client`; no hand-written request types.
- Accessibility (WCAG 2.2 AA), light/dark themes, location-timezone-aware dates.
- For UI work use the project skills: **`ui-ux-pro-max`** (dashboard/product UI, design
  system) and **`design-taste-frontend`** (marketing/landing and customer-facing pages).

## Testing requirements

Defined in [plan §1](docs/plans/phase-0-foundation.md#1-how-we-test-applies-to-every-milestone).
In short: unit tests for domain logic; integration tests against real Postgres/Redis
(including **RLS fails closed**); API e2e for every endpoint; the **tenant isolation
suite** must cover every business route; scenario reports via `pnpm api:scenarios`;
Playwright for UI flows. Name tests with requirement IDs where applicable. A milestone is
done only when its checklist is fully ticked and CI is green.

## Local environment

```bash
cp .env.example .env
docker compose up -d        # Postgres (pgvector) :5432, Redis :6379, Mailpit :1025/:8025
```
Credentials (local only): db/user/password `attendra`; runtime role `attendra_app`.
Native-install alternative in [README.md](README.md#local-development).

## Git

- Conventional Commits (`feat(auth): …`, `fix(bookings): …`, `docs: …`); reference
  requirement IDs in PR descriptions.
- One milestone (or a coherent part of one) per PR; keep the plan tracker updated.
- Never commit secrets or `.env`; only `.env.example`.
