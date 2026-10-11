# ADR-0010 · Vite SPAs for dashboard and admin, Next.js for the customer app, Preact widget

**Status:** Accepted · 2026-10-11

## Context

Four very different frontends: an authenticated operational dashboard, a separate
super-admin console, customer-facing public pages and app (opened from SMS links, should
be fast and indexable), and a widget embedded on third-party sites.

## Decision

- **Dashboard and admin:** Vite + React SPA, TanStack Router + Query, Zustand,
  feature-based architecture ([FRONTEND.md](../../FRONTEND.md)). Separate apps and
  origins for isolation.
- **Customer app + public location pages:** Next.js App Router for SSR/streaming and SEO;
  it only renders and calls the REST API (no server-side business logic, no DB access),
  so the backend stays the single API for future mobile apps.
- **Widget:** Preact, Shadow DOM, small bundle, lazy loaded.

## Alternatives considered

- **Next.js for everything.** Unneeded SSR complexity for authenticated dashboards; tempting
  to put logic in route handlers and bypass the API.
- **One SPA for dashboard and admin with role switches.** Larger blast radius for admin
  features; separate deployment is safer.
- **React for the widget.** Bundle size too large for third-party embedding.

## Consequences

- Shared packages (`contracts`, `api-client`, `ui`, `i18n`, `utils`) keep the apps
  consistent without duplication.
- Customer mobile (Expo) can reuse everything except web UI components.
