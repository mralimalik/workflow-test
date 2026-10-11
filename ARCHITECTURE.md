# Architecture

System-level architecture of Attendra. Backend internals are in [BACKEND.md](BACKEND.md),
frontend internals in [FRONTEND.md](FRONTEND.md), persistence in
[docs/data-model](docs/data-model/README.md). Decisions and their reasons are in
[docs/adr](docs/adr/README.md).

---

## 1. Principles

1. **Configuration, not code.** No business- or industry-specific code paths. Agent
   instructions, tools, catalogue, hours and rules are derived from tenant data at runtime.
2. **One source of truth.** Every booking, order and payment is written through one
   domain service, whichever channel or app initiates it. External systems are mirrors.
3. **Correctness in the database.** Invariants that must never break (no overlapping
   allocations, tenant isolation, unique reference codes, idempotency) are enforced by
   Postgres constraints and row-level security, not only by application code.
4. **Channels and providers are adapters.** The conversation model and agent runtime do
   not know whether audio came from Twilio, WebRTC or WhatsApp, or whether the model is
   OpenAI or Azure.
5. **Modular monolith first.** One deployable backend codebase split into modules with
   strict boundaries, run as several process types. Modules can be extracted into
   services later if scale demands it ([ADR-0002](docs/adr/0002-modular-monolith-nestjs.md)).
6. **Asynchronous side effects.** Notifications, sync, usage reporting and analytics run
   from events published through the transactional outbox, never inline in the request.
7. **API-first.** Every app — dashboard, admin, customer web, widget, future mobile —
   uses the same versioned REST API defined by shared contracts.

## 2. System context

```
                     ┌──────────────────────── Customers ────────────────────────┐
                     │  Phone (PSTN)   Website widget   Customer app (web/mobile)  │
                     └──────┬──────────────┬──────────────────┬───────────────────┘
                            │              │                  │
                 ┌──────────▼───┐   ┌──────▼──────┐    ┌──────▼───────┐
                 │   Twilio     │   │  WebRTC     │    │  HTTPS       │
                 │ (telephony)  │   │ (realtime)  │    │  REST + WS   │
                 └──────┬───────┘   └──────┬──────┘    └──────┬───────┘
                        │                  │                  │
┌───────────────────────▼──────────────────▼──────────────────▼────────────────────────┐
│                                    ATTENDRA                                            │
│                                                                                        │
│   media gateway  ◄──►  agent runtime  ◄──►  domain modules (api)  ◄──► worker          │
│        │                     │                    │                       │            │
│        └────────► AI provider (OpenAI / Azure OpenAI Realtime)            │            │
│                                                   │                       │            │
│                               PostgreSQL ◄────────┴───────► Redis ◄───────┘            │
│                                                   │                                    │
│                                            Object storage                              │
└───────────────────────────────────────────────────┬────────────────────────────────────┘
        ▲                ▲                           │
        │                │                           ▼
 Business dashboard   Admin console      Stripe · SMS/email · Google/Microsoft · WhatsApp
 (owners, staff)      (platform admins)
```

## 3. Applications and processes

| App | Tech | Process type | Responsibility |
|---|---|---|---|
| `apps/api` | NestJS (Express adapter) | HTTP + WebSocket | REST API for all audiences, inbound webhooks, real-time push to dashboards, agent tool execution endpoint |
| `apps/worker` | NestJS (standalone) | Queue consumers + schedulers | Outbox relay, notifications, reminders, calendar sync, usage reporting, summaries/embeddings, retention, hold expiry |
| `apps/media` | Node (ws) | Long-lived WebSockets | Bridges telephony media streams (and, where needed, browser audio) to the realtime AI provider; runs the agent runtime for each live session |
| `apps/dashboard` | Vite + React | Static SPA | Business dashboard |
| `apps/admin` | Vite + React | Static SPA | Platform admin console |
| `apps/customer` | Next.js (App Router) | Node SSR + static | Customer app and public location pages; renders only, no business logic |
| `apps/widget` | Preact | Static bundle on CDN | Embeddable widget; isolated with Shadow DOM |

`api`, `worker` and `media` share one codebase of domain modules ([BACKEND.md §3](BACKEND.md#3-module-architecture));
each process boots only the modules it needs. All three are stateless and scale
horizontally ([NFR-SCALE-001](docs/product/requirements.md#nfr-scale--scalability)).

## 4. Bounded contexts

Modules group into bounded contexts. Each module owns its tables; the table→module map
is in the [table catalogue](docs/data-model/README.md#3-table-catalogue).

| Context | Modules | Data model |
|---|---|---|
| Identity | `auth`, `users`, `platform-admins` | [01](docs/data-model/01-identity-and-auth.md) |
| Tenancy & access | `organizations`, `locations`, `access` (roles, memberships, invitations), `api-keys` | [02](docs/data-model/02-tenancy-and-access.md) |
| Customers | `customers` | [03](docs/data-model/03-customers.md) |
| Scheduling | `scheduling` (schedules, resources, availability) | [04](docs/data-model/04-scheduling-and-resources.md) |
| Catalogue | `catalog` (services, policies, forms, taxes) | [05](docs/data-model/05-catalog-and-policies.md) |
| Bookings | `bookings` (appointments, reservations; later stays) | [06](docs/data-model/06-bookings.md) |
| Ordering | `ordering` | [07](docs/data-model/07-ordering.md) |
| Payments | `payments` (customer → business) | [08](docs/data-model/08-payments.md) |
| Billing | `billing` (business → Attendra) | [09](docs/data-model/09-platform-billing.md) |
| Conversations | `channels`, `conversations`, `handoff`, `tasks` | [10](docs/data-model/10-channels-and-conversations.md) |
| Agents & AI | `providers`, `agents`, `knowledge`, `agent-runtime` | [11](docs/data-model/11-agents-and-ai.md) |
| Notifications | `notifications` | [12](docs/data-model/12-notifications.md) |
| Integrations | `integrations`, `calendar-sync`, `webhooks-out` | [13](docs/data-model/13-integrations.md) |
| Platform | `audit`, `outbox`, `idempotency`, `files`, `feature-flags`, `inbound-webhooks` | [14](docs/data-model/14-system.md) |

**Dependency direction.** Transactional contexts (bookings, ordering) depend on reference
contexts (tenancy, customers, scheduling, catalogue) through their public services.
Reference contexts never call transactional ones. Conversations and agents call
transactional contexts only through the tool layer. Downstream reactions (notifications,
sync, analytics, billing usage) subscribe to events and are never called directly.

```
            tenancy ◄── customers ◄── scheduling ◄── catalogue
               ▲            ▲             ▲              ▲
               └────────────┴──── bookings / ordering ───┘
                                     ▲         │ events
                       agent-runtime ┘         ▼
                    (tools)            notifications · integrations · billing usage · analytics
```

## 5. Multi-tenancy

- **Model:** shared database, shared schema; every tenant-owned row carries
  `organization_id`; location-scoped rows also carry `location_id`
  ([ADR-0004](docs/adr/0004-shared-schema-rls-tenancy.md)).
- **Enforcement layer 1 — application:** every request resolves an organization context
  (from the URL for business APIs, from the session for customer APIs, from the channel
  endpoint for conversations). Repositories require that context.
- **Enforcement layer 2 — database:** Postgres row-level security policies compare
  `organization_id` with a transaction-local setting. The runtime database role cannot
  bypass RLS. Missing context returns no rows (fails closed).
- **Location scope:** permissions are checked against the membership's location scope in
  the application layer ([BACKEND.md §6](BACKEND.md#6-authentication-and-authorization)).
- **Global entities:** platform admins, users, customers, plans and provider credentials
  owned by the platform are not tenant-scoped; access to them goes through dedicated
  modules with their own rules.
- **Customer cross-tenant view:** the customer API reads the customer's own bookings and
  orders across organizations using a customer-scoped RLS policy (`customer_id` = session
  customer) — never by disabling RLS.

Details: [BACKEND.md §7](BACKEND.md#7-multi-tenancy-and-data-access).

## 6. Conversation and voice architecture

### 6.1 Layers

```
 Channel adapters      voice_pstn (Twilio) · web_widget · in_app · whatsapp* · sms*
        │              normalize inbound events, deliver outbound, map provider ids
        ▼
 Conversation service  create/resolve conversation, identify customer and location,
        │              persist messages/transcripts, lifecycle, recording metadata
        ▼
 Agent runtime         load published agent version + effective settings + context,
        │              build instructions and tool set, run the session, execute tools,
        │              enforce guardrails and handoff rules, emit trace events
        ▼
 Provider adapters     RealtimeVoiceProvider: OpenAI Realtime, Azure OpenAI Realtime
                       TextModelProvider:     OpenAI, Azure OpenAI (chat, summaries)
                       EmbeddingProvider:     OpenAI, Azure OpenAI
                       TelephonyProvider:     Twilio (Telnyx later)
```
`*` later phases. Each provider adapter implements a narrow interface defined in the
`providers` module; credentials and parameters come from the resolved model profile
([features/voice-agent.md](docs/features/voice-agent.md#provider-resolution)).

### 6.2 Inbound phone call

```
Caller ──PSTN──► Twilio ──HTTP webhook──► api: POST /v1/webhooks/twilio/voice
                                            │ verify signature, look up phone number →
                                            │ channel endpoint → organization/location
                                            │ (cached, NFR-PERF-004), create conversation +
                                            │ media session, mint one-time stream token
                                            ▼
                                 returns TwiML <Connect><Stream url=media/...?token>
Twilio ──WebSocket (μ-law 8 kHz audio)──► media gateway
                                            │ validate token, load agent runtime context
                                            ▼
                                 media ──WebSocket──► AI realtime provider
                                            │  audio both ways; provider emits tool calls
                                            ▼
                                 agent runtime executes tools via domain services
                                 (in-process module calls inside the media app),
                                 streams results back to the provider
```

- **Barge-in:** when the provider detects caller speech, the gateway clears Twilio's
  outbound audio buffer immediately.
- **Transfer:** the handoff module asks the telephony adapter to redirect the call
  (warm: dial target, play summary, bridge; cold: redirect). The media session ends with
  reason `transferred`.
- **Recording:** Twilio dual-channel recording when enabled for the location; the file
  is copied to our object storage by a worker job and linked in `files`.
- **Failure:** if the provider connection fails or latency exceeds a threshold, the
  gateway plays a fallback prompt and routes to handoff or voicemail-style message
  capture ([NFR-AVAIL-002](docs/product/requirements.md#nfr-avail--availability-and-reliability)).

### 6.3 Web widget and in-app voice

```
Browser ──POST /v1/public/conversations (widget key / app session)──► api
                                  │ creates conversation, resolves model profile,
                                  │ requests an ephemeral client secret from the provider
                                  │ with instructions + tools already configured
                                  ▼
Browser ──WebRTC audio──► AI realtime provider
                                  │ tool call events
                                  ▼
media (server-side control channel to the same provider session) → agent runtime → tools
```

- Audio goes browser ↔ provider directly over WebRTC for the lowest latency.
- **Tools are never executed in the browser.** The server keeps a control (sideband)
  connection to the same provider session and executes tool calls server-side. If a
  provider does not support a server control channel, the browser connects to the media
  gateway instead and the gateway relays audio (same code path as phone).
- Text mode in the widget uses the same conversation and agent runtime through the REST
  API with streamed responses (SSE).

### 6.4 Agent runtime per turn

1. Context loaded once per conversation (cached): published agent version, effective
   settings, location profile, enabled capabilities, tool set, model profile, customer
   identity if known.
2. Instructions are composed from templates + data
   ([features/voice-agent.md](docs/features/voice-agent.md#instruction-composition)).
3. Tool calls are validated against contracts, authorized against the conversation's
   tenant/location/customer context, executed through domain services, and recorded as
   `conversation_events`.
4. The handoff rules engine observes every turn (counters, keywords, confidence,
   sentiment) and can force a handoff regardless of the model
   ([FR-HND-002](docs/product/requirements.md#fr-hnd--handoff)).
5. On end: transcript is finalized; a worker job produces summary, intent, outcome and
   sentiment; usage is recorded for billing.

## 7. Events, queues and real-time

```
 domain write ──same transaction──► outbox_events
                                        │ relay (worker, LISTEN/NOTIFY + polling fallback)
                                        ▼
                               BullMQ queues (Redis)
            ┌───────────────┬──────────┼─────────────┬───────────────┬──────────────┐
      notifications   calendar-sync   usage   conversation-post   realtime-fanout   webhooks-out
                                                                        │
                                                         Socket.IO (api, Redis adapter)
                                                                        ▼
                                                    dashboards: invalidate React Query caches
```

- Event names, payload contracts, queue names and consumers are catalogued in
  [BACKEND.md §10](BACKEND.md#10-background-jobs-and-events).
- Delivery is at-least-once; every consumer is idempotent.
- Delayed jobs (reminders, hold expiry, payment link expiry) are BullMQ delayed jobs
  keyed by entity id, so rescheduling replaces rather than duplicates them; a periodic
  sweeper reconciles from Postgres as a safety net.

## 8. Data stores

| Store | Used for | Notes |
|---|---|---|
| PostgreSQL 17 | All system-of-record data, RLS, exclusion constraints, embeddings (pgvector) | Primary + read replica later; time-partitioned high-volume tables |
| Redis — cache | Cache-aside data, sessions, rate limits, locks, Socket.IO adapter | `allkeys-lru` in production |
| Redis — queue | BullMQ | `noeviction`, AOF persistence; separate instance in production ([ADR-0008](docs/adr/0008-redis-and-bullmq.md)) |
| Object storage | Recordings, uploads, knowledge documents, exports | S3-compatible or Azure Blob behind a `StorageProvider` interface; private, signed URLs |

## 9. Security architecture

- **Identity realms:** users, customers and platform admins authenticate separately with
  separate session audiences; a session for one realm is never accepted by another
  ([features/auth-and-identity.md](docs/features/auth-and-identity.md)).
- **Secrets:** provider credentials are envelope-encrypted; decryption happens only in
  backend processes that need them; never logged or returned
  ([BACKEND.md §12](BACKEND.md#12-configuration-and-secrets)).
- **Ingress:** CORS allowlists per app; widget endpoints additionally check the
  endpoint's allowed origins; webhooks verified by signature.
- **Least privilege:** runtime DB role without RLS bypass; migration role used only by
  the migration job.
- **Audit:** all privileged actions, including admin impersonation, are audited and
  visible to the organization where appropriate.

## 10. Deployment topology (target)

Containerization comes later; the processes are designed for it. Target topology:

```
   CDN ── dashboard, admin, widget (static)
   Load balancer ── api (N)  ── customer (Next.js, N)
   Load balancer (WebSocket, sticky not required) ── media (N, autoscaled by active sessions)
   worker (N, autoscaled by queue depth)
   Postgres (managed, PITR)   Redis cache (managed)   Redis queue (managed)   Object storage
```

Initial hosting may be a single Azure VM or Railway; nothing in the design depends on a
specific host. Media processes should run in regions close to the AI provider deployment
to minimize latency.

## 11. Scaling path

| Pressure | Response (in order) |
|---|---|
| API load | Horizontal `api` replicas → read replica for read-heavy queries → cache more |
| Voice concurrency | Horizontal `media` replicas, region placement next to provider endpoints |
| Queue backlog | More `worker` replicas; split queues onto dedicated worker pools |
| Table growth | Time partitioning (already designed), archiving to cold storage |
| A module becomes hot | Extract it into a service behind the same contracts and events |
| Very large tenants | Dedicated database for a tenant (the tenant boundary already exists in every row) |
