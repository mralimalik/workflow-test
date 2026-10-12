# Glossary

The single definition of every shared term. Other documents use these words with exactly
these meanings.

## Parties

| Term | Definition |
|---|---|
| **Platform** | Attendra itself — the operator of the SaaS. |
| **Platform admin** | An Attendra employee using the admin console (super-admin, support, billing, read-only). Separate identity from everyone else. |
| **Organization** (tenant) | A business that subscribes to Attendra, e.g. "SmileCare Dental". The unit of billing and data isolation. |
| **Location** | A physical or logical branch of an organization (clinic, store, restaurant, outlet). Has its own timezone, hours, staff, numbers and settings. Every organization has at least one. |
| **User** | A person who logs in to the business dashboard. Global identity; joins organizations through memberships. |
| **Membership** | A user's access to one organization: a role plus a location scope. |
| **Staff member** | A person who delivers services (stylist, dentist, mechanic). May or may not be a user. |
| **Customer** | An end customer: a person who books, reserves or orders. One **global** identity across the whole platform, keyed by verified phone and/or email. |
| **Customer profile** | What one organization knows about one customer (notes, tags, history, consents). One per customer per organization. The organization never sees the customer's activity at other organizations. |

## Commerce

| Term | Definition |
|---|---|
| **Capability** | A kind of transaction a location can accept: `appointments`, `reservations`, `ordering`, `inquiries`, later `lodging`. Enabled per location. |
| **Service** | Something bookable as an appointment (Haircut 30 min, Cleaning 45 min). Defined at organization level; enabled and optionally overridden per location. |
| **Resource** | Anything whose time is allocated by a booking: a staff member at a location, a room, a chair, a table, a bay, equipment. |
| **Resource group** | A named set of interchangeable resources ("Hygienists", "Patio tables"). Used for "any available" and for dining areas. |
| **Booking** | A time-based commitment: an appointment, a table reservation, or (future) a stay. One table, `bookings`, with a `kind`. |
| **Hold** | A booking in status `held` with a short expiry. Reserves resources while a customer or agent is confirming details. |
| **Allocation** | The assignment of one resource to a booking for a time range. The unit of double-booking protection. |
| **Order** | A purchase of products (food ordering): items, modifiers, fulfilment (pickup/delivery/dine-in), payment. |
| **Draft order** | An order in status `draft` — the cart while the customer or agent is building it. |
| **Policy** | A reusable, versioned rule set: cancellation, deposit, prepayment, no-show. Snapshotted onto each booking/order at creation. |
| **Schedule** | A reusable set of weekly intervals plus date exceptions (opening hours, staff availability, ordering hours, service periods). |

## Conversations

| Term | Definition |
|---|---|
| **Channel** | A medium through which a conversation happens: `voice_pstn` (phone), `web_widget`, `in_app`, later `whatsapp`, `sms`. |
| **Channel endpoint** | A concrete address on a channel that belongs to an organization: a phone number, a widget installation, a WhatsApp business number, a location's in-app entry. |
| **Conversation** | One interaction between a customer and the organization on one channel, from start to end, regardless of modality (voice or text). |
| **Media session** | A real-time audio session inside a conversation (a phone call leg, a WebRTC session). |
| **Agent** | An organization's (or location's) AI configuration: persona, greeting, languages, instructions, handoff rules, knowledge. Versioned. |
| **Agent runtime** | The server-side component that runs an agent for a live conversation: builds instructions and tools, executes tool calls, enforces guardrails. |
| **Tool** | A function the agent can call (`check_availability`, `place_order`, `transfer_to_human`). Defined in code, enabled by capability. |
| **Handoff** | Moving a conversation from the agent to a human: warm transfer, cold transfer, live takeover, callback, or channel switch. |
| **Task** | A follow-up item for staff (e.g. a callback created by a failed handoff). |

## Providers

| Term | Definition |
|---|---|
| **Provider** | An external service we integrate: OpenAI, Azure OpenAI, Twilio, Stripe, Google, Microsoft, etc. |
| **Provider credential** | Encrypted credentials plus non-secret config (endpoint, deployment, region) for a provider. Platform-owned by default; organization-owned for BYOK. |
| **Model profile** | A named AI configuration (provider credential + model/deployment + voice + parameters) that super-admins assign to plans, organizations, locations or channel endpoints. |
| **BYOK** | "Bring your own key" — an organization supplies its own provider credentials. Supported by the model; enabled later. |

## Billing

| Term | Definition |
|---|---|
| **Plan** | A product tier (Starter, Growth, Enterprise) with entitlements and prices. |
| **Entitlement** | A limit or feature flag granted by a plan (max locations, included minutes, capabilities allowed). |
| **Usage meter** | Something we bill by usage: AI voice minutes, SMS segments, WhatsApp conversations. |
| **Subscription** | An organization's active plan in Stripe Billing, mirrored locally. |

## Engineering

| Term | Definition |
|---|---|
| **Tenant scope** | The `organization_id` that every tenant-owned row carries and every request is bound to. Enforced by row-level security. |
| **Effective settings** | Settings after inheritance is resolved: platform default → plan → organization → location → capability. |
| **Outbox** | The `outbox_events` table: domain events written in the same transaction as the change, then published to queues. |
| **Reference code** | A short, human-friendly, non-sequential identifier for bookings and orders (e.g. `BK-7F3K2Q`) that can be read out on a phone call. |
