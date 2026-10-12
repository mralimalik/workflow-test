# ADR-0002 · Modular monolith on NestJS, three process types

**Status:** Accepted · 2026-10-11 · Framework version superseded by [ADR-0013](0013-nestjs-12-built-in-first.md) (NestJS 12)

## Context

Many bounded contexts (bookings, ordering, conversations, billing…), a small team, and a
need for strict boundaries so the codebase stays maintainable as capabilities and
channels are added. Workloads differ: request/response API, background jobs, and
long-lived real-time audio sockets.

## Decision

- One backend codebase (`packages/server`) organized as **modules with enforced
  boundaries** ([BACKEND.md §3](../../BACKEND.md#3-module-architecture)).
- Built on **NestJS 11 with the Express adapter** (so it remains a PERN stack): DI,
  modules, guards, pipes and interceptors give the structure we would otherwise
  hand-build on Express.
- Composed into **three process types**: `api`, `worker`, `media`, each scaled
  independently.

## Alternatives considered

- **Plain Express with our own structure.** Fully viable; rejected only because we would
  re-implement DI, module lifecycles, guards and testing utilities that Nest provides,
  and conventions are harder to enforce across contributors.
- **Fastify.** Faster raw throughput; ecosystem compatibility (Express middleware,
  Socket.IO, provider SDK examples) favoured Express. Nest can switch adapters later.
- **Microservices from day one.** Operational overhead and distributed transactions
  without the scale to justify them.

## Consequences

- Module boundaries are lint-enforced; cross-module communication via public services and
  events keeps future extraction into services possible.
- The `media` process uses Nest only for DI/config of shared modules; the hot audio path
  is plain `ws` for latency.
