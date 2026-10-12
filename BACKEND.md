# Backend

How the backend is structured and the conventions every module follows. System-level
context is in [ARCHITECTURE.md](ARCHITECTURE.md); table definitions are in
[docs/data-model](docs/data-model/README.md).

Contents:
1. [Stack](#1-stack)
2. [Apps and repository layout](#2-apps-and-repository-layout)
3. [Module architecture](#3-module-architecture)
4. [Request lifecycle](#4-request-lifecycle)
5. [API conventions](#5-api-conventions)
6. [Authentication and authorization](#6-authentication-and-authorization)
7. [Multi-tenancy and data access](#7-multi-tenancy-and-data-access)
8. [Logging and observability](#8-logging-and-observability)
9. [Caching](#9-caching)
10. [Background jobs and events](#10-background-jobs-and-events)
11. [Error handling](#11-error-handling)
12. [Configuration and secrets](#12-configuration-and-secrets)
13. [Database migrations](#13-database-migrations)
14. [Testing](#14-testing)
15. [Code conventions](#15-code-conventions)

---

## 1. Stack

| Concern | Choice | ADR |
|---|---|---|
| Runtime | Node.js 22 LTS, TypeScript (strict) | — |
| Framework | NestJS 12 on the Express adapter (PERN); built-in features first; CommonJS build | [0002](docs/adr/0002-modular-monolith-nestjs.md), [0013](docs/adr/0013-nestjs-12-built-in-first.md) |
| Database | PostgreSQL 17 (+ `btree_gist`, `citext`, `pgvector`) | [0001](docs/adr/0001-postgresql.md) |
| ORM / query builder | Drizzle ORM + drizzle-kit (SQL migrations) | [0003](docs/adr/0003-drizzle-orm.md) |
| API contracts | Zod 4 schemas + typed route registry in `packages/contracts`; Nest-native validation; OpenAPI 3.1 via zod-openapi | [0014](docs/adr/0014-zod-contracts-openapi.md) |
| Auth | Own implementation: server-side sessions (cookies) + JWT/refresh for mobile | [0005](docs/adr/0005-session-auth-with-token-refresh.md) |
| Cache, sessions, rate limits | Redis (ioredis) | [0008](docs/adr/0008-redis-and-bullmq.md) |
| Queues | BullMQ | [0008](docs/adr/0008-redis-and-bullmq.md) |
| Real-time to dashboards | Socket.IO with Redis adapter | — |
| Logging | pino via nestjs-pino | — |
| Tracing / metrics | OpenTelemetry SDK (OTLP exporter) | — |
| Error tracking | Sentry | — |
| Testing | Vitest, Supertest, real Postgres/Redis | — |
| Payments / billing | Stripe (Connect, Billing) | [0009](docs/adr/0009-stripe-billing-and-connect.md) |
| AI providers | OpenAI Realtime, Azure OpenAI Realtime (adapters) | [0007](docs/adr/0007-provider-abstraction.md) |
| Telephony | Twilio (adapter) | [0007](docs/adr/0007-provider-abstraction.md) |

## 2. Apps and repository layout

```
apps/
  api/        src/main.ts         HTTP + WebSocket bootstrap; imports ApiModule
  worker/     src/main.ts         standalone Nest app; imports WorkerModule
  media/      src/main.ts         WebSocket media gateway; imports MediaModule
packages/
  contracts/  zod schemas, enums, route registry, event payload schemas  (shared with frontend)
  server/     (internal, backend-only) — all domain modules, shared kernel, infra
```

The backend code lives in **`packages/server`** so that `api`, `worker` and `media`
compose the same modules without duplication:

```
packages/server/src/
  kernel/                      cross-cutting building blocks (no business logic)
    context/                   RequestContext (AsyncLocalStorage): requestId, actor, org, location
    db/                        Drizzle client, tenant transaction helper, base column helpers
    errors/                    AppError hierarchy, problem+json mapping
    http/                      guards, interceptors, pipes, decorators
    cache/                     CacheService (cache-aside, single-flight, tag versions)
    queue/                     queue registry, base processor, job options
    events/                    domain event types, outbox writer
    crypto/                    envelope encryption, hashing, token generation
    time/                      timezone + interval utilities (pure)
    money/                     minor-unit arithmetic (pure)
    ids/                       UUIDv7, reference codes
  modules/
    auth/  users/  platform-admins/  organizations/  locations/  access/  api-keys/
    customers/  scheduling/  catalog/  bookings/  ordering/  payments/  billing/
    channels/  conversations/  handoff/  tasks/  providers/  agents/  knowledge/
    agent-runtime/  notifications/  integrations/  calendar-sync/  webhooks-out/
    audit/  outbox/  idempotency/  files/  feature-flags/  inbound-webhooks/  analytics/
  apps/
    api.module.ts  worker.module.ts  media.module.ts   (composition roots)
```

## 3. Module architecture

### 3.1 Layers inside a module

```
modules/bookings/
  bookings.module.ts            Nest module: providers, exports (the public API)
  api/                          HTTP layer — thin
    bookings.controller.ts        business audience  (/v1/orgs/:orgId/...)
    customer-bookings.controller.ts  customer audience (/v1/me/...)
    public-bookings.controller.ts    public audience   (/v1/public/...)
  application/                  use cases — orchestration, transactions, authorization
    create-booking.service.ts
    reschedule-booking.service.ts
    cancel-booking.service.ts
    booking-queries.service.ts
  domain/                       pure business logic — no Nest, no DB, no I/O
    booking.ts                    entity/aggregate with state transitions
    booking-status.ts             transition table
    booking-policy.ts             cancellation/deposit evaluation
  infrastructure/
    bookings.schema.ts            Drizzle table definitions (this module's tables only)
    bookings.repository.ts        persistence; always tenant-scoped
    bookings.mapper.ts            row ↔ domain ↔ contract DTO
  events/
    booking.events.ts             event names + payload types (re-exported from contracts)
    handlers/                     consumers of other modules' events (if any)
  jobs/                         BullMQ processors owned by this module (worker only)
  bookings.public.ts            the ONLY file other modules may import
  __tests__/
```

**Rules** (lint-enforced with `eslint-plugin-boundaries`):

1. Controllers call application services only. No repository or DB access in controllers.
2. Application services own transactions, authorization checks, event emission, and
   calls to other modules' public services.
3. Domain code is pure TypeScript and has unit tests without mocks.
4. A module's tables are read and written only by that module's repositories
   ([NFR-MAINT-002](docs/product/requirements.md#nfr-maint--maintainability)). Other
   modules use its public service or subscribe to its events. Cross-module foreign keys
   are allowed; cross-module queries are not (read models built from events are allowed
   for analytics).
5. Other modules import only `<module>.public.ts` (exported services, types, tokens).
6. Request/response shapes come from `packages/contracts`; the backend never defines a
   second copy of an API type.

### 3.2 Module catalogue

| Module | Owns tables (see data model) | Main public services |
|---|---|---|
| `auth` | `sessions`, `refresh_tokens`, `auth_challenges`, `mfa_factors`, `oauth_accounts` | `SessionService`, `ChallengeService` |
| `users` | `users` | `UsersService` |
| `platform-admins` | `platform_admins`, `impersonation_sessions` | `PlatformAdminsService` |
| `organizations` | `organizations` | `OrganizationsService`, `SettingsResolver` |
| `locations` | `locations`, `location_capabilities` | `LocationsService` |
| `access` | `roles`, `memberships`, `membership_locations`, `invitations` | `AccessService` (permission checks) |
| `api-keys` | `api_keys` | `ApiKeysService` |
| `customers` | `customers`, `customer_profiles`, `customer_addresses`, `consents` | `CustomersService`, `ConsentService` |
| `scheduling` | `schedules`, `schedule_intervals`, `schedule_exceptions`, `staff_members`, `resources`, `resource_groups`, `resource_group_members`, `resource_combinations`, `resource_combination_members`, `external_busy_blocks` | `AvailabilityService`, `ResourcesService` |
| `catalog` | `service_categories`, `services`, `service_variants`, `location_services`, `service_resource_rules`, `policies`, `forms`, `form_versions`, `form_responses`, `tax_categories`, `tax_rates` | `CatalogService`, `PolicyService` |
| `bookings` | `bookings`, `booking_items`, `booking_allocations`, `reservation_details`, `booking_participants`, `booking_events`, `reservation_turn_rules`, `reservation_pacing_rules` | `BookingsService` |
| `ordering` | all tables in [07](docs/data-model/07-ordering.md) | `MenuService`, `OrdersService` |
| `payments` | `payment_accounts`, `payments`, `refunds` | `PaymentsService` |
| `billing` | all tables in [09](docs/data-model/09-platform-billing.md) | `EntitlementsService`, `UsageService` |
| `channels` | `phone_numbers`, `channel_endpoints` | `ChannelRoutingService`, channel adapters |
| `conversations` | `conversations`, `media_sessions`, `messages`, `conversation_events` | `ConversationsService` |
| `handoff` | `handoff_targets`, `handoffs` | `HandoffService` |
| `tasks` | `tasks` | `TasksService` |
| `providers` | `provider_credentials`, `ai_model_profiles`, `ai_profile_assignments` | `ProviderResolver`, provider adapters |
| `agents` | `agents`, `agent_versions` | `AgentsService` |
| `knowledge` | `knowledge_sources`, `knowledge_entries`, `knowledge_chunks` | `KnowledgeRetriever` |
| `agent-runtime` | — (stateless; writes through `conversations`) | `AgentRuntime`, `ToolRegistry` |
| `notifications` | all tables in [12](docs/data-model/12-notifications.md) | `NotificationsService` |
| `integrations` | `integration_connections`, `sync_mappings` | `ConnectionsService` |
| `calendar-sync` | `calendar_links` | — (event-driven) |
| `webhooks-out` | `webhook_endpoints`, `webhook_deliveries` | — (event-driven) |
| `audit` | `audit_logs` | `AuditService` |
| `outbox` | `outbox_events` | `OutboxWriter` |
| `idempotency` | `idempotency_keys` | `IdempotencyInterceptor` |
| `files` | `files` | `FilesService`, `StorageProvider` |
| `feature-flags` | `feature_flags`, `feature_flag_overrides` | `FeatureFlags` |
| `inbound-webhooks` | `inbound_webhook_events` | `InboundWebhookStore` |
| `analytics` | read models (later) | `AnalyticsQueries` |

## 4. Request lifecycle

Order of execution for every HTTP request in `api`:

```
1. Express: helmet, compression, cookie-parser, body limits (1 MB default; webhooks raw body)
2. RequestContextMiddleware  → requestId (X-Request-Id or new UUIDv7), traceId, start AsyncLocalStorage
3. pino-http                 → request log with context bindings
4. CORS                      → per-audience allowlist
5. RateLimitGuard            → Redis sliding window (route policy, IP, subject, organization)
6. AuthGuard (per audience)  → resolve session/token/api key → actor in RequestContext
7. CsrfGuard                 → cookie-authenticated, state-changing requests only
8. TenantGuard               → resolve :orgId (+ :locationId) → verify membership/scope → RequestContext
9. PermissionGuard           → @RequirePermission('bookings.update') against membership
10. ContractValidationPipe   → Nest's StandardSchemaValidationPipe with the route's Zod schemas (422 on failure)
11. IdempotencyInterceptor   → for POSTs with Idempotency-Key (§5.9)
12. Controller → application service (opens tenant transaction §7.3)
13. Response serialization   → contract schema (strips unknown fields)
14. ExceptionFilter          → problem+json (§11), logs error with context
```

## 5. API conventions

These rules apply to every endpoint. Feature docs list endpoints; they do not restate
conventions.

### 5.1 Audiences and base paths

The API is one service with separate audiences. Each audience has its own auth guard and
route prefix.

| Audience | Prefix | Auth | Used by |
|---|---|---|---|
| Business | `/v1/orgs/{orgId}/...` | user session / user access token / API key | dashboard, public API |
| Customer | `/v1/me/...` | customer session / customer access token | customer app, mobile |
| Public | `/v1/public/...` | none, or widget key + origin check, or short-lived conversation token | widget, public pages |
| Platform admin | `/v1/admin/...` | platform admin session (2FA) | admin console |
| Auth | `/v1/auth/{realm}/...` (`users`, `customers`, `admins`) | varies | all apps |
| Webhooks | `/v1/webhooks/{provider}/...` | provider signature | Stripe, Twilio, Google, Meta |
| Internal | `/internal/...` (not exposed publicly) | service token | health, metrics |

### 5.2 URL design

- Plural, kebab-case resource names: `/service-categories`, `/bookings`.
- Location-scoped resources nest under the location:
  `/v1/orgs/{orgId}/locations/{locationId}/bookings`.
  Organization-level resources do not: `/v1/orgs/{orgId}/services`.
- IDs in paths are UUIDs. Lookups by reference code use a query filter:
  `GET .../bookings?referenceCode=BK-7F3K2Q`.
- At most one level of nesting below the scope (`/bookings/{id}/events` is fine;
  deeper is not).
- **Actions** that are not CRUD use a sub-resource verb with `POST`:
  `POST .../bookings/{id}/cancel`, `/reschedule`, `/check-in`, `/no-show`;
  `POST .../agents/{id}/publish`. State transitions never happen via `PATCH status`.

### 5.3 Methods and status codes

| Method | Use | Success |
|---|---|---|
| `GET` | read | `200` |
| `POST` | create / action | `201` + `Location` header (create), `200` (action), `202` (async accepted) |
| `PATCH` | partial update (JSON merge semantics on defined fields) | `200` |
| `PUT` | full replacement of a sub-document (e.g. weekly intervals of a schedule) | `200` |
| `DELETE` | delete / archive | `204` |

Errors: `400` malformed, `401` unauthenticated, `403` forbidden, `404` not found (also used
when the resource exists in another tenant), `409` conflict (slot taken, version
mismatch, state transition not allowed), `412` precondition failed (`If-Match`), `422`
validation, `429` rate limited, `5xx` server.

### 5.4 Payloads

- JSON, **camelCase** in the API; **snake_case** in the database. Mapping happens in
  mappers only.
- Single resources are returned unwrapped: `{ "id": "...", ... }`.
- Collections: `{ "data": [...], "meta": { "nextCursor": "...", "hasMore": true } }`.
- Timestamps: ISO 8601 UTC with `Z` (`2026-10-11T14:30:00Z`). Local wall times (e.g. in
  schedules) are `HH:mm` plus the owning location's timezone. Dates: `YYYY-MM-DD`.
- Money: `{ "amountMinor": 2500, "currency": "USD" }` — never floats.
- Translatable fields are returned resolved for the requested locale (`Accept-Language`
  or `?locale=`), with the full map available on management endpoints as
  `translations: { "es": { "name": "..." } }`.
- Enums are lowercase snake_case strings, defined once in `packages/contracts`.
- Nulls: optional fields that are unset are returned as `null`, never omitted, so
  clients get a stable shape.

### 5.5 Pagination, filtering, sorting

- **Cursor pagination** everywhere: `?limit=50&cursor=<opaque>`; `limit` max 200,
  default 50. Cursors encode the sort key + id. Offset pagination is not offered.
- Filters are plain query params named after fields: `?status=confirmed&staffMemberId=...`.
  Multiple values: repeated params `?status=confirmed&status=held`. Ranges:
  `?startsAfter=...&startsBefore=...`.
- Sorting: `?sort=startsAt` or `?sort=-createdAt`; only whitelisted fields per endpoint.
- Full-text style search: `?q=`.
- Sparse expansions for related objects: `?expand=customer,items` (whitelisted).

### 5.6 Versioning and compatibility

- URL major version `/v1`. Additive changes (new fields, endpoints, enum values) do not
  bump the version; clients must ignore unknown fields and handle unknown enum values.
- Breaking changes go to `/v2` for the affected resources, with `/v1` kept for a
  published deprecation window and `Deprecation`/`Sunset` headers.

### 5.7 Concurrency control

Configuration resources with a `version` column (services, schedules, agents, menus,
settings) return `ETag: "<version>"`. Updates must send `If-Match`; a mismatch returns
`412`. Transactional resources (bookings, orders) use state-transition actions and
row locks instead.

### 5.8 Headers

| Header | Direction | Purpose |
|---|---|---|
| `X-Request-Id` | both | Correlation; echoed back; generated if absent |
| `Idempotency-Key` | request | §5.9 |
| `If-Match` / `ETag` | both | §5.7 |
| `Accept-Language` | request | Locale for translatable content and messages |
| `X-CSRF-Token` | request | Cookie-authenticated state-changing requests |
| `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After` | response | Rate limiting (IETF draft headers) |

### 5.9 Idempotency

- Every `POST` that creates something or triggers a side effect accepts
  `Idempotency-Key` (UUID). Required for: bookings, orders, payments, refunds, messages,
  invitations, and all agent tool calls (the runtime generates the key from
  `conversationId + toolCallId`).
- The first request stores `(scope, key, requestHash, response)` in `idempotency_keys`
  ([data model](docs/data-model/14-system.md#idempotency_keys)). Replays with the same
  hash return the stored response; a different hash returns `422 idempotency_key_reused`;
  a concurrent in-flight replay returns `409 request_in_progress`. Keys expire after 24 h.
- Inbound webhooks are de-duplicated by provider event id in `inbound_webhook_events`.

### 5.10 Contracts and OpenAPI

- Every endpoint is declared once in `packages/contracts` as a route in the typed route
  registry, with Zod schemas for params, query, headers, body, responses per status and
  error codes.
- Controllers implement routes with `@ContractRoute(route)`. Requests are validated by
  Nest's built-in `StandardSchemaValidationPipe` using the route's schemas (the handler
  gets parsed output), and responses are serialized through the route's response schema.
  A conformance test fails when a mounted route is missing from the registry, or the
  other way round.
- OpenAPI 3.1 is generated from the registry with zod-openapi at build time and published
  per audience (business/public API docs; customer and admin specs are internal).
- Frontends and mobile use `packages/api-client`: path types generated from the spec
  (openapi-typescript) on an openapi-fetch client; CI fails on drift. There is no
  hand-written request typing anywhere ([ADR-0014](docs/adr/0014-zod-contracts-openapi.md)).

### 5.11 Webhooks (inbound)

`POST /v1/webhooks/{provider}[/{purpose}]`: raw body preserved → signature verified →
stored in `inbound_webhook_events` (unique on provider + event id) → `200` returned
immediately → processed by a worker job. Twilio voice webhooks are the exception: they
must answer synchronously with TwiML, so they are handled inline (still verified and
logged).

## 6. Authentication and authorization

Full behaviour and endpoints: [features/auth-and-identity.md](docs/features/auth-and-identity.md).
Decision: [ADR-0005](docs/adr/0005-session-auth-with-token-refresh.md).

### 6.1 Credentials by client type

| Client | Mechanism |
|---|---|
| Web apps (dashboard, admin, customer web) | Opaque session id (256-bit random) in an `HttpOnly; Secure; SameSite=Lax` cookie, one cookie name per realm (`att_u`, `att_c`, `att_a`). Server stores only the SHA-256 hash in `sessions`; hot copy in Redis. |
| Mobile apps (future), CLI | `Authorization: Bearer <access JWT>` (10 min, EdDSA-signed, claims: `sub`, `realm`, `sid`, `ver`) + rotating refresh token (30 days, single use, family reuse detection) bound to a `sessions` row. |
| Public API | `Authorization: Bearer att_live_<prefix>_<secret>` organization API key, hashed at rest, scoped permissions. |
| Media gateway | One-time stream token (60 s) minted by the api for a specific media session. |
| Widget | Public widget key + origin check → short-lived conversation token (JWT, 30 min, bound to one conversation). |

### 6.2 Revocation and bans

- Revoking a session deletes it from Redis and sets `revoked_at` in Postgres. Cookie
  sessions are checked on every request → effect is immediate.
- Access JWTs carry the session id (`sid`); the guard checks a Redis revocation set for
  `sid` (O(1)), so revoked mobile sessions are cut within one request, not at token
  expiry.
- Banning a subject sets `status = 'banned'`, revokes all sessions and refresh token
  families, and bumps the subject's `session_version`; tokens carrying an older `ver`
  are rejected.

### 6.3 CSRF

Cookie-authenticated `POST/PATCH/PUT/DELETE` require `X-CSRF-Token` matching a token bound
to the session (synchronizer token, delivered by `GET /v1/auth/{realm}/session`).
`SameSite=Lax` is the second layer. Bearer-token requests are exempt.

### 6.4 Authorization model

- **Platform admins:** role-based (`super_admin`, `support`, `billing`, `read_only`) with
  per-endpoint requirements.
- **Users:** permission strings (`resource.action`, e.g. `bookings.update`) granted by the
  membership's role, constrained by its location scope. The catalogue of permissions and
  system roles is in [features/organizations-and-access.md](docs/features/organizations-and-access.md#permission-catalogue).
- **Customers:** can access only rows where `customer_id` is their own; business policy
  (e.g. cancellation window) is checked in the application layer.
- **Agent tools:** run as actor type `agent` with the conversation's organization,
  location and (if verified) customer. Each tool declares the permissions it implies;
  tools that touch existing bookings require a verified customer identity or a
  verification step in the flow.

```ts
@Post(':bookingId/cancel')
@RequirePermission('bookings.cancel')          // checked with location scope from the route
cancel(@Param() p: BookingParams, @Body() body: CancelBookingBody) { ... }
```

## 7. Multi-tenancy and data access

### 7.1 Database roles

| Role | Used by | RLS |
|---|---|---|
| `attendra` (owner) | migrations, seed scripts | bypasses (table owner) |
| `attendra_app` | api, worker, media at runtime | **enforced** (`NOBYPASSRLS`, policies `FORCE`d) |

### 7.2 RLS policies

Every tenant-owned table:

```sql
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings FORCE ROW LEVEL SECURITY;

-- Business and agent access: bound to one organization per transaction.
CREATE POLICY tenant_isolation ON bookings
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

-- Customer cross-organization access: only their own rows, read-only.
CREATE POLICY customer_read_own ON bookings FOR SELECT
  USING (customer_id = nullif(current_setting('app.customer_id', true), '')::uuid);
```

`current_setting(..., true)` returns `NULL` when the setting was never set and `''` on a
pooled connection after a previous transaction-local value ended; `nullif(..., '')` turns
both into `NULL`, so a query without context matches nothing (fails closed) instead of
raising a cast error. Policies are declared in Drizzle schemas with `tenantPolicies()` +
`.enableRLS()`; `FORCE` is appended with `forceRlsSql()` (Drizzle cannot express it), and
`pnpm db:check-rls` (CI) fails when a tenant table lacks any of the three
(`kernel/db/rls.ts`). Platform-scope jobs that legitimately span tenants (billing
reconciliation, retention) run with `app.scope = 'platform'` and dedicated policies limited
to the tables they need, and are audited.

### 7.3 Tenant transactions

All tenant data access goes through one helper; there is no other way to obtain a
tenant-scoped connection:

```ts
await db.tenantTx({ organizationId, actor }, async (tx) => {
  // SET LOCAL app.organization_id = $1; SET LOCAL app.actor_id = $2 (inside BEGIN)
  const booking = await bookingsRepo.create(tx, input);
  await outbox.write(tx, bookingConfirmed(booking));   // same transaction
  return booking;
});
```

- `SET LOCAL` scopes settings to the transaction, so pooled connections never leak
  tenant context.
- Repositories accept `tx` explicitly and always include `organization_id` in their
  predicates as well (defence in depth; also helps the planner use indexes).

### 7.4 Models (Drizzle) — the "Mongoose model" equivalent

Each module defines its tables in `infrastructure/<module>.schema.ts` using shared column
helpers, so every table is declared once, in TypeScript, with types inferred for the
repository layer:

```ts
// kernel/db/columns.ts
export const id = () => uuid('id').primaryKey().$defaultFn(uuidv7);
export const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
    .$onUpdate(() => new Date()),
});
export const tenant = () => ({
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
});
export const money = (name: string) => bigint(`${name}_minor`, { mode: 'number' });

// modules/bookings/infrastructure/bookings.schema.ts
export const bookings = pgTable('bookings', {
  id: id(),
  ...tenant(),
  locationId: uuid('location_id').notNull().references(() => locations.id),
  kind: text('kind', { enum: BOOKING_KINDS }).notNull(),
  status: text('status', { enum: BOOKING_STATUSES }).notNull(),
  referenceCode: text('reference_code').notNull(),
  customerId: uuid('customer_id').references(() => customers.id),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
  totalAmount: money('total_amount'),
  currency: char('currency', { length: 3 }),
  policySnapshot: jsonb('policy_snapshot').$type<PolicySnapshot>(),
  version: integer('version').notNull().default(1),
  ...timestamps(),
}, (t) => [
  uniqueIndex('bookings_org_reference_uq').on(t.organizationId, t.referenceCode),
  index('bookings_location_starts_idx').on(t.organizationId, t.locationId, t.startsAt),
  check('bookings_time_ck', sql`${t.endsAt} > ${t.startsAt}`),
]);

export type BookingRow = typeof bookings.$inferSelect;
export type NewBookingRow = typeof bookings.$inferInsert;
```

- Enum values (`BOOKING_STATUSES`) are imported from `packages/contracts` — defined once.
- Features Drizzle cannot express (exclusion constraints, RLS policies, partitioning,
  partial indexes with complex predicates, triggers) are written as raw SQL in the same
  migration and documented in the data-model page for the table.
- JSONB columns are typed with `$type<>()` and validated with the Zod schema from
  contracts before every write.

### 7.5 Query rules

- No `SELECT *` in repositories; select the columns the use case needs.
- Every list query is cursor-paginated and index-backed; new queries come with their index.
- No N+1: use joins or batched loads (`IN (...)`) in repositories.
- Long-running reports go to the read replica (when added) through a separate `readDb`.
- Statement timeout 5 s for API transactions, 60 s for workers (set per role/connection).

## 8. Logging and observability

### 8.1 Logs

- **pino** JSON logs to stdout. Level from `LOG_LEVEL`; `info` in production.
- Every log line is enriched from `RequestContext` (AsyncLocalStorage) — no manual passing:

  | Field | Example |
  |---|---|
  | `requestId` | `0192f...` |
  | `traceId`, `spanId` | OpenTelemetry ids |
  | `app` | `api` / `worker` / `media` |
  | `actor` | `{ type: 'user', id: '...' }` |
  | `organizationId`, `locationId` | tenant context |
  | `conversationId`, `jobId`, `queue` | when applicable |

- **Redaction** (pino `redact`): `authorization`, `cookie`, `set-cookie`, `password*`,
  `*.secret*`, `*.token*`, `*.apiKey`, `otp`, `code`, card data, and message/transcript
  bodies. Phone numbers and emails are masked (`+1•••••4567`) by a serializer.
- What to log: one line per request (method, route template, status, duration), state
  transitions at `info`, provider calls (provider, operation, duration, status — never
  payloads) at `info`, expected business rejections at `warn`, unexpected errors at
  `error` with stack.
- Error codes are logged as `errorCode` (the key `code` is redacted because it usually
  holds a one-time code).
- What not to log: request/response bodies, transcripts, prompts, secrets, full PII.
  Business history belongs in `audit_logs` and `*_events` tables, not logs.

### 8.2 Traces and metrics

- OpenTelemetry auto-instrumentation for HTTP, Express, pg, ioredis, BullMQ; manual spans
  for availability computation, tool execution and provider calls. Trace context
  propagates through BullMQ job data and outbox events.
- Key metrics: `http_server_duration`, `availability_search_duration`,
  `voice_turn_latency_ms` (p50/p95 per provider/region), `provider_request_errors_total`,
  `queue_waiting_jobs`, `queue_job_age_seconds`, `outbox_lag_seconds`,
  `active_media_sessions`, `ai_cost_usd_total`.

### 8.3 Health

`GET /internal/health/live` (process up) and `/internal/health/ready` (Postgres, Redis
reachable; media also checks provider reachability). Used by load balancers.

## 9. Caching

### 9.1 Rules

- **Pattern:** cache-aside through `CacheService`; the database is always the source of
  truth. Never cache data whose staleness could cause a wrong write decision — writes
  always re-validate against Postgres inside the transaction (e.g. availability is cached
  for display, but booking creation re-checks and relies on DB constraints).
- **Key format:** `att:{env}:{namespace}:{scope ids}:v{n}` — e.g.
  `att:prod:loc-settings:{locationId}:v3`. All keys are tenant-qualified.
- **Invalidation:** event-driven. Each cache entry is listed below with the events that
  invalidate it. Invalidation runs in the outbox relay path, so it happens after commit.
- **Version tokens** for families of keys: instead of deleting many keys, bump a counter
  (`att:{env}:ver:avail:{locationId}`) that is part of the key.
- **Stampede protection:** single-flight lock per key (`SET NX PX`) with short wait; jittered
  TTLs (±10%).
- **Serialization:** JSON validated by the contract schema on read; a schema mismatch is
  treated as a miss (safe across deploys).
- **Per-request memoization** (in-process, request-scoped) for values read many times in
  one request (effective settings, permissions).

### 9.2 Cache catalogue

| Namespace | Key scope | Contents | TTL | Invalidated by |
|---|---|---|---|---|
| `session` | session hash | Session subject, realm, version, expiry, CSRF token | session idle timeout | logout, revoke, ban, password change |
| `revoked-sid` | session id | Revocation marker for JWT clients | access token TTL | revoke, ban |
| `perm` | membership id | Resolved permission set + location scope | 10 min | `membership.*`, `role.updated` |
| `org-settings` | organization id | Effective organization settings + entitlements | 10 min | `organization.updated`, `subscription.changed`, `entitlements.changed` |
| `loc-settings` | location id | Effective location settings (incl. capabilities, timezone, locales) | 10 min | `location.updated`, `location.capability_changed`, org settings events |
| `route-endpoint` | phone E.164 / widget key / WA phone id | Channel endpoint → org, location, routing mode, agent id | 1 h | `channel_endpoint.*`, `phone_number.*` |
| `agent-ctx` | agent version id + location id | Compiled agent runtime context: instructions, tool schemas, model profile, location profile | 1 h | `agent.published`, catalogue/schedule/knowledge change events for that location, `model_profile.*` |
| `model-profile` | scope type + id + modality | Resolved model profile id (assignment resolution) | 1 h | `model_profile.*`, `profile_assignment.*` |
| `catalog-public` | location id + locale | Public service list / menu for booking pages and widget | 15 min | `catalog.changed`, `menu.changed`, `location_product.availability_changed` |
| `avail` | location id + service/party + date + avail version | Computed free slots (display only) | 60 s | bump `ver:avail:{locationId}` on `booking.*`, `schedule.changed`, `external_busy.changed` |
| `usage` (counter, not a cache) | organization id + period + meter | Live usage counter for admission control ([billing](docs/features/billing-and-plans.md#voice-minute-metering-and-limits)) | period end + 7 d | reconciled hourly from `usage_records` |
| `feature-flags` | (global) | Flags + overrides | 5 min | `feature_flag.*` |
| `fx`/reference | static | Currency metadata, locale data | 24 h | deploy |

**Not cached:** bookings, orders, payments, conversations, customer PII lookups by
contact point (go to DB with indexes), anything on a write path.

### 9.3 Rate limiting (also Redis)

Sliding-window counters per policy:

| Policy | Limit (default) | Key |
|---|---|---|
| `auth.login` | 10 / 15 min | IP + identifier |
| `auth.otp.send` | 5 / hour, 1 / 30 s | destination; also IP |
| `auth.otp.verify` | 5 attempts per challenge | challenge id |
| `public.write` | 30 / min | IP + widget key |
| `business.default` | 600 / min | user + organization |
| `api-key.default` | per plan entitlement | API key |
| `conversation.start` | per plan entitlement | organization; widget key + IP |

## 10. Background jobs and events

### 10.1 Domain events

- Written to `outbox_events` in the same transaction as the change
  ([data model](docs/data-model/14-system.md#outbox_events)).
- Named `<aggregate>.<past_tense_verb>`; payload schemas versioned in
  `packages/contracts/events` (`{ id, type, version, occurredAt, organizationId, locationId?, actor, data }`).
- The **outbox relay** (worker) reads unpublished rows in order (`FOR UPDATE SKIP LOCKED`),
  enqueues them to the subscribing queues, then marks them published. Woken by
  `LISTEN/NOTIFY`; polls every second as a fallback.
- Consumers are idempotent: they record processed event ids or rely on idempotent writes.

### 10.2 Event catalogue

| Event | Producer | Main consumers |
|---|---|---|
| `organization.created` / `.updated` / `.suspended` | organizations | cache, billing, audit |
| `location.created` / `.updated` / `.capability_changed` | locations | cache, analytics |
| `membership.created` / `.updated` / `.removed` | access | cache, notifications |
| `customer.created`, `customer_profile.updated`, `consent.changed` | customers | notifications (suppression), webhooks-out |
| `schedule.changed`, `resource.changed`, `external_busy.changed` | scheduling / calendar-sync | cache (avail, agent-ctx) |
| `catalog.changed`, `policy.changed` | catalog | cache (catalog-public, agent-ctx) |
| `booking.held`, `.confirmed`, `.rescheduled`, `.cancelled`, `.checked_in`, `.completed`, `.no_show`, `.hold_expired` | bookings | notifications, reminders, calendar-sync, cache (avail), realtime, webhooks-out, analytics |
| `menu.changed`, `location_product.availability_changed` | ordering | cache, realtime |
| `order.placed`, `.accepted`, `.status_changed`, `.cancelled` | ordering | notifications, realtime, webhooks-out, analytics |
| `payment.succeeded`, `.failed`, `.expired`, `refund.succeeded` | payments | bookings/ordering (confirm/expire), notifications, realtime |
| `conversation.started`, `.ended` | conversations | realtime, conversation-post, usage, analytics |
| `handoff.requested`, `.connected`, `.failed`, `.resolved` | handoff | realtime, notifications (staff alert), tasks |
| `task.created`, `.assigned`, `.completed` | tasks | realtime, notifications |
| `agent.published` | agents | cache (agent-ctx) |
| `knowledge_source.updated` | knowledge | knowledge-ingest, cache |
| `model_profile.updated`, `profile_assignment.changed` | providers | cache |
| `subscription.changed`, `entitlements.changed` | billing | cache, notifications |
| `usage.recorded` | billing | usage reporting |
| `integration.connected` / `.disconnected` / `.errored` | integrations | calendar-sync, notifications |
| `notification.status_changed` | notifications | realtime (message status) |

### 10.3 Queues and jobs

| Queue | Jobs | Trigger | Notes |
|---|---|---|---|
| `outbox` | (relay loop, not a BullMQ queue) | NOTIFY / poll | single active leader via advisory lock |
| `notifications` | `send` | events | per-provider concurrency limits; retries with backoff; respects suppression |
| `reminders` | `booking-reminder` | `booking.confirmed/rescheduled` (delayed) | job id `reminder:{bookingId}:{offset}` → replace on reschedule |
| `holds` | `expire-hold`, `expire-draft-order` | delayed at creation | sweeper every minute as safety net |
| `payments` | `expire-payment-link`, `reconcile` | delayed / repeatable | |
| `calendar-sync` | `push-booking`, `pull-busy`, `renew-watch` | events / webhooks / repeatable | per-connection concurrency 1 (ordering) |
| `conversation-post` | `finalize-transcript`, `summarize`, `classify`, `copy-recording` | `conversation.ended` | uses text model profile |
| `knowledge-ingest` | `fetch`, `chunk`, `embed` | `knowledge_source.updated` | |
| `usage` | `record`, `report-to-stripe` | `usage.recorded` / repeatable (hourly) | idempotent by usage record key |
| `billing` | `sync-stripe-object`, `dunning-transition` | Stripe webhooks / repeatable | |
| `realtime` | `fanout` | most events | emits Socket.IO events to org/location rooms |
| `webhooks-out` | `deliver` | events | signed, retries with exponential backoff up to 24 h |
| `maintenance` | `retention-purge`, `partition-maintain`, `idempotency-cleanup`, `session-cleanup` | repeatable (nightly) | platform scope, audited |

**Job conventions:** job data is minimal (ids, not full objects) and includes
`organizationId`, `traceContext`, `requestId`; processors open their own tenant
transaction; default retries 5 with exponential backoff + jitter; poison jobs move to a
dead-letter state with an alert; every processor is idempotent.

### 10.4 Real-time push (dashboards)

Socket.IO namespace `/business`, authenticated with the user session during handshake.
Rooms: `org:{orgId}`, `loc:{locationId}` (joined only if in scope). Server emits small
`{ type, id, locationId }` notifications; clients invalidate the matching React Query
keys and refetch through the REST API (no data duplication over the socket). Live call
monitoring streams transcript deltas to room `conv:{conversationId}`.

## 11. Error handling

### 11.1 Error classes

```
AppError (code, httpStatus, detail, meta)
├── ValidationError        422  validation_failed          (+ fieldErrors)
├── NotFoundError          404  <resource>_not_found
├── ConflictError          409  slot_unavailable | invalid_state_transition | ...
├── PreconditionError      412  version_mismatch
├── ForbiddenError         403  permission_denied | location_out_of_scope
├── UnauthenticatedError   401  session_expired | invalid_credentials
├── RateLimitedError       429  rate_limited
├── EntitlementError       403  plan_limit_reached | capability_not_in_plan
└── ProviderError          502  provider_unavailable (wraps upstream; never leaks upstream body)
```

Domain code throws typed domain errors; application services map them to `AppError`.
Unknown errors become `500 internal_error` with the request id.

### 11.2 Response format (RFC 9457 problem+json)

```json
{
  "type": "https://docs.attendra.com/errors/slot_unavailable",
  "title": "The selected time is no longer available",
  "status": 409,
  "code": "slot_unavailable",
  "detail": "Another booking was confirmed for this resource at 15:00.",
  "requestId": "0192f6c4-...",
  "errors": [{ "path": "startsAt", "code": "conflict", "message": "..." }]
}
```

`code` is stable and documented in `packages/contracts/errors`; clients switch on `code`,
never on `title` or `detail`.

## 12. Configuration and secrets

- Configuration from environment variables only, validated with a Zod schema at boot;
  the process refuses to start on invalid config. Typed `AppConfig` injected via DI.
  Template: [.env.example](.env.example).
- **Provider credentials** are tenant/platform data, not env config: stored in
  `provider_credentials.secret_ciphertext` using **envelope encryption** — a random
  per-record data key encrypts the secret (AES-256-GCM); the data key is encrypted with
  the master key (`ENCRYPTION_MASTER_KEY`, later a KMS key: Azure Key Vault / AWS KMS) and
  stored alongside with its key id. Rotation re-wraps data keys without touching secrets.
- Decrypted secrets live only in process memory for the duration of use (short in-memory
  LRU with TTL ≤ 5 min), never in Redis, logs, traces or API responses.
- Secrets in production come from the host's secret store; `.env` files are for local
  development only.

## 13. Database migrations

- Location: `packages/server/migrations/` (SQL + drizzle-kit `meta/`); applied by
  `pnpm db:migrate` with the owner role, tracked in `drizzle.__drizzle_migrations`. The
  baseline migration creates extensions and default privileges for `attendra_app`.
- drizzle-kit generates SQL from schema changes; generated SQL is reviewed and
  hand-edited where needed (RLS, exclusion constraints, partitions, data migrations).
- Forward-only; each migration is backward compatible with the previous app release:
  **expand** (add nullable column / new table) → deploy → **migrate** (backfill job) →
  **contract** (drop old) in a later release.
- Every new tenant table must include in its migration: `organization_id` + FK, RLS
  enable/force, `tenant_isolation` policy, indexes leading with `organization_id`. A CI
  check fails migrations that create a table in a tenant module without RLS.
- Migrations run as a separate step with the owner role before app rollout.
- Seed scripts: platform plans, system roles, default notification templates, local demo
  tenant (local only).

## 14. Testing

| Level | Scope | Tools | Notes |
|---|---|---|---|
| Unit | Domain logic: availability, state machines, policy evaluation, pricing, settings resolution | Vitest | Pure, fast, no mocks needed; property-based tests (fast-check) for availability and time math |
| Integration | Repositories, RLS, constraints, transactions, outbox, cache invalidation | Vitest + real Postgres/Redis (docker compose or CI services) | One database per test file, cloned from a template migrated once per run (`test/global-setup.ts`, `test/db-per-file.ts`) |
| API e2e | HTTP contract, auth, permissions, tenant isolation, idempotency | Supertest against the Nest app | Every endpoint has an "other tenant gets 404" test |
| Concurrency | Double-booking under parallel requests | Custom harness | N parallel bookings for one slot → exactly 1 succeeds |
| Provider adapters | Twilio/OpenAI/Stripe adapters | Recorded fixtures + contract tests | No live calls in CI |
| Agent evals | Conversation scripts → expected tool calls/outcomes | Scripted text conversations against the runtime | Run on agent runtime or prompt changes |

Coverage targets: domain ≥ 90%, application ≥ 80%. Tests reference requirement IDs in
their names where applicable (`it('FR-SCH-003 rejects overlapping allocations', ...)`).

## 15. Code conventions

- **Naming:** files kebab-case; classes PascalCase; DB snake_case; API camelCase; env
  UPPER_SNAKE; events `aggregate.past_tense`; permissions `resource.action`; queues
  kebab-case.
- **Lint/format:** ESLint (flat config, `typescript-eslint` strict, `eslint-plugin-boundaries`)
  + Prettier; `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` on.
- **Builds:** backend (`packages/server`, `apps/api`, `apps/worker`) compiles with `tsc` to
  CommonJS (Nest decorator metadata); shared packages (`contracts`, `utils`) build ESM + CJS
  with tsdown. Tests run through Vitest + SWC.
- **Test files:** `*.test.ts` unit · `*.int.test.ts` integration · `*.e2e.test.ts` API e2e
  (Vitest projects `unit`, `integration`, `e2e`).
- **Dates:** never `new Date()` in domain code — inject a `Clock`. Time zone math uses
  `temporal-polyfill` (stable 1.x Temporal implementation) behind `kernel/time`.
- **IDs:** UUIDv7 generated in the app (`kernel/ids`), never DB `serial`.
- **No business logic in controllers, guards, or SQL triggers** (triggers only for
  `updated_at` and partition routing if needed).
- **Commits:** Conventional Commits (`feat(bookings): ...`); PRs reference requirement
  IDs.
- **Dependencies:** each new runtime dependency needs a reason in the PR; prefer the
  platform and existing packages.
