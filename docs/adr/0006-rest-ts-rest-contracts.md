# ADR-0006 · REST with shared Zod / ts-rest contracts

**Status:** Accepted · 2026-10-11

## Context

Several clients (dashboard, admin, customer web, widget, future mobile, third-party
integrators) consume the API. We want one definition of every request/response shape, no
duplicated types between backend and frontend, and a standard REST API that external
developers and webhooks can use.

## Decision

- **REST** over HTTPS, JSON, URL-versioned (`/v1`), conventions in
  [BACKEND.md §5](../../BACKEND.md#5-api-conventions).
- Every endpoint is defined once in `packages/contracts` as a **ts-rest** route with
  **Zod** schemas. The backend implements contracts (`@ts-rest/nest`); clients use the
  typed ts-rest client in `packages/api-client`; **OpenAPI 3.1** is generated from the
  same contracts for documentation and external SDKs.

## Alternatives considered

- **tRPC.** Great DX but RPC-style, TypeScript-only clients, not suitable as a public API.
- **GraphQL.** Flexible reads, but adds complexity (caching, authorization per field,
  N+1) not needed for our workloads; webhooks/integrations expect REST anyway.
- **OpenAPI-first with codegen.** Viable; writing YAML by hand duplicates what Zod
  already expresses and drifts from validation.

## Consequences

- Changing an API shape is a contract change, visible in review, type-checked in every app.
- Forms in the frontend reuse the same Zod schemas for validation.
