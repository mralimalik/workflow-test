# ADR-0012 · pnpm + Turborepo monorepo

**Status:** Accepted · 2026-10-11

## Context

Backend and frontend are deployed separately but share contracts, utilities and types;
there are seven apps and several shared packages.

## Decision

A single repository managed with **pnpm workspaces** and **Turborepo** (task graph,
caching): `apps/*` for deployables, `packages/*` for shared code
([README](../../README.md#repository-layout-target)). Backend and frontend stay separate
apps; only `contracts`, `api-client`, `utils`, `i18n` and `config` are shared across them.

## Alternatives considered

- **Separate repositories.** Contract changes would need coordinated releases and
  published packages; slower and error-prone for a small team.
- **Nx.** More powerful generators and boundaries, more configuration; Turborepo +
  ESLint boundaries is sufficient.

## Consequences

- One PR can change a contract, the backend and the clients together, type-checked.
- CI runs only affected tasks via Turborepo's graph.
