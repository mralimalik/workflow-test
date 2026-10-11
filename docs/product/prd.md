# Product Requirements Document — Attendra

| | |
|---|---|
| Product | Attendra — the AI front desk for every business |
| Owner | Product (Ali Malik) |
| Status | Draft v1 — for review |
| Last updated | 2026-10-11 |

Terms are defined in the [glossary](glossary.md). Numbered requirements live in
[requirements.md](requirements.md); this document explains intent.

---

## 1. Problem

Businesses that run on appointments, reservations and orders lose revenue at the front
desk:

- **Missed calls.** Small businesses miss a large share of inbound calls — during busy
  hours, after hours, and while staff are serving customers. Each missed call is often a
  lost booking or order.
- **Repetitive work.** Staff spend hours answering the same questions (hours, prices,
  location, availability) and doing manual data entry into calendars and order systems.
- **Fragmented channels.** Phone, website, messaging apps and walk-ins each live in a
  different tool, so double bookings and lost context are common.
- **Multi-branch complexity.** Chains with several locations need different hours,
  staff, menus and phone numbers per branch, but one view of the business.
- **Customers have no single place** to see and manage what they have booked or ordered.

Existing tools solve slices: scheduling software without an AI agent, voice bots without
a real booking engine, ordering systems without voice. None are industry-agnostic,
multi-location and omnichannel at once.

## 2. Vision

Any business that books time or takes orders can sign up, describe its business in a
dashboard, and within an hour have an AI agent answering its phone and website — booking
correctly into one source of truth, handing off gracefully to humans, and giving every
customer a single account for everything they've booked anywhere on Attendra.

## 3. Goals and non-goals

### Goals

1. **Industry-agnostic by configuration.** No per-customer or per-industry code. Every
   business-specific fact is data entered through the dashboard.
2. **Correct before clever.** The booking and ordering engines are the source of truth
   and can never double-book or lose an order, whichever channel writes to them.
3. **Omnichannel by design.** Phone and web widget at launch; in-app agent; WhatsApp,
   SMS and others added as channel adapters without changing the core.
4. **Multi-location from day one.** Organization → locations with inheritance and
   per-location overrides.
5. **Safe handoff.** The agent knows its limits and always has a path to a human or a
   callback.
6. **One customer identity.** A customer sees all their bookings and orders across every
   business in one app, while each business sees only its own relationship.
7. **Platform control.** Super-admins choose which AI and telephony providers, models
   and deployments serve which plan, organization, location or channel.
8. **Scalable foundation.** Data model and architecture designed for all planned
   capabilities now, built in phases.

### Non-goals (for the foreseeable future)

- Giving medical, legal or financial advice. The agent schedules and informs; it does not
  advise.
- Being a full POS, EHR, PMS or accounting system. We integrate with them.
- Marketplace discovery ("find a barber near me") — the customer app shows businesses the
  customer has a relationship with; public discovery may come later.
- Hotel property management (room inventory, rate plans) is designed for in the data
  model but may ship as a separate product ([features/lodging.md](../features/lodging.md)).

## 4. Users and personas

| Persona | Who | Primary needs |
|---|---|---|
| **Owner / admin** | Business owner or ops lead of an organization | Set up the business, see every location, control the agent, see results and billing |
| **Location manager** | Runs one branch | Manage that branch's calendar, staff, menu availability, handoffs |
| **Staff** | Front desk, stylist, chef, technician | See their schedule or the order queue, take handoffs and callbacks |
| **Customer** | Calls, chats or uses the app | Book, change, cancel, order and pay quickly; see everything in one place |
| **Platform super-admin** | Attendra staff | Manage tenants, plans, providers and models; support and audit |

## 5. Product surfaces

| Surface | Users | Description | Spec |
|---|---|---|---|
| **Voice agent on phone** | Customers | Inbound calls to a number bought from us or forwarded from the business's own number | [channels.md](../features/channels.md), [voice-agent.md](../features/voice-agent.md) |
| **Web widget** | Customers | Embeddable voice + text agent on the business's website | [channels.md](../features/channels.md) |
| **Customer app** | Customers | Web app (PWA; native mobile later): login by phone/email OTP, bookings, orders, profile, talk to any business's agent | [customers.md](../features/customers.md) |
| **Public business pages** | Customers | Per-location booking, reservation and ordering pages | [customers.md](../features/customers.md) |
| **Business dashboard** | Owners, managers, staff | Everything a business configures and operates | [FRONTEND.md](../../FRONTEND.md) |
| **Admin console** | Platform admins | Tenants, plans, providers, model profiles, support tools | [super-admin.md](../features/super-admin.md) |
| **Public REST API + webhooks** | Integrators (later) | Same API the apps use, with API keys | [integrations.md](../features/integrations.md) |

## 6. Capabilities

Each location turns capabilities on independently. All share organizations, locations,
customers, channels, the agent, handoff, notifications and payments.

| Capability | Typical businesses | Phase | Spec |
|---|---|---|---|
| **Inquiries** | Everyone — FAQs, messages, callbacks | 1 | [voice-agent.md](../features/voice-agent.md), [handoff.md](../features/handoff.md) |
| **Appointments** | Clinics, salons, spas, garages, tutors, consultants | 1 | [appointments.md](../features/appointments.md) |
| **Food ordering** | Restaurants, takeaways, cafes | 3 | [food-ordering.md](../features/food-ordering.md) |
| **Table reservations** | Restaurants, bars, hotel restaurants | 3 | [reservations.md](../features/reservations.md) |
| **Lodging** | Hotels, guesthouses | Future / separate product | [lodging.md](../features/lodging.md) |

## 7. Key user journeys

1. **Business onboarding.** Owner signs up → creates organization → adds first location
   (address, timezone, hours) → enables capabilities → adds services/staff or menu →
   configures agent (greeting, languages, tone, handoff number) → gets a phone number or
   sets up forwarding → copies widget snippet → makes a test call → live.
2. **Phone booking.** Customer calls → number identifies the location (or the agent asks
   which branch) → agent answers in the configured language → finds availability →
   places a hold → reads back details → confirms → customer receives SMS confirmation
   with a link to the customer app → booking appears on the dashboard in real time.
3. **Widget booking.** Visitor opens widget → enters phone/email (verified by OTP before
   accessing existing bookings) → talks or types → books → confirmation.
4. **Customer app.** Customer opens link → logs in with phone OTP → sees all bookings and
   orders across businesses → reschedules, cancels, pays, or opens a business and talks
   to its agent already identified.
5. **Handoff.** Agent detects request for a human, an emergency, repeated failure or an
   out-of-scope question → warm transfer to the location's handoff target if available →
   otherwise creates a callback task and notifies staff → customer is told what happens
   next.
6. **Food order (phase 3).** Customer orders by phone → agent builds the cart with
   modifiers → reads back items and total → sends payment link if required → order
   reaches the kitchen queue → customer gets status updates.
7. **Super-admin provider change.** Admin creates a model profile on a new Azure
   deployment → assigns it to the Enterprise plan → new conversations for those
   organizations use it; existing ones finish on the old one.

## 8. Monetization

Two independent money flows ([billing-and-plans.md](../features/billing-and-plans.md),
[payments.md](../features/payments.md)):

1. **Organizations pay Attendra** — Stripe Billing. Monthly or annual subscription priced
   per location, with included usage (AI minutes, messages) and metered overage. Supports
   trials, upgrades/downgrades with proration, scheduled changes at period end, coupons
   and promotion codes, price changes with grandfathering, dunning and suspension.
2. **Customers pay organizations** — Stripe Connect. Deposits, prepayments, no-show and
   cancellation fees, and order payments, as configured by each business's policies.
   Money settles to the business's connected account; Attendra may take an application
   fee.

## 9. Success metrics

| Metric | Definition | Initial target |
|---|---|---|
| Time to live | Signup → first real call answered | < 1 hour median |
| Containment rate | Conversations resolved without handoff | > 70% |
| Booking conversion | Booking-intent conversations that end in a booking | > 60% |
| Double bookings | Overlapping active allocations on one resource | **0** (enforced by DB) |
| Voice latency | Customer stops speaking → first agent audio (p50 / p95) | < 800 ms / < 1500 ms |
| Handoff answer rate | Live transfers answered by a human | > 80% in staffed hours |
| Logo churn | Organizations cancelling per month | < 3% |

## 10. Constraints and assumptions

- Customers and businesses can be anywhere in the world: everything is timezone-, locale-
  and currency-aware ([NFR-I18N](requirements.md#nfr-i18n--internationalization)).
- Businesses configure which languages their agent and pages support.
- Attendra's provider keys are used by default; BYOK is designed for and enabled later.
- Telephony starts with Twilio; the abstraction allows Telnyx and others.
- AI starts with OpenAI Realtime and Azure OpenAI Realtime; the abstraction allows others.
- Regulatory exposure varies by country (call recording consent, SMS/telemarketing rules,
  GDPR, HIPAA for US healthcare). The product provides controls (consent capture,
  retention, recording toggles, data export/delete); each business is responsible for
  configuring them for its jurisdiction.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Wrong answers / hallucinated prices or policies | Agent speaks only from configured data and retrieved knowledge; uncertain → handoff/callback ([voice-agent.md](../features/voice-agent.md#guardrails)) |
| Double booking across channels | DB exclusion constraints + holds ([scheduling-and-availability.md](../features/scheduling-and-availability.md)) |
| Voice latency/quality | Realtime speech-to-speech models, regional deployments, latency metrics per conversation |
| Provider cost growth | Usage metering, per-plan allowances, overage, call duration caps |
| Provider lock-in / outages | Provider abstraction, per-scope model profile assignment, fallback profiles |
| Tenant data leak | Row-level security + tenant-scoped repositories + tests ([BACKEND.md §7](../../BACKEND.md#7-multi-tenancy-and-data-access)) |
| Telecom and messaging compliance | Consent tracking, recording disclosure, opt-out handling, per-country rules |

## 12. Open questions

1. Final plan prices and included allowances (needs provider cost measurements in Phase 2).
2. Whether lodging ships inside Attendra or as a separate product.
3. Which countries to support first for purchased phone numbers (affects regulatory
   bundles in Twilio).
4. Whether public marketplace discovery is ever in scope.
