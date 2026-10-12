# Frontend

Architecture and conventions for all client applications. The API they consume is
described in [BACKEND.md §5](BACKEND.md#5-api-conventions); screens per feature are
described in the [feature docs](docs/features/README.md).

Contents:
1. [Apps](#1-apps)
2. [Shared packages](#2-shared-packages)
3. [Feature-based architecture](#3-feature-based-architecture)
4. [State management](#4-state-management)
5. [Data fetching](#5-data-fetching)
6. [Routing, tenancy and permissions](#6-routing-tenancy-and-permissions)
7. [Forms and validation](#7-forms-and-validation)
8. [Real-time](#8-real-time)
9. [Voice and conversation UI](#9-voice-and-conversation-ui)
10. [Internationalization](#10-internationalization)
11. [UI system and accessibility](#11-ui-system-and-accessibility)
12. [Errors, loading and empty states](#12-errors-loading-and-empty-states)
13. [Security](#13-security)
14. [Testing](#14-testing)
15. [Performance](#15-performance)
16. [Mobile readiness](#16-mobile-readiness)
17. [Screen map](#17-screen-map)

---

## 1. Apps

| App | Stack | Why this stack | Users |
|---|---|---|---|
| `apps/dashboard` | Vite, React 19, TanStack Router, TanStack Query, Zustand, Tailwind | Authenticated SPA; no SEO needs; fastest dev loop | Business owners, managers, staff |
| `apps/admin` | Same as dashboard | Same reasons; separate deployment and origin for isolation | Platform admins |
| `apps/customer` | Next.js (App Router), React 19, TanStack Query, Zustand, Tailwind | Public location pages need SSR/SEO and fast first load from SMS links; also hosts the authenticated customer app | Customers |
| `apps/widget` | Preact + Vite library build, Shadow DOM | Must be tiny (< 60 KB gzipped core) and style-isolated on third-party sites | Customers on business websites |

All apps are TypeScript strict and consume the API only through `packages/api-client`.
The Next.js app renders pages and calls the REST API — it contains no business logic and
no direct database access ([ADR-0010](docs/adr/0010-frontend-apps.md)).

## 2. Shared packages

| Package | Contents | Consumers |
|---|---|---|
| `packages/contracts` | Zod schemas, enums, route registry, error codes, event payloads | backend, all apps, future mobile |
| `packages/api-client` | openapi-fetch client per audience (path types generated from the OpenAPI spec), fetch wrapper (credentials, CSRF header, request id, locale), problem+json → typed `ApiError`, query-key factories, generated React Query hooks helpers | all apps, mobile |
| `packages/ui` | Design system: tokens, Radix-based primitives (shadcn-style), composites (DataTable, DateRangePicker, TimeGrid, EmptyState, ConfirmDialog), icons | dashboard, admin, customer |
| `packages/i18n` | i18next setup, locale detection, ICU formatters for dates/money/numbers in a timezone, shared catalogues | all apps |
| `packages/utils` | Pure helpers: time zones, money, phone formatting (libphonenumber-js), ids | all apps, backend |
| `packages/config` | tsconfig bases, ESLint/Prettier configs, Tailwind preset | all |

Rules: packages never import from apps; `ui` has no data fetching; `contracts` has no
runtime dependencies except Zod ([ADR-0014](docs/adr/0014-zod-contracts-openapi.md)).

## 3. Feature-based architecture

### 3.1 Folder structure (dashboard; admin and customer follow the same shape)

```
apps/dashboard/src/
  app/                          composition only
    providers.tsx                 QueryClient, Router, I18n, Theme, Socket, Toaster
    router.tsx                    route tree (TanStack Router, file-based)
    layouts/                      AppShell, AuthLayout, OnboardingLayout
  routes/                       route files: thin — params, loaders (prefetch), page composition
    _auth/login.tsx
    o/$orgSlug/l/$locationId/calendar.tsx
    ...
  features/
    bookings/
      api/                        queries.ts (queryOptions), mutations.ts, keys.ts
      components/                 BookingDrawer, BookingStatusBadge, RescheduleDialog
      hooks/                      useBookingActions, useBookingFilters (URL state)
      stores/                     booking-ui.store.ts (Zustand, UI-only state)
      lib/                        pure helpers (status → color, formatting)
      index.ts                    PUBLIC API of the feature
    calendar/  services/  staff/  schedules/  customers/  conversations/  handoffs/
    agent-settings/  knowledge/  channels/  billing/  team/  locations/  onboarding/
    analytics/  integrations/  orders/  kitchen/  reservations/  floor-plan/  menu/
  entities/                     shared domain UI used by several features (no fetching)
    customer/  location/  staff-member/   (e.g. CustomerAvatar, LocationBadge)
  shared/
    session/                      current user, current org/location, permissions (`useCan`)
    realtime/                     socket client + event → query invalidation map
    lib/                          app-specific helpers
    config/                       env (validated with Zod at startup)
```

### 3.2 Import rules (lint-enforced with `eslint-plugin-boundaries`)

```
routes → features → entities → shared → packages/*
```

1. Features import other features **only through their `index.ts`**; deep imports are
   errors ([NFR-MAINT-003](docs/product/requirements.md#nfr-maint--maintainability)).
2. `entities` and `shared` never import from `features`.
3. Route files compose features; they contain no business logic or data transformation.
4. A component that needs data from two features is composed at the route (or a
   dedicated composite feature), not by one feature reaching into the other.

### 3.3 Component conventions

- Function components, named exports, one component per file, file name = component name
  in kebab-case (`booking-drawer.tsx` exports `BookingDrawer`).
- Presentational components receive data via props; container logic lives in hooks.
- No `useEffect` for data fetching or derived state; use React Query and memoized
  selectors.

## 4. State management

Each kind of state has exactly one home:

| State | Tool | Examples |
|---|---|---|
| **Server state** (anything persisted in the API) | TanStack Query | bookings, services, settings, conversations |
| **URL state** (shareable, survives reload) | TanStack Router search params (Zod-validated) | current org/location, calendar date/view, filters, open drawer id |
| **Client UI state** (cross-component, not shareable) | Zustand | sidebar collapsed, live-call panel, voice session state, draft wizard progress, unsent composer text |
| **Form state** | react-hook-form | create/edit forms |
| **Local component state** | `useState` | hover, toggles |

Zustand conventions:

- One store per concern, inside its feature (`features/x/stores/*.store.ts`); global
  stores only in `shared/`.
- Never copy server data into Zustand. Store ids and UI flags; read entities from the
  query cache.
- Stores are typed, use slices + selectors (`useStore(s => s.field)`), and `persist`
  middleware only for preferences (theme, last location) with a versioned key.
- Actions are named verbs (`openPanel`, `setDraftStep`) and contain no fetching.

## 5. Data fetching

- **Query key factories** per feature in `api/keys.ts`, always starting with the scope:
  `['org', orgId, 'loc', locationId, 'bookings', 'list', filters]`. Invalidation by
  prefix works for whole features or whole locations.
- **`queryOptions()`** objects are exported and reused by components, route loaders
  (prefetch) and SSR (customer app hydration).
- Defaults: `staleTime` 30 s for lists, 5 min for configuration; `gcTime` 10 min;
  `refetchOnWindowFocus` on for operational screens (calendar, kitchen, handoffs).
- **Mutations** invalidate exactly the affected keys; optimistic updates only where
  rollback is trivial (toggles, reordering) — never for bookings, orders or payments,
  which wait for the server's answer.
- Mutations send an `Idempotency-Key` generated when the user initiates the action (kept
  stable across retries of the same submit).
- Configuration edits send `If-Match` with the loaded `version`; a `412` opens a
  "changed by someone else — reload/overwrite?" dialog.
- Infinite lists use cursor pagination (`useInfiniteQuery`) matching the API.
- Errors are typed `ApiError` with `code`; features map codes to messages.

## 6. Routing, tenancy and permissions

- URL is the source of truth for scope:
  `/o/{orgSlug}/l/{locationId}/...` for location screens,
  `/o/{orgSlug}/...` for organization screens, `/o/{orgSlug}/l/all/...` for
  cross-location views. The last used org/location is remembered (Zustand persist) only
  to redirect from `/`.
- Route `beforeLoad` guards: authenticated → member of org → location in scope →
  required permission. Failing a guard renders a proper 403/404 page, not a redirect loop.
- `useCan('bookings.update', { locationId })` hides or disables actions; the API is still
  the authority.
- The org/location switcher changes the URL; React Query caches are keyed by scope, so
  switching never shows another location's data.
- Code-splitting per route; feature bundles load on navigation.

## 7. Forms and validation

- react-hook-form + `zodResolver` with the **same Zod schemas** from `packages/contracts`
  used by the API (single source of truth). UI-only refinements extend the contract
  schema; they never redefine it.
- Server `422` field errors (`errors[].path`) are mapped back onto form fields.
- Complex editors (weekly schedule, modifier groups, service resource rules, agent
  instructions) are dedicated components with their own tests.
- Unsaved-changes guard on navigation for configuration forms.

## 8. Real-time

- `shared/realtime` connects Socket.IO after login; joins org and in-scope location rooms.
- A single **event → query-key map** translates server events into invalidations
  (e.g. `booking.confirmed` → invalidate `['org', o, 'loc', l, 'bookings']` and
  `['org', o, 'loc', l, 'calendar']`). Features register their mappings through their
  public API.
- Live screens (calendar, kitchen queue, handoff queue, live calls) show a connection
  indicator and refetch on reconnect.

## 9. Voice and conversation UI

Used by the dashboard test console, the widget and the customer app's in-app agent:

- A `VoiceSession` controller (framework-agnostic TypeScript in `packages/utils` or a
  small `packages/voice-client`) wraps WebRTC: microphone permission, connect with the
  ephemeral token from the API, mute, end, audio level, connection state.
- UI state (idle → requesting-mic → connecting → live → ended/error) lives in a Zustand
  store; transcript and tool activity stream into the view.
- Always offer a **text fallback** when the microphone is denied or WebRTC fails.
- The widget renders inside Shadow DOM, loads lazily on first click, and exposes a tiny
  JS API (`Attendra.open()`, `Attendra.identify({ email })`).

## 10. Internationalization

- UI strings: i18next with namespaces per feature; ICU message format; locale from user
  preference → browser → organization default.
- Business content (service names, menu items) arrives already localized from the API
  for the requested locale; management screens edit all translations of a field side by
  side.
- Dates and times are always rendered **in the location's timezone** with the zone shown
  when it differs from the viewer's; never in the browser's zone by accident.
  `packages/i18n` exposes `formatInZone`, `formatMoney`, `formatPhone`.
- RTL support via logical CSS properties (Tailwind `ms-*`, `me-*`).

## 11. UI system and accessibility

- Tailwind with a shared preset (design tokens as CSS variables; light/dark themes).
- Radix primitives for accessible dialogs, menus, popovers, tabs, etc.
- WCAG 2.2 AA: keyboard navigation, focus management, visible focus, ARIA labels,
  reduced-motion support, colour contrast checked in CI (axe).
- Each organization's brand colour and logo theme the customer app, public pages and
  widget only — never the dashboard.

## 12. Errors, loading and empty states

- Route-level error boundaries with retry; feature-level boundaries for widgets on a page.
- Skeletons for first load, inline spinners for refetch; never block a whole page for a
  background refetch.
- Every list has a designed empty state with the primary action.
- Toasts for success and recoverable errors; dialogs for destructive confirmations
  (cancel booking, refund).

## 13. Security

- Cookies are `HttpOnly`; no tokens in `localStorage`. CSRF token kept in memory and sent
  as `X-CSRF-Token`.
- No secrets in any frontend bundle; env vars prefixed and validated (`VITE_PUBLIC_*`,
  `NEXT_PUBLIC_*` only for non-secret values).
- Content Security Policy per app; the widget uses no `eval` and documents the CSP
  entries a host site needs.
- User-provided content (FAQs, notes) is rendered as text, never as HTML.

## 14. Testing

| Level | Tools | Scope |
|---|---|---|
| Unit | Vitest | stores, hooks, pure helpers, formatters |
| Component | Vitest + Testing Library + MSW | features against mocked API (MSW handlers typed from contracts) |
| E2E | Playwright | critical journeys: sign up → create location → add service → book; customer OTP login → reschedule; handoff queue |
| Visual / a11y | Playwright + axe | key screens in light/dark and one RTL locale |

## 15. Performance

- Route-level code splitting; heavy libraries (calendar grid, charts, rich editors) are
  lazy-loaded.
- Lists over ~100 rows are virtualized (TanStack Virtual).
- Customer app: SSR + streaming for public pages, image optimization, edge caching of
  public location pages with revalidation on catalogue change.
- Budgets: dashboard initial JS < 250 KB gz; widget core < 60 KB gz; customer public page
  LCP < 2.5 s on 4G.

## 16. Mobile readiness

The future customer mobile app (React Native / Expo) reuses `contracts`, `api-client`,
`utils`, `i18n` and the query-key factories, and authenticates with the token flow
([BACKEND.md §6.1](BACKEND.md#61-credentials-by-client-type)). To keep that possible:

- No DOM or browser API usage in shared packages.
- Business rules shown in the UI (e.g. "can this booking still be cancelled?") come from
  API fields (`allowedActions`), not duplicated client-side logic.
- Push notification registration uses `push_devices` from day one for web push.

## 17. Screen map

### Dashboard (`apps/dashboard`)

| Area | Screens | Spec |
|---|---|---|
| Auth | Login, signup, 2FA, reset, accept invitation | [auth-and-identity](docs/features/auth-and-identity.md) |
| Onboarding | Wizard: organization → first location → capabilities → catalogue → agent → channel → test | [organizations-and-access](docs/features/organizations-and-access.md#onboarding) |
| Overview | KPIs, live activity, alerts | [analytics](docs/features/analytics.md) |
| Calendar | Day/week/resource views, drag to reschedule, manual booking | [appointments](docs/features/appointments.md) |
| Bookings | List, filters, detail drawer with timeline | [appointments](docs/features/appointments.md) |
| Reservations | Book, floor view, service period view | [reservations](docs/features/reservations.md) |
| Orders | Kitchen queue, order list, order detail | [food-ordering](docs/features/food-ordering.md) |
| Customers | List, profile with cross-capability history, consents | [customers](docs/features/customers.md) |
| Conversations | Call/chat log, transcript, recording, outcome; live monitor | [voice-agent](docs/features/voice-agent.md) |
| Handoffs & tasks | Queue, callback tasks | [handoff](docs/features/handoff.md) |
| Catalogue | Services, categories, policies, forms; menus, products, modifiers | [appointments](docs/features/appointments.md), [food-ordering](docs/features/food-ordering.md) |
| Team & resources | Staff members, resources, groups, schedules, time off | [scheduling-and-availability](docs/features/scheduling-and-availability.md) |
| Agent | Persona, greeting, languages, instructions, handoff rules, test console, versions | [voice-agent](docs/features/voice-agent.md) |
| Knowledge | FAQ entries, documents, URLs | [knowledge-base](docs/features/knowledge-base.md) |
| Channels | Phone numbers, forwarding, widget install, in-app | [channels](docs/features/channels.md) |
| Notifications | Templates, reminders, staff alerts | [notifications](docs/features/notifications.md) |
| Payments | Stripe Connect, policies, payments, refunds | [payments](docs/features/payments.md) |
| Integrations | Calendars, API keys, webhooks | [integrations](docs/features/integrations.md) |
| Settings | Organization, locations, team & roles, billing | [organizations-and-access](docs/features/organizations-and-access.md), [billing-and-plans](docs/features/billing-and-plans.md) |

### Admin console (`apps/admin`)

Organizations, users, plans & prices, coupons, provider credentials, model profiles and
assignments, feature flags, phone number inventory, platform health, audit search —
[super-admin](docs/features/super-admin.md).

### Customer app (`apps/customer`)

Public: location page (`/{orgSlug}/{locationSlug}`), book appointment, reserve table,
order food. Authenticated: OTP login, home (upcoming across all businesses), booking
and order detail (reschedule, cancel, pay), businesses list, talk to a business's agent,
profile (contacts, password, sessions, consents, data export) —
[customers](docs/features/customers.md).
