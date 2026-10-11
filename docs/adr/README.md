# Architecture decision records

Each ADR records one significant decision: context, decision, alternatives, consequences.
ADRs are immutable once accepted; a change of mind is a new ADR that supersedes the old.

| # | Decision | Status |
|---|---|---|
| [0001](0001-postgresql.md) | PostgreSQL as the system of record (not MongoDB) | Accepted |
| [0002](0002-modular-monolith-nestjs.md) | Modular monolith on NestJS (Express adapter), three process types | Accepted |
| [0003](0003-drizzle-orm.md) | Drizzle ORM with reviewed SQL migrations | Accepted |
| [0004](0004-shared-schema-rls-tenancy.md) | Shared-schema multi-tenancy with row-level security | Accepted |
| [0005](0005-session-auth-with-token-refresh.md) | Own auth: server-side sessions for web, short JWT + rotating refresh for mobile | Accepted |
| [0006](0006-rest-ts-rest-contracts.md) | REST with shared Zod/ts-rest contracts; OpenAPI generated | Accepted |
| [0007](0007-provider-abstraction.md) | Provider abstraction with admin-assigned model profiles | Accepted |
| [0008](0008-redis-and-bullmq.md) | Redis for cache/sessions/rate limits, BullMQ for jobs, separate instances in production | Accepted |
| [0009](0009-stripe-billing-and-connect.md) | Stripe Billing for subscriptions, Stripe Connect for customer payments | Accepted |
| [0010](0010-frontend-apps.md) | Vite SPAs for dashboard/admin, Next.js for customer app, Preact widget | Accepted |
| [0011](0011-unified-booking-model.md) | One booking model with allocations and exclusion constraints for all time-based capabilities | Accepted |
| [0012](0012-monorepo.md) | pnpm + Turborepo monorepo | Accepted |

Template: **Context** → **Decision** → **Alternatives considered** → **Consequences**.
