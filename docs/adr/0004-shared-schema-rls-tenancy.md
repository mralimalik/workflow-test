# ADR-0004 · Shared-schema multi-tenancy with row-level security

**Status:** Accepted · 2026-10-11

## Context

Thousands of organizations of very different sizes, each with locations. Data must never
leak across tenants, while customers have a global identity that legitimately spans
organizations.

## Decision

- One database, one schema; every tenant-owned row has `organization_id`.
- Isolation in two layers: tenant-scoped repositories in the application, and Postgres
  **RLS** policies driven by `SET LOCAL app.organization_id` in every transaction; the
  runtime role cannot bypass RLS ([BACKEND.md §7](../../BACKEND.md#7-multi-tenancy-and-data-access)).
- A separate customer policy (`app.customer_id`) gives customers read access to their own
  rows across organizations.

## Alternatives considered

- **Schema per tenant.** Strong isolation but migrations × N, connection/catalog bloat at
  thousands of tenants, and cross-tenant customer views become hard.
- **Database per tenant.** Highest isolation and cost; reserved as an option for very
  large enterprise tenants later (the `organization_id` boundary makes extraction
  possible).
- **Application-only filtering.** One missed `WHERE` leaks data; rejected.

## Consequences

- Indexes lead with `organization_id`; composite FKs prevent cross-tenant references.
- Every tenant table migration must include RLS (CI check).
- Platform-scope jobs need explicit, audited policies.
