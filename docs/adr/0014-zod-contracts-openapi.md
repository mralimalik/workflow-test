# ADR-0014 · Zod contracts with Nest-native validation, zod-openapi and a generated client

**Status:** Accepted · 2026-10-12 · Supersedes the implementation in
[ADR-0006](0006-rest-ts-rest-contracts.md); REST, `/v1` versioning and "one definition
per endpoint" stand.

## Context

ADR-0006 chose ts-rest to share contracts between the backend and clients. Its last
stable release was 3.52.1 (2025-03-04), and the last release candidate came out in
2025-06. It requires Zod 3 and NestJS ≤ 11, and its OpenAPI generator targets OpenAPI 3.0
via a Zod 3 converter. That rules it out for Zod 4 + NestJS 12 ([ADR-0013](0013-nestjs-12-built-in-first.md))
+ OpenAPI 3.1. `nestjs-zod` also requires NestJS ≤ 11, and `@nestjs/swagger` 12 emits OpenAPI 3.0.

## Decision

1. **`packages/contracts`** is still the single source of truth:
   - Zod 4 schemas; reusable ones are named with `.meta({ id })`.
   - A small typed **route registry**. Each route lists its method, path, params, query,
     headers, body, responses per status, error codes, and whether it takes an
     idempotency key or If-Match.
2. **Server:** a `@ContractRoute(route)` decorator composes Nest's route decorators. Request
   validation uses the route's schemas through Nest's `StandardSchemaValidationPipe`, and
   responses are serialized through the route's response schema. A conformance test fails
   if a mounted route is missing from the registry, or a registered route is not mounted.
3. **OpenAPI 3.1** is generated from the registry with **zod-openapi** (`createDocument`)
   and published per audience ([BACKEND.md §5.10](../../BACKEND.md#510-contracts-and-openapi)).
   Swagger UI or Scalar is used only to view it.
4. **Clients:** **openapi-typescript** generates path types from the spec into
   `packages/api-client`, and the client is built on **openapi-fetch**. Forms import the
   same Zod schemas from `packages/contracts`. CI regenerates the types and fails on drift.

## Alternatives considered

- **oRPC** (`@orpc/nest`, OpenAPI 3.1, a typed client without codegen). Capable, but its
  error envelope differs from our RFC 9457 problem+json, it is ESM-only with its own
  request/response model inside Nest, and a 2.0 major is in beta.
- **`@nestjs/swagger` with Standard Schema.** It is official, but it emits OpenAPI 3.0;
  getting 3.1 needs a custom converter and a version override.
- **Keep ts-rest.** It would lock us to Zod 3 and NestJS 11 on an inactive library.

## Consequences

- We own a small amount of glue code: the route registry, `@ContractRoute` and the
  conformance test. In return, problem+json, ETag/If-Match, Idempotency-Key and CSRF use
  plain Nest primitives.
- The client is generated, so an API change shows up as a type error in every app on the
  next build.
