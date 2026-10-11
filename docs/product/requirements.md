# Requirements

Numbered, testable requirements. Feature documents cite these IDs; tests reference them.
Priority: **M** must (phase it is assigned to), **S** should, **C** could.
Phase numbers refer to [roadmap.md](roadmap.md).

ID format: `FR-<AREA>-<NNN>` (functional), `NFR-<AREA>-<NNN>` (non-functional).

---

## Functional requirements

### FR-AUTH — Authentication and identity
Spec: [features/auth-and-identity.md](../features/auth-and-identity.md)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-AUTH-001 | Users (business staff) sign up and log in with email + password. | M | 0 |
| FR-AUTH-002 | Users can enable TOTP two-factor authentication; organizations can require it. | M | 1 |
| FR-AUTH-003 | Customers log in passwordlessly with a one-time code sent to their phone (SMS, later WhatsApp) or email. | M | 1 |
| FR-AUTH-004 | Customers can optionally add an email and set a password from their profile. Passwords are never sent to customers. | M | 1 |
| FR-AUTH-005 | Platform admins authenticate in a separate realm with mandatory 2FA. | M | 0 |
| FR-AUTH-006 | Any session can be revoked immediately; a user/customer can be banned, which revokes all sessions at once. | M | 0 |
| FR-AUTH-007 | Users and customers can list their active sessions and log out other devices. | S | 1 |
| FR-AUTH-008 | Web apps use server-side sessions in secure cookies; mobile and API clients use short-lived access tokens with rotating refresh tokens. | M | 0 (web), 4 (mobile) |
| FR-AUTH-009 | Users can sign in with Google (OAuth client). | C | 2 |
| FR-AUTH-010 | Password reset and email verification by single-use, expiring links. | M | 0 |
| FR-AUTH-011 | Brute-force protection: rate limits and lockouts on login, OTP and reset endpoints. | M | 0 |

### FR-ORG — Organizations, locations, team and access
Spec: [features/organizations-and-access.md](../features/organizations-and-access.md)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-ORG-001 | A user can create an organization and becomes its owner. A user can belong to many organizations. | M | 0 |
| FR-ORG-002 | An organization has one or more locations, each with its own address, timezone, contact details, hours and settings. | M | 0 |
| FR-ORG-003 | Settings resolve by inheritance: platform → plan → organization → location → capability; any level may override. | M | 0 |
| FR-ORG-004 | Each location enables capabilities independently (appointments, reservations, ordering, inquiries). | M | 0 |
| FR-ORG-005 | Owners invite team members by email with a role and a location scope (all or selected locations). | M | 0 |
| FR-ORG-006 | System roles: owner, admin, manager, staff, viewer. Custom roles from the permission catalogue. | M (system) / S (custom) | 0 / 2 |
| FR-ORG-007 | Every action is authorized by permission and location scope. | M | 0 |
| FR-ORG-008 | Organizations choose supported languages and a default language; locations may narrow them. | M | 1 |
| FR-ORG-009 | Guided onboarding wizard from signup to first test call. | M | 2 |
| FR-ORG-010 | Industry templates prefill services, FAQs and settings; templates are data, not code. | S | 2 |

### FR-CUS — Customers
Spec: [features/customers.md](../features/customers.md)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-CUS-001 | A customer has one global identity keyed by phone and/or email, shared across all organizations. | M | 1 |
| FR-CUS-002 | Each organization holds its own customer profile (notes, tags, history, consents) and never sees the customer's data at other organizations. | M | 1 |
| FR-CUS-003 | After a phone booking, a customer record is created or matched from the caller number, and an SMS confirmation with a link to the customer app is sent. | M | 2 |
| FR-CUS-004 | The widget collects phone and/or email before booking and verifies by OTP before showing or changing existing bookings. | M | 2 |
| FR-CUS-005 | In the customer app, a customer sees all bookings and orders across all organizations, and can view, reschedule, cancel and pay according to each business's policy. | M | 2 |
| FR-CUS-006 | In the customer app, a customer can open a business/location and talk to its agent (voice or text) already identified. | M | 2 |
| FR-CUS-007 | Consent is recorded per customer, per organization, per channel and per purpose (transactional, marketing). | M | 1 |
| FR-CUS-008 | Customers can export their data and request deletion. | M | 3 |
| FR-CUS-009 | Staff can search, view, create, edit, tag and import customer profiles (CSV). | M (view/edit) / S (import) | 1 / 2 |
| FR-CUS-010 | Duplicate customer identities can be merged by verified contact point. | S | 3 |

### FR-SCH — Scheduling and availability (shared engine)
Spec: [features/scheduling-and-availability.md](../features/scheduling-and-availability.md)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-SCH-001 | Schedules define weekly intervals and date exceptions (closures, special hours) and are reused for location hours, staff availability, ordering hours and service periods. | M | 1 |
| FR-SCH-002 | Availability is computed from schedules, existing allocations (with buffers), external busy times, holds, lead time and advance-booking limits. | M | 1 |
| FR-SCH-003 | Two active allocations of the same resource can never overlap; enforced by the database. | M | 1 |
| FR-SCH-004 | A staff member working at several locations can never be double-booked across them. | M | 1 |
| FR-SCH-005 | Holds reserve a slot for a configurable time (default 3 minutes) and expire automatically. | M | 1 |
| FR-SCH-006 | All times are stored in UTC and evaluated in the location's IANA timezone, including DST transitions. | M | 1 |

### FR-APT — Appointments
Spec: [features/appointments.md](../features/appointments.md)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-APT-001 | Organizations manage a service catalogue: categories, services, variants, durations, buffers, prices, descriptions in each supported language. | M | 1 |
| FR-APT-002 | Services are enabled per location with optional price/duration overrides. | M | 1 |
| FR-APT-003 | Services declare resource requirements (e.g. 1 of "Hygienists" + 1 of "Rooms"). | M | 1 |
| FR-APT-004 | Customers can choose a specific staff member or "any available". | M | 1 |
| FR-APT-005 | Bookings can contain multiple services in sequence. | S | 2 |
| FR-APT-006 | Booking lifecycle: held → confirmed → checked in → completed; or cancelled / no-show. Every transition is recorded. | M | 1 |
| FR-APT-007 | Reschedule and cancel from every surface (agent, widget, customer app, dashboard) subject to policy. | M | 1 |
| FR-APT-008 | Intake forms per service; the agent asks the questions and stores answers. | S | 2 |
| FR-APT-009 | Group/class sessions with capacity > 1. | C | 4 |
| FR-APT-010 | Waitlist offering freed slots to waiting customers. | C | 4 |
| FR-APT-011 | Staff can create, move and cancel bookings from the dashboard calendar (manual entry). | M | 1 |

### FR-RES — Table reservations
Spec: [features/reservations.md](../features/reservations.md)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-RES-001 | Locations define dining areas, tables (min/max capacity) and table combinations. | M | 3 |
| FR-RES-002 | Service periods (lunch, dinner) with turn times by party size. | M | 3 |
| FR-RES-003 | Pacing limits (max covers/parties per interval) to protect the kitchen. | M | 3 |
| FR-RES-004 | Automatic table assignment with manual override. | M | 3 |
| FR-RES-005 | Seating preferences, occasions, accessibility notes. | S | 3 |
| FR-RES-006 | Deposit or card guarantee per policy, e.g. for large parties. | S | 3 |

### FR-ORD — Food ordering
Spec: [features/food-ordering.md](../features/food-ordering.md)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-ORD-001 | Organizations manage menus, categories, products and modifier groups with min/max selections. | M | 3 |
| FR-ORD-002 | Menus and products are enabled per location with price overrides, availability schedules and sold-out toggles. | M | 3 |
| FR-ORD-003 | Fulfilment types: pickup, delivery (zones with fees, minimums, ETAs), dine-in. | M | 3 |
| FR-ORD-004 | The agent builds a draft order, reads back items and total, and places it only after confirmation. | M | 3 |
| FR-ORD-005 | Order lifecycle with a live kitchen queue on the dashboard. | M | 3 |
| FR-ORD-006 | Busy mode: add prep time or pause ordering per location. | M | 3 |
| FR-ORD-007 | Allergen and dietary tags; the agent never asserts safety beyond listed data. | M | 3 |
| FR-ORD-008 | Taxes (inclusive/exclusive) by tax category and location. | M | 3 |
| FR-ORD-009 | Promotions and promo codes. | C | 4 |

### FR-PAY — Customer payments
Spec: [features/payments.md](../features/payments.md)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-PAY-001 | Organizations connect a Stripe account (Connect) to receive payments. | M | 3 |
| FR-PAY-002 | Policies decide when payment is required: deposit, full prepayment, card guarantee, no-show fee, cancellation fee. | M | 3 |
| FR-PAY-003 | The agent sends a secure payment link; card details are never spoken to or captured by the agent. | M | 3 |
| FR-PAY-004 | Unpaid holds/orders expire per policy. | M | 3 |
| FR-PAY-005 | Full and partial refunds from the dashboard, with audit. | M | 3 |
| FR-PAY-006 | Attendra can take an application fee per transaction, configured per plan. | S | 3 |

### FR-BIL — Platform billing
Spec: [features/billing-and-plans.md](../features/billing-and-plans.md)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-BIL-001 | Plans with entitlements and monthly/annual prices per location, in multiple currencies. | M | 2 |
| FR-BIL-002 | Free trial without card, convertible to paid. | M | 2 |
| FR-BIL-003 | Upgrades take effect immediately with proration; downgrades are scheduled for period end. | M | 2 |
| FR-BIL-004 | Changing a plan's price creates a new price; existing subscribers are grandfathered or migrated at renewal with notice. | M | 2 |
| FR-BIL-005 | Coupons (percent/amount, once/repeating/forever) and promotion codes with restrictions. | M | 2 |
| FR-BIL-006 | Usage metering (AI minutes, SMS, WhatsApp) with included allowances and overage. | M | 2 |
| FR-BIL-007 | Dunning: failed payments retry; past-due grace period; then restricted access; then suspension. | M | 2 |
| FR-BIL-008 | Billing portal: invoices, payment method, plan change, cancel. | M | 2 |
| FR-BIL-009 | Super-admins can grant custom prices, credits and entitlement overrides (Enterprise). | S | 3 |

### FR-AGT — Agent
Spec: [features/voice-agent.md](../features/voice-agent.md), [features/knowledge-base.md](../features/knowledge-base.md)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-AGT-001 | Each organization has an agent; locations may override it. Configuration: persona, tone, greeting, languages, custom instructions, handoff rules, enabled tools. | M | 1 |
| FR-AGT-002 | Agent configuration is versioned with draft/publish; each conversation records the version used. | M | 1 |
| FR-AGT-003 | Instructions and tools are generated at runtime from the location's data and enabled capabilities — no per-business code. | M | 1 |
| FR-AGT-004 | The agent answers only from configured data and the knowledge base, and says when it does not know. | M | 1 |
| FR-AGT-005 | Businesses manage a knowledge base: FAQ entries, free text, uploaded documents, website URLs. | M (FAQ/text) / S (docs/URLs) | 1 / 2 |
| FR-AGT-006 | The agent speaks and understands the location's supported languages and can switch to the caller's language if supported. | M | 2 |
| FR-AGT-007 | Test console in the dashboard: talk to the draft agent by voice or text before publishing. | M | 1 |
| FR-AGT-008 | After each conversation: transcript, summary, intent, outcome, sentiment. | M | 2 |
| FR-AGT-009 | Super-admins assign model profiles to plan, organization, location or channel endpoint scope; most specific wins. | M | 1 |
| FR-AGT-010 | Provider, model, deployment, endpoint and parameters are configurable without code changes. | M | 1 |

### FR-CHN — Channels
Spec: [features/channels.md](../features/channels.md)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-CHN-001 | Phone: purchase a number through Attendra, or forward the business's existing number to an Attendra number. | M | 2 |
| FR-CHN-002 | Each location can have its own numbers; an organization can also have a central number that routes by asking, by caller history or by proximity. | M | 2 |
| FR-CHN-003 | Recording disclosure and per-location recording on/off. | M | 2 |
| FR-CHN-004 | Web widget (voice + text) embeddable with one script tag; restricted to allowed origins. | M | 2 |
| FR-CHN-005 | In-app agent per location inside the customer app. | M | 2 |
| FR-CHN-006 | WhatsApp channel (text first, calls later) as an adapter on the same conversation model. | S | 4 |
| FR-CHN-007 | SMS conversational channel. | C | 4 |
| FR-CHN-008 | Outbound calls (reminders, confirmations) only to customers with recorded consent. | C | 4 |

### FR-HND — Handoff
Spec: [features/handoff.md](../features/handoff.md)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-HND-001 | Handoff triggers: customer request, emergency keywords, repeated failure, low confidence on critical fields, out of scope, tool/system failure, negative sentiment, business rules. | M | 2 |
| FR-HND-002 | Hard triggers are enforced in code and cannot be overridden by the model. | M | 2 |
| FR-HND-003 | Phone: warm and cold transfer to handoff targets that have their own availability schedules. | M | 2 |
| FR-HND-004 | Web/app: live takeover by staff where available; otherwise callback or message. | S (takeover) / M (callback) | 3 / 2 |
| FR-HND-005 | When no human is available: create a callback task, notify staff, tell the customer what happens next. | M | 2 |
| FR-HND-006 | Each handoff carries a context packet (summary, intent, collected data, sentiment, transcript link). | M | 2 |
| FR-HND-007 | Handoff queue and tasks in the dashboard; metrics by reason. | M | 2 |

### FR-NOT — Notifications
Spec: [features/notifications.md](../features/notifications.md)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-NOT-001 | Transactional messages (confirmation, reminder, change, cancellation, order status, OTP) by SMS and email; WhatsApp and push later. | M | 2 |
| FR-NOT-002 | Templates per event, channel and locale; platform defaults with organization overrides. | M | 2 |
| FR-NOT-003 | Reminders at configurable offsets; rescheduled automatically when bookings change. | M | 2 |
| FR-NOT-004 | Opt-out handling (STOP) and suppression lists honoured on every send. | M | 2 |
| FR-NOT-005 | Staff alerts (new booking, handoff, failed payment) by email, in-app and push. | M | 2 |
| FR-NOT-006 | Delivery status tracked per message. | M | 2 |

### FR-INT — Integrations
Spec: [features/integrations.md](../features/integrations.md)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-INT-001 | Google Calendar: push bookings to a staff/location calendar and read busy times. | M | 2 |
| FR-INT-002 | Microsoft (Outlook) Calendar, same behaviour. | M | 3 |
| FR-INT-003 | Attendra is the source of truth; external systems are mirrors plus busy-time sources. | M | 2 |
| FR-INT-004 | Outbound webhooks for organization events, signed. | S | 4 |
| FR-INT-005 | Public API with organization API keys and scopes. | S | 4 |
| FR-INT-006 | POS integrations (Square, Toast, Clover) through the same connection framework. | C | 4+ |

### FR-ANL — Analytics
Spec: [features/analytics.md](../features/analytics.md)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-ANL-001 | Overview per organization and location: conversations, bookings/orders by channel, containment, handoffs, missed calls recovered. | M | 2 |
| FR-ANL-002 | Usage against plan allowances. | M | 2 |
| FR-ANL-003 | Cross-location comparison. | S | 3 |
| FR-ANL-004 | CSV export. | S | 3 |

### FR-ADM — Platform administration
Spec: [features/super-admin.md](../features/super-admin.md)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-ADM-001 | Manage organizations: view, suspend, reactivate, close. | M | 1 |
| FR-ADM-002 | Manage provider credentials (encrypted), model profiles and their assignments. | M | 1 |
| FR-ADM-003 | Manage plans, prices, entitlements, coupons. | M | 2 |
| FR-ADM-004 | Audited impersonation of a user with a stated reason, visible to the organization. | S | 2 |
| FR-ADM-005 | Feature flags with per-organization overrides. | M | 1 |
| FR-ADM-006 | Platform-wide health and usage dashboards. | S | 2 |
| FR-ADM-007 | Admin roles: super_admin, support, billing, read_only. | M | 1 |

---

## Non-functional requirements

### NFR-SEC — Security

| ID | Requirement |
|---|---|
| NFR-SEC-001 | Tenant isolation enforced in two layers: application scoping and Postgres row-level security. A missing tenant context fails closed. |
| NFR-SEC-002 | Passwords hashed with Argon2id; OTPs and tokens stored only as hashes. |
| NFR-SEC-003 | Provider secrets encrypted at rest with envelope encryption (AES-256-GCM) and key versioning; never returned to any client. |
| NFR-SEC-004 | All inbound webhooks verified by signature (Stripe, Twilio, Meta, Google). |
| NFR-SEC-005 | Cookie sessions: `HttpOnly`, `Secure`, `SameSite=Lax`, plus CSRF protection on state-changing requests. |
| NFR-SEC-006 | Rate limiting per IP, per subject and per organization on sensitive and expensive endpoints. |
| NFR-SEC-007 | Every privileged and data-changing action is written to the audit log. |
| NFR-SEC-008 | The agent never collects card numbers, passwords or OTP codes by voice. |
| NFR-SEC-009 | Dependencies scanned in CI; secrets scanning on every push. |

### NFR-PERF — Performance

| ID | Requirement |
|---|---|
| NFR-PERF-001 | API p95 < 200 ms for reads and < 400 ms for writes, excluding external provider calls. |
| NFR-PERF-002 | Availability search p95 < 300 ms for a 14-day window at one location. |
| NFR-PERF-003 | Voice turn latency p50 < 800 ms, p95 < 1500 ms (end of customer speech → first agent audio). |
| NFR-PERF-004 | Incoming-call routing (number → endpoint → agent config) < 50 ms from cache. |
| NFR-PERF-005 | Dashboard reflects new bookings/orders within 2 s (real-time push). |

### NFR-AVAIL — Availability and reliability

| ID | Requirement |
|---|---|
| NFR-AVAIL-001 | 99.9% monthly availability target for API and voice ingress. |
| NFR-AVAIL-002 | If the agent or a dependency fails mid-call, the call falls back to handoff or message-taking — it is never silently dropped. |
| NFR-AVAIL-003 | All writes that trigger side effects use the transactional outbox; no lost or duplicated notifications. |
| NFR-AVAIL-004 | All externally triggered writes are idempotent (idempotency keys, inbound webhook de-duplication). |
| NFR-AVAIL-005 | Daily backups with point-in-time recovery; restore tested quarterly. |

### NFR-SCALE — Scalability

| ID | Requirement |
|---|---|
| NFR-SCALE-001 | API, worker and media processes are stateless and horizontally scalable. |
| NFR-SCALE-002 | High-volume tables (messages, conversation events, audit logs, notifications, usage records) are partitioned by time. |
| NFR-SCALE-003 | Design target: 10k organizations, 50k locations, 1M customers, 100k conversations/day without schema change. |
| NFR-SCALE-004 | New capabilities, channels and providers are added as modules/adapters without changing existing schemas. |

### NFR-I18N — Internationalization

| ID | Requirement |
|---|---|
| NFR-I18N-001 | All timestamps stored in UTC; every location has an IANA timezone. |
| NFR-I18N-002 | Money stored as integer minor units with ISO 4217 currency. |
| NFR-I18N-003 | Business content (service names, menu items, FAQs, templates) translatable per supported locale with fallback to the default locale. |
| NFR-I18N-004 | UI of all apps is translatable; locale-aware formatting of dates, numbers, currency. |
| NFR-I18N-005 | Phone numbers stored in E.164. |

### NFR-OBS — Observability

| ID | Requirement |
|---|---|
| NFR-OBS-001 | Structured JSON logs with request id, trace id, organization, location, actor and conversation id; secrets and PII redacted. |
| NFR-OBS-002 | Distributed tracing across api, worker and media (OpenTelemetry). |
| NFR-OBS-003 | Metrics: request rates/latency/errors, queue depth and age, voice latency, provider errors and cost. |
| NFR-OBS-004 | Error tracking with release and environment tags. |

### NFR-PRIV — Privacy and compliance

| ID | Requirement |
|---|---|
| NFR-PRIV-001 | Data export and deletion per customer (GDPR/CCPA); deletion anonymizes transactional records rather than breaking them. |
| NFR-PRIV-002 | Configurable retention for recordings, transcripts and messages per organization, with platform maximums. |
| NFR-PRIV-003 | Consent evidence stored for marketing messages and call recording. |
| NFR-PRIV-004 | Data minimization: the agent collects only fields required by the configured flow. |

### NFR-MAINT — Maintainability

| ID | Requirement |
|---|---|
| NFR-MAINT-001 | TypeScript strict mode everywhere; shared contracts are the single source of truth for API shapes. |
| NFR-MAINT-002 | Backend modules own their tables; cross-module access goes through module services or events, never direct table access. |
| NFR-MAINT-003 | Frontend features expose a public API (`index.ts`); deep imports across features are lint errors. |
| NFR-MAINT-004 | Migrations are forward-only, reviewed SQL, and backward compatible with the previous release (expand → migrate → contract). |
| NFR-MAINT-005 | Test pyramid: unit (domain), integration (real Postgres/Redis), API e2e, web e2e for critical journeys. |
