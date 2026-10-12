# ADR-0003 · Drizzle ORM with reviewed SQL migrations

**Status:** Accepted · 2026-10-11

## Context

We need typed models declared in code (the role Mongoose models play in MERN), but also
full access to Postgres features: exclusion constraints, RLS, partitioning, `tstzrange`,
pgvector, `SET LOCAL` inside transactions, and precise control of generated SQL.

## Decision

Use **Drizzle ORM**: table definitions in TypeScript per module
(`infrastructure/*.schema.ts`), inferred row types, SQL-like query builder, and
**drizzle-kit**-generated SQL migrations that are reviewed and extended by hand where
Drizzle cannot express a feature.

## Alternatives considered

- **Prisma.** Excellent DX, but its own schema language, a query engine layer, limited
  support for exclusion constraints/RLS/range types, and less control over transactions
  with session settings.
- **TypeORM / MikroORM.** Heavier entity-manager patterns; decorators on classes mix
  persistence into domain objects.
- **Kysely / raw SQL only.** Very good typing, but no schema-as-code for migrations.

## Consequences

- Models are TypeScript, close to SQL, with no runtime engine.
- Some constraints live in migration SQL; each is documented in the data-model page so
  the schema is understandable from the docs.
