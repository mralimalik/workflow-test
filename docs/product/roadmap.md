# Roadmap

The data model and architecture are designed for **all** phases up front
([data-model](../data-model/README.md)). Phases decide only what gets **built** and in what
order. Each phase ends with something usable end-to-end.

Requirement IDs per phase are listed in [requirements.md](requirements.md).

```
Phase 0  Foundation            → a secure, multi-tenant skeleton
Phase 1  Appointments + agent   → book via the agent in a browser test console
Phase 2  Go live               → real phone calls, widget, customer app, billing  ← first paying customers
Phase 3  Restaurants           → food ordering, table reservations, customer payments
Phase 4  Expansion             → WhatsApp, mobile apps, public API, BYOK, more
Future   Lodging               → hotel stays (possibly a separate product)
```

---

## Phase 0 — Foundation

**Goal:** the platform skeleton every later feature plugs into.

| Area | Deliverables |
|---|---|
| Repo | pnpm + Turborepo monorepo, shared configs, CI (lint, typecheck, test, build), Conventional Commits |
| Backend | NestJS `api` and `worker` apps, config validation, pino logging, request context, problem+json errors, OpenAPI from contracts, health checks |
| Data | Drizzle setup, migrations, RLS framework, tenant-scoped transaction helper, seed scripts |
| Cross-cutting | Audit log, transactional outbox + relay, idempotency keys, inbound webhook store, files, feature flags, Redis cache module, rate limiting |
| Auth | User signup/login/reset/verify, platform admin login with 2FA, sessions in cookies, revoke/ban |
| Tenancy | Organizations, locations, location capabilities, settings inheritance, memberships, invitations, system roles, permission guard |
| Frontend | `packages/ui`, `packages/api-client`, dashboard shell (auth, org/location switcher, layout), admin shell |

**Exit criteria:** an owner can sign up, create an organization with two locations, invite
a manager scoped to one location, and the manager cannot read the other location's data
(proven by tests at API and RLS level).

## Phase 1 — Appointments core and agent core

**Goal:** a business can be fully configured for appointments, and the agent can book
correctly — tested from the dashboard, before any telephony.

| Area | Deliverables |
|---|---|
| Scheduling | Schedules, staff members, resources, resource groups, availability engine, holds, exclusion constraints |
| Catalogue | Service categories, services, variants, location overrides, resource rules, policies |
| Bookings | Booking lifecycle, events, dashboard calendar (day/week/resource views), manual booking |
| Customers | Global customers, customer profiles, consents, customer list and detail |
| Agent | Agents + versions (draft/publish), instruction builder, tool registry (appointment + inquiry tools), guardrails |
| Providers | Provider credentials (encrypted), model profiles, assignments, OpenAI Realtime + Azure OpenAI Realtime adapters |
| Knowledge | FAQ entries and text sources, embeddings, retrieval |
| Test console | Voice (WebRTC) and text test of the draft agent in the dashboard |
| Admin | Organizations list/suspend, providers, model profiles, feature flags, admin roles |

**Exit criteria:** in the test console, the agent books, reschedules and cancels correctly
for a multi-staff, multi-location business; concurrent booking attempts on the same slot
never both succeed (load test).

## Phase 2 — Go live

**Goal:** real customers calling real numbers; businesses paying.

| Area | Deliverables |
|---|---|
| Phone | Twilio adapter, number purchase + forwarding setup, media gateway, recording disclosure, central-number routing |
| Widget | Embeddable widget (voice + text), allowed origins, OTP verification |
| Customer app | Next.js app: OTP login, all bookings across businesses, manage bookings, profile, in-app agent; public location pages with booking |
| Handoff | Rules engine, warm/cold transfer, handoff targets with schedules, callback tasks, handoff queue |
| Notifications | SMS + email templates, reminders, opt-out, delivery tracking, staff alerts |
| Conversations | Transcripts, summaries, outcomes, sentiment, call log UI |
| Billing | Plans, prices, trials, Stripe Billing subscriptions, proration, coupons, usage metering, dunning, billing portal |
| Integrations | Google Calendar push + busy read |
| Onboarding | Wizard, industry templates |
| Analytics | Overview dashboard, usage vs allowance |

**Exit criteria:** a pilot business runs on Attendra for two weeks with real calls, real
bookings and a paid subscription.

## Phase 3 — Restaurants and payments

| Area | Deliverables |
|---|---|
| Ordering | Menus, products, modifiers, location availability, draft orders, agent ordering tools, kitchen queue, delivery zones, taxes, busy mode |
| Reservations | Areas, tables, combinations, service periods, turn times, pacing, auto-assignment, floor view |
| Payments | Stripe Connect onboarding, payment links, deposits/prepayments/fees by policy, refunds, application fees |
| Channels | Live takeover for widget/app |
| Integrations | Microsoft Calendar |
| Privacy | Customer data export and deletion, retention jobs |
| Analytics | Cross-location comparison, CSV export |

## Phase 4 — Expansion

| Area | Deliverables |
|---|---|
| Channels | WhatsApp (text, then calls), SMS conversations, consented outbound calls |
| Mobile | Customer mobile app (React Native / Expo) on the same API, push notifications |
| Platform | Public API with API keys, outbound webhooks, BYOK for Enterprise, custom roles |
| Commerce | Promotions/promo codes for orders, group classes, waitlist, POS integrations |

## Future — Lodging

Room types, units, rate plans, multi-night stays. The `bookings`/`booking_allocations`
model already supports date-range stays; see [features/lodging.md](../features/lodging.md).
Decision on in-product vs separate product is pending ([prd.md §12](prd.md#12-open-questions)).
