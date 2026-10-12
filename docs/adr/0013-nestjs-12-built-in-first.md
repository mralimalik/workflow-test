# ADR-0013 · NestJS 12, built-in features first

**Status:** Accepted · 2026-10-12 · Supersedes the version in [ADR-0002](0002-modular-monolith-nestjs.md)
(the modular monolith and three process types stand)

## Context

ADR-0002 chose NestJS 11. NestJS 12.0.0 shipped on 2026-08-27 and 12.1.x is now npm
`latest`; 11 is tagged `legacy` (patches only). Every Nest package we plan to use has a
12-compatible release: `@nestjs/config`, `throttler`, `bullmq`, `terminus`, `websockets`,
`schedule`, plus `nestjs-pino`. NestJS 12 adds what we would otherwise take from
third-party packages:

- **Standard Schema validation:** a `schema` option on `@Body` / `@Query` / `@Param` and
  the built-in `StandardSchemaValidationPipe`. The handler receives the parsed (coerced,
  defaulted) output. Zod 4 implements Standard Schema.
- **Response serialization by schema:** `StandardSchemaSerializerInterceptor` with
  `@SerializeOptions({ schema })`.
- An `errorCode` option on HTTP exceptions.
- Request draining on shutdown in the Express adapter.
- Opt-in route-conflict diagnostics (`routeConflictPolicy`).

Nest 12 packages are ESM-only. CommonJS code can load them through Node's `require(esm)`
(Node ≥ 22.12).

## Decision

- **NestJS 12** (Express adapter) for `api`, `worker` and `media`.
- **Built-in first:** use a feature from Node, NestJS or an official `@nestjs/*` package when
  it covers the need, and add a third-party package only when none does. This applies to:
  - **validation:** Nest's Standard Schema pipe instead of `nestjs-zod` or class-validator;
  - **config:** `@nestjs/config` with a Zod schema;
  - **request context:** Node's `AsyncLocalStorage`;
  - **health checks:** `@nestjs/terminus`;
  - **rate limiting:** `@nestjs/throttler`;
  - **queues:** `@nestjs/bullmq`.

  Third-party packages remain where Nest has no equivalent: pino logging (redaction,
  performance) per [BACKEND.md §8](../../BACKEND.md#8-logging-and-observability), Drizzle,
  OpenTelemetry, Argon2, and OpenAPI 3.1 generation ([ADR-0014](0014-zod-contracts-openapi.md)).
- The backend stays **CommonJS**. tsconfig `module: node20` gives TypeScript's model of
  `require(esm)`. Moving the backend to ESM is a separate, optional decision.
- **Node 22 LTS**, minimum 22.18 (required by tsdown; zod-openapi needs 22.14).

## Alternatives considered

- **Stay on NestJS 11.** It is in maintenance, so we would face a major upgrade during
  Phase 1 and give up the native schema validation that replaces a third-party package.
- **Move the backend to ESM now.** It brings `.js` import extensions, decorator-metadata
  ordering pitfalls with circular imports, and an OpenTelemetry loader hook, with no
  functional gain today.
- **Node 24.** Supported by the stack, but Node 22 is the more widely deployed LTS and
  meets every requirement.

## Consequences

- No `nestjs-zod`, class-validator or class-transformer. Request schemas come straight from
  `packages/contracts`.
- Lifecycle hooks run by module hierarchy level (a Nest 12 change); tests cover startup and
  shutdown order where it matters.
- Terminus 12 removed `HealthIndicator` / `HealthCheckError`; health checks use
  `HealthIndicatorService`.
