# ADR-0001 · PostgreSQL as the system of record

**Status:** Accepted · 2026-10-11

## Context

The product's core promise is correct bookings and orders across many channels writing
concurrently, with strict tenant isolation, deeply relational data (organizations →
locations → staff → services → bookings → payments), cross-location reporting and
semantic search for the knowledge base. A MERN stack (MongoDB) was the initial
suggestion.

## Decision

Use **PostgreSQL 17** as the single system of record ("PERN"), with extensions
`btree_gist` (exclusion constraints), `citext` and `pgvector`. PostGIS is deferred.

## Alternatives considered

- **MongoDB.** Familiar document model and flexible schema, and multi-document
  transactions exist. Rejected because it has no equivalent of exclusion constraints
  (overlap prevention would rely on application locking), no row-level security, weaker
  relational integrity and joins, and reporting across related entities is harder.
- **MySQL.** No exclusion constraints, no RLS, weaker JSON and no native vector support.
- **Separate vector DB** for knowledge. Unnecessary at our scale; pgvector keeps tenant
  isolation and transactions in one place.

## Consequences

- Double-booking prevention and tenant isolation are enforced by the database itself.
- JSONB still gives document-style flexibility where it is appropriate (settings,
  snapshots, provider config) — validated by Zod.
- The team writes SQL-aware code (indexes, query plans); migrations are reviewed SQL.
- Delivery polygons are checked in the app until PostGIS is added (no schema break: zones
  store GeoJSON + coordinates).
