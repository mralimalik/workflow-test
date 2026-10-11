# Phase 0 — Foundation: implementation plan

| | |
|---|---|
| Goal | A secure, multi-tenant platform skeleton — auth, businesses, locations, opening hours, team and access, admin basics — fully tested, on which every later feature is built |
| Order | **Part A: backend** (complete and verified) → **Part B: dashboard + admin UI** (starts after design references are shared and the design system is approved) |
| Specs | [roadmap §Phase 0](../product/roadmap.md#phase-0--foundation), [ARCHITECTURE.md](../../ARCHITECTURE.md), [BACKEND.md](../../BACKEND.md), [FRONTEND.md](../../FRONTEND.md), feature docs linked per milestone |
| Status | In progress — A0 |

This plan says **in what order** to build, **what** each step delivers, and **how we prove
it works**. Behaviour, data and API conventions are defined in the linked docs and are
not repeated here.

---

## 0. Scope

### In Phase 0

| Area | Spec |
|---|---|
| Monorepo, tooling, CI | [ADR-0012](../adr/0012-monorepo.md), [BACKEND.md §15](../../BACKEND.md#15-code-conventions) |
| Backend kernel: config, logging, request context, errors, ids, OpenAPI | [BACKEND.md §4–5, §8, §11–12](../../BACKEND.md) |
| Database: Drizzle, migrations, roles, RLS, tenant transactions | [BACKEND.md §7, §13](../../BACKEND.md#7-multi-tenancy-and-data-access), [data model README](../data-model/README.md) |
| Platform modules: audit, outbox, idempotency, cache, rate limits, queues, worker, files, feature flags, inbound webhooks, email | [data model 14](../data-model/14-system.md), [BACKEND.md §9–10](../../BACKEND.md#9-caching) |
| Auth for **users** and **platform admins** (sessions, 2FA, reset, verification, revoke, ban) | [auth-and-identity](../features/auth-and-identity.md) |
| Organizations, settings inheritance, onboarding state | [organizations-and-access](../features/organizations-and-access.md) |
| Locations, capabilities (enable/disable), **opening hours** (schedules, exceptions, holidays) | [organizations-and-access](../features/organizations-and-access.md), [scheduling-and-availability](../features/scheduling-and-availability.md) (opening-hours part only) |
| Team: roles, memberships, location scope, invitations, permission guard | [organizations-and-access](../features/organizations-and-access.md#permission-catalogue) |
| Plans + entitlements (seeded, read-only — no Stripe yet) | [billing-and-plans](../features/billing-and-plans.md), [data model 09](../data-model/09-platform-billing.md) (`plans` only) |
| Admin: admin login, admins, organizations list/suspend, feature flags, audit search | [super-admin](../features/super-admin.md) |
| Real-time gateway (Socket.IO) with org/location rooms | [BACKEND.md §10.4](../../BACKEND.md#104-real-time-push-dashboards) |
| Dashboard + admin UI for all of the above | [FRONTEND.md](../../FRONTEND.md) |

### Explicitly not in Phase 0 (and where it goes)

| Item | Phase |
|---|---|
| Customer realm auth (phone OTP) | 2 — built with the customer app; needs the SMS provider |
| Staff members, resources, services, availability, bookings | 1 |
| Agents, providers, model profiles, knowledge | 1 |
| Stripe subscriptions, usage metering | 2 (Phase 0 only seeds `plans` and resolves entitlements locally) |
| Google sign-in, impersonation, custom roles | 2 |
| Mobile token flow (JWT + refresh) | 4 |

---

## 1. How we test (applies to every milestone)

| Layer | What | Tooling | Runs |
|---|---|---|---|
| **Unit** | Pure logic: settings resolution, permission evaluation, time/schedule math, password policy, id/reference generation, error mapping | Vitest | every commit, < 30 s |
| **Integration** | Repositories against real Postgres + Redis: constraints, **RLS fails closed**, transactions, outbox, cache invalidation, rate limits | Vitest + docker compose services; one database per test worker created from a migrated template DB | every commit |
| **API e2e** | Real Nest app over HTTP (Supertest): status codes, problem+json bodies, cookies/CSRF, permissions, idempotency, pagination | Vitest + Supertest | every commit |
| **Tenant isolation suite** | For **every** business endpoint (enumerated from the contracts): a user of org B gets `404`/`403`; a location-scoped manager gets `404` for other locations | Generated test matrix | every commit |
| **API scenario runs** | Human-readable end-to-end flows against a running API; writes a report of each request and (redacted) response for review | `pnpm api:scenarios` → `reports/api-scenarios/<timestamp>.md` | on demand + CI artifact |
| **Manual exploration** | Ready-made request collection with environment variables | `.http` files (VS Code REST Client / JetBrains HTTP client) in `apps/api/http/` | on demand |
| **UI e2e** (Part B) | Playwright through the real dashboard against the real API | Playwright | CI |

**Test data:** factories in `packages/server/test/factories` (organization, location,
user, membership…) build valid rows through the real services, never raw inserts that
bypass rules. **Emails** are captured by Mailpit locally; tests read them through
Mailpit's API to follow verification/reset/invitation links.

**Coverage gates (CI):** domain ≥ 90%, application ≥ 80%; tenant isolation suite must list
every business route (CI fails if a new route lacks an isolation case).

**Requirement traceability:** test names include requirement ids
(`FR-ORG-007 manager cannot read other location`).

---

## Part A — Backend

Each milestone ends with a **demo** you can run and a **done when** checklist. Milestones
are merged in order; each one is a reviewable PR.

### A0 · Repository and tooling

**Build**
- pnpm workspace + Turborepo; Node 22 pinned (`.nvmrc`, `engines`).
- Packages: `packages/config` (tsconfig bases, ESLint flat config with
  `eslint-plugin-boundaries`, Prettier), `packages/contracts`, `packages/utils`,
  `packages/server`; apps: `apps/api`, `apps/worker`.
- Vitest workspace with projects `unit`, `integration`, `e2e`.
- Scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `test:unit`, `test:int`,
  `test:e2e`, `db:migrate`, `db:seed`, `db:reset`, `api:scenarios`.
- GitHub Actions CI: install (cached) → lint → typecheck → unit → integration + e2e with
  Postgres/Redis service containers → build. Secret scanning (gitleaks) and dependency
  audit.
- Conventional Commits check on PR titles; PR template referencing requirement ids.

**Done when**
- [ ] `pnpm i && pnpm lint && pnpm typecheck && pnpm test` pass locally and in CI.
- [ ] A deliberate cross-feature deep import fails lint.
- [ ] `docker compose up -d` + `pnpm db:migrate` work from a clean clone following README.

### A1 · Backend kernel

**Build** (`packages/server/src/kernel`, [BACKEND.md §2–5, §8, §11–12](../../BACKEND.md))
- `AppConfig`: Zod-validated env; app refuses to start on invalid config.
- `RequestContext` (AsyncLocalStorage): requestId, traceId, actor, organization, location.
- pino logging with context bindings, redaction rules, PII masking serializers.
- Error hierarchy + global exception filter → RFC 9457 problem+json with stable `code`.
- ts-rest + Zod integration: validation pipe, response serialization, OpenAPI 3.1
  generation, Swagger UI at `/docs` (non-production).
- `kernel/ids`: UUIDv7, reference codes (Crockford base32, no ambiguous chars).
- `kernel/time`: `Clock` injection, timezone helpers (Temporal polyfill).
- Health endpoints `/internal/health/live`, `/internal/health/ready`.
- Security middleware: helmet, CORS allowlists per audience, body limits, cookie parser.
- OpenTelemetry SDK bootstrap (console/OTLP exporter; no backend required locally).

**Done when**
- [ ] Unknown error → `500 internal_error` with `requestId`; validation error → `422` with `errors[].path`.
- [ ] Every log line has `requestId`; secrets/PII redacted (unit tests on the redactor).
- [ ] `/docs` shows the generated OpenAPI; contract types compile in a client test.

### A2 · Database foundation

**Build** ([BACKEND.md §7, §13](../../BACKEND.md#7-multi-tenancy-and-data-access))
- Drizzle client with pooled `pg`; column helpers (`id`, `timestamps`, `tenant`, `money`,
  `softDelete`, `version`).
- Migration runner using the owner role; app runtime uses `attendra_app` (no RLS bypass).
- `db.tenantTx({ organizationId, actor }, fn)` with `SET LOCAL`; `db.platformTx` for
  audited platform-scope work; `db.customerTx` reserved for Phase 2.
- RLS helper SQL generator for migrations + **CI check** that every table with
  `organization_id` has RLS enabled, forced, and a `tenant_isolation` policy.
- Mapping of Postgres errors (unique, FK, check, exclusion) to domain/AppErrors.
- Seed framework: idempotent seeds (system roles, plans, feature flags, notification
  templates, first super admin via CLI), plus a `demo` seed (local only).
- Test harness: template database migrated once; per-worker clones; truncation helpers.

**Done when**
- [ ] Integration test: query without tenant context returns 0 rows; insert with another org's id fails.
- [ ] Integration test: pooled connection reuse never leaks `app.organization_id`.
- [ ] CI fails if a migration adds a tenant table without RLS.

### A3 · Platform modules

**Build** (owners and tables: [data model 14](../data-model/14-system.md))
- `audit`: `AuditService.record()`; append-only; monthly partitions + `partition-maintain` job.
- `outbox`: `OutboxWriter` in-transaction; relay in `apps/worker` (LISTEN/NOTIFY + 1 s
  poll, `FOR UPDATE SKIP LOCKED`, advisory-lock leader); event payload schemas in
  contracts.
- Queue infrastructure: BullMQ registry, base processor (tenant context, retries,
  dead-letter, trace propagation), `apps/worker` bootstrap with graceful shutdown.
- `idempotency`: interceptor + `idempotency_keys` + cleanup job.
- `cache`: `CacheService` (cache-aside, version tokens, single-flight, jittered TTL,
  schema-validated reads) and event-driven invalidation hook.
- Rate limiting: Redis sliding window, route policies ([BACKEND.md §9.3](../../BACKEND.md#93-rate-limiting-also-redis)), `RateLimit-*` headers.
- `files`: `StorageProvider` interface with **local disk** implementation (S3/Azure later),
  signed upload/download URLs, content-type sniffing (needed for logos/avatars).
- `feature-flags`: evaluation with overrides and rollout buckets; cached.
- `inbound-webhooks`: store + dedupe + processing job skeleton (used from Phase 2).
- `notifications` (minimal): **email channel only** via SMTP (Mailpit locally); platform
  templates for `auth.verify_email`, `auth.password_reset`, `auth.login_alert`,
  `team.invitation`; `notifications` log rows; delivery through the queue.
- Real-time: Socket.IO gateway on `api` with Redis adapter, session auth on handshake,
  `org:` / `loc:` rooms with scope checks, `realtime/fanout` consumer.

**Done when**
- [ ] Integration: event written in a rolled-back transaction is never published; committed one is published exactly once even with 2 relay instances.
- [ ] Integration: same `Idempotency-Key` + same body → identical stored response; different body → `422 idempotency_key_reused`.
- [ ] Integration: cache entry invalidated after the corresponding event; stampede test issues one DB load for 50 concurrent reads.
- [ ] Email for a queued notification arrives in Mailpit.
- [ ] Socket client in another organization cannot join `org:{otherOrg}`.

### A4 · User authentication

**Build** ([auth-and-identity](../features/auth-and-identity.md)) — tables `users`,
`sessions`, `auth_challenges`, `mfa_factors`.
- Signup (Argon2id, password policy incl. breached-password list), email verification
  link, resend.
- Login with cookie session (`att_u`), CSRF token, idle/absolute expiry, Redis hot cache.
- Logout, list sessions, revoke one, revoke others.
- Forgot / reset password (single-use links), change password (re-auth) → revoke other
  sessions.
- TOTP enrol/confirm/disable + recovery codes; login step-up when MFA enabled or required.
- Lockout and rate limits on login, reset and verification endpoints; login alert email
  for new device (optional setting).
- `GET /auth/users/session` bootstrap (user, memberships summary, CSRF token).
- Account profile: `GET/PATCH /me/account` (name, locale, timezone, avatar).

**Done when**
- [ ] API e2e covers every row of the auth endpoint table for the `users` realm.
- [ ] Revoked session is rejected on the very next request (no TTL wait).
- [ ] Cookie-authenticated state-changing request without a CSRF token → `403`.
- [ ] Brute force: 11th login attempt in 15 min → `429`; OTP/link reuse → rejected.
- [ ] Scenario report "signup → verify → login → enable 2FA → login with 2FA → reset password".

### A5 · Platform admins (backend)

**Build** ([super-admin](../features/super-admin.md)) — tables `platform_admins`, plus
`feature_flags`, `feature_flag_overrides`.
- Separate realm (`att_a` cookie, `/auth/admins/*`), **mandatory TOTP** on first login.
- CLI: `pnpm admin:create --email --role super_admin` (only way to create the first admin).
- Admin endpoints: admins CRUD, organizations list/detail/suspend/reactivate, users
  search, ban/unban + revoke sessions, feature flags + overrides, audit log search,
  plans read.
- Admin role guard (`super_admin`, `support`, `billing`, `read_only`).

**Done when**
- [ ] A user session is rejected on `/admin/*` and vice versa (realm isolation test).
- [ ] Ban → user's sessions revoked immediately; audit rows written for every admin action.
- [ ] Suspended organization: business endpoints return `403 organization_suspended` (reads allowed per rules).

### A6 · Organizations

**Build** ([organizations-and-access](../features/organizations-and-access.md)) — table
`organizations`; `plans` seeded; `EntitlementsService` (plan + overrides, cached).
- Create organization (transaction): organization + owner membership + first location
  (+ its opening-hours schedule) + trial plan assignment (local; Stripe in Phase 2) +
  outbox events.
- Get/update organization, slug generation and uniqueness, logo upload (files).
- Settings: Zod schema for all keys, `GET/PATCH` organization settings,
  `SettingsResolver` (platform → plan → org → location → capability), caching + invalidation.
- Onboarding state endpoints (wizard progress).
- Organization status effects (active / restricted / suspended / closed) enforced by a guard.

**Done when**
- [ ] Unit: settings resolution covers every layer and locked keys.
- [ ] API e2e: create org → creator is owner → org listed in `/orgs`; second user cannot see it.
- [ ] `If-Match` mismatch on settings update → `412`.

### A7 · Locations and opening hours

**Build** — tables `locations`, `location_capabilities`, `schedules`,
`schedule_intervals`, `schedule_exceptions` (opening-hours purpose).
- Locations CRUD (soft delete rules), slug, timezone validation (IANA), address,
  optional coordinates, currency/locales inheritance, entitlement check on create.
- Capabilities: enable/disable with entitlement check; capability settings validated.
- Opening hours: weekly intervals (`PUT .../schedules/{id}/intervals`), split overnight
  spans, exceptions (closed / custom / extra hours), bulk holidays across locations
  (`POST /orgs/{orgId}/holidays/apply`).
- `GET {L}/opening-hours/effective?from=&to=` — resolved local open intervals per date
  (used by the dashboard, later by the agent and public pages). DST-correct.
- Effective location settings endpoint.

**Done when**
- [ ] Unit (property-based): effective hours across DST transitions in 5 timezones, overnight spans, overlapping exceptions.
- [ ] API e2e: location limit from plan returns `403 plan_limit_reached`.
- [ ] Deleting the last location is rejected; timezone change with no future bookings allowed.

### A8 · Team and access

**Build** — tables `roles`, `memberships`, `membership_locations`, `invitations`.
- System roles seeded from the [permission catalogue](../features/organizations-and-access.md#permission-catalogue)
  (catalogue lives in contracts as a constant; seed + tests derive from it).
- `PermissionGuard` + `@RequirePermission()` with location scope from route params;
  `404` for out-of-scope resources; permission set cached per membership.
- Members list/update role/scope/remove; last-owner protection; ownership transfer.
- Invitations: create (email via notifications), list, revoke, resend, expiry job;
  accept for existing user (logged in) and new user (signup during accept).
- `GET /permissions` catalogue; `GET /orgs/{orgId}/me` (my role, permissions, locations).
- Real-time room joins respect location scope.

**Done when**
- [ ] Tenant isolation suite generated over all business routes passes (org B and out-of-scope manager).
- [ ] Changing a member's role takes effect on their next request (cache invalidated).
- [ ] Scenario report "owner invites manager scoped to Location A → manager accepts → manager sees only A".

### A9 · Hardening and verification

**Build**
- Full API scenario suite (`pnpm api:scenarios`) with these flows, each producing a
  readable report:
  1. Signup → verify email → login → 2FA → logout everywhere.
  2. Create organization → add 2 locations → set opening hours and a holiday → read effective hours.
  3. Invite manager (Location A) and staff (all locations) → accept → permission checks.
  4. Settings inheritance: org default → location override → effective value.
  5. Admin: login with 2FA → suspend organization → business user blocked → reactivate.
  6. Abuse: rate limits, CSRF, idempotency replay, cross-tenant access attempts.
- `.http` collection covering every Phase 0 endpoint with an environment file.
- Load smoke (k6 or autocannon): login + read endpoints at 200 rps locally, p95 within
  [NFR-PERF-001](../product/requirements.md#nfr-perf--performance).
- Security review pass (auth, sessions, RLS, headers) and dependency audit clean.
- Docs updated wherever implementation refined a decision (docs stay the source of truth).

**Done when (= Part A complete)**
- [ ] All milestone checklists ticked; CI green; coverage gates met.
- [ ] Scenario reports reviewed by you.
- [ ] OpenAPI published at `/docs` and the contracts package builds the typed client used by Part B.

---

## Part B — Dashboard and admin UI

**Starts only after:** Part A is complete **and** you have shared design references.

### B0 · Design references → design system

1. You share references (images/links) with notes on what to take from each; stored in
   `docs/design/references/`.
2. I analyse them and generate a design system with `ui-ux-pro-max` (style, palette,
   typography, spacing/density, motion, chart style), adapted to a premium, data-dense
   fintech-grade dashboard; light and dark themes.
3. Output: `docs/design/design-system.md` (tokens and rules) + a rendered preview
   (components and two sample screens) for your approval.

**Done when:** you approve the design system preview.

### B1 · UI foundation (`packages/ui`, `packages/api-client`, `packages/i18n`)

- Tokens as CSS variables + Tailwind preset; light/dark; RTL-ready.
- Components: buttons, inputs with inline validation, select/combobox, date & time
  pickers, phone/address inputs, stepper, tabs, dialogs/sheets, dropdowns, tooltips,
  toasts, skeletons, empty states, data table (sorting, filters, pagination, saved views),
  weekly hours editor, avatar/uploader, command palette (⌘K), keyboard shortcut system.
- Component workbench (Storybook) for review; accessibility checks (axe) per component.
- `api-client` with CSRF, request id, locale, typed errors; React Query key factories.

### B2 · Dashboard app shell

- Auth layout + app layout (sidebar, top bar, org/location switcher, user menu,
  notifications slot), routing per [FRONTEND.md §6](../../FRONTEND.md#6-routing-tenancy-and-permissions),
  permission-aware navigation, real-time connection, global error/empty/loading patterns.

### B3 · Dashboard screens (foundation)

| Area | Screens |
|---|---|
| Auth | Sign up, verify email, log in, 2FA challenge, forgot/reset password, accept invitation |
| Onboarding | Wizard: business details → first location (address, timezone, hours) → capabilities → invite team → done |
| Locations | List (status, hours today, capabilities), detail (profile, address + map, opening hours editor, holidays/exceptions, capabilities, settings) |
| Organization settings | Profile & branding (logo), languages & currency, settings inheritance view |
| Team | Members (role, scope, status), invite, roles & permissions viewer, pending invitations |
| Account | Profile, password, 2FA, active sessions |
| Overview | Placeholder home with setup checklist (real KPIs arrive with later phases) |

### B4 · Admin console

Admin login with 2FA, organizations list/detail/suspend, users search/ban, admins,
feature flags, audit log search, plans (read-only).

### B5 · UI end-to-end verification

Playwright suites (against real API + Mailpit):
1. Sign up → verify (link from Mailpit) → onboarding wizard → dashboard.
2. Add second location with different hours and a holiday → effective hours shown correctly in its timezone.
3. Invite manager scoped to one location → accept in a second browser context → sees only that location; restricted actions hidden and blocked.
4. Enable 2FA → log out → log in with TOTP; revoke other session.
5. Admin suspends the organization → owner sees suspended state → reactivate.

Plus visual checks (light/dark, one RTL locale) and axe accessibility checks on every screen.

**Done when (= Phase 0 complete)**
- [ ] All Part B suites green in CI; you have reviewed the screens.
- [ ] [Roadmap Phase 0 exit criteria](../product/roadmap.md#phase-0--foundation) met.
- [ ] Phase 1 (appointments) plan written.

---

## Milestone tracker

| Milestone | Status |
|---|---|
| A0 Repository and tooling | ☐ |
| A1 Backend kernel | ☐ |
| A2 Database foundation | ☐ |
| A3 Platform modules | ☐ |
| A4 User authentication | ☐ |
| A5 Platform admins | ☐ |
| A6 Organizations | ☐ |
| A7 Locations and opening hours | ☐ |
| A8 Team and access | ☐ |
| A9 Hardening and verification | ☐ |
| B0 Design system (needs your references) | ☐ |
| B1 UI foundation | ☐ |
| B2 Dashboard shell | ☐ |
| B3 Foundation screens | ☐ |
| B4 Admin console | ☐ |
| B5 UI end-to-end verification | ☐ |
