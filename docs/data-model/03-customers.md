# 03 · Customers

The organization-side view of a customer, plus contact data and consent. The global
identity itself is [`customers`](01-identity-and-auth.md#customers). Behaviour:
[features/customers.md](../features/customers.md). Conventions: [README §1](README.md#1-conventions).

```
customers (global) ──< customer_profiles >── organizations      (one profile per org)
customers ──< customer_addresses
customers ──< consents >── organizations
```

Visibility rules:
- A business reads `customer_profiles` (RLS by organization) and, through it, only the
  identity fields of `customers` it needs (name, phone, email, locale). It never reads a
  customer's other profiles, bookings or orders at other organizations.
- A customer reads their own `customers`, `customer_addresses`, `consents` and every
  `bookings`/`orders` row with their `customer_id` (customer RLS policy).

---

## customer_profiles

**[base] [tenant] [meta]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `customer_id` | uuid | no | | FK → `customers` |
| `display_name` | text | yes | | how this business refers to the customer; null → identity name |
| `notes` | text | yes | | internal notes (staff only, never shown to the customer or agent unless `agent_visible_notes`) |
| `agent_visible_notes` | text | yes | | short notes the agent may use ("prefers Dr. Lee") |
| `tags` | text[] | no | `'{}'` | GIN index |
| `status` | text | no | `'active'` | `active` \| `blocked` (business refuses bookings from this customer) |
| `blocked_reason` | text | yes | | |
| `preferred_location_id` | uuid | yes | | composite FK → `locations` |
| `preferred_staff_member_id` | uuid | yes | | FK → `staff_members` |
| `preferred_locale` | text | yes | | per-business override |
| `source` | text | no | | first touch: `voice_pstn` \| `web_widget` \| `in_app` \| `whatsapp` \| `dashboard` \| `import` \| `api` |
| `external_ref` | text | yes | | id in the business's own system |
| `custom_fields` | jsonb | no | `'{}'` | organization-defined fields (schema in organization settings) |
| `first_seen_at` | timestamptz | no | `now()` | |
| `last_seen_at` | timestamptz | yes | | last conversation/booking/order |
| `stats` | jsonb | no | `'{}'` | denormalized counters updated by events: `{ bookings, noShows, cancellations, orders, lifetimeSpendMinor, currency }` |

UNIQUE `(organization_id, customer_id)`. Indexes: `(organization_id, last_seen_at DESC)`,
GIN `(tags)`, trigram index on `display_name` for search (via a search view joining
identity name/phone/email — implemented in the customers repository).

## customer_addresses

Delivery addresses, owned by the customer (global, reused across businesses).
Customer-scoped RLS. **[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `customer_id` | uuid | no | | FK → `customers` ON DELETE CASCADE |
| `label` | text | yes | | "Home", "Work" |
| `line1` | text | no | | |
| `line2` | text | yes | | |
| `city` | text | no | | |
| `region` | text | yes | | |
| `postal_code` | text | yes | | |
| `country` | char(2) | no | | |
| `latitude` | numeric(9,6) | yes | | |
| `longitude` | numeric(9,6) | yes | | |
| `instructions` | text | yes | | "gate code 1234" |
| `is_default` | boolean | no | `false` | at most one default per customer (partial unique) |
| `deleted_at` | timestamptz | yes | | **[soft]** — orders keep address snapshots |

## consents

Consent per customer, per organization (or platform), per channel and purpose
([FR-CUS-007](../product/requirements.md#fr-cus--customers), [NFR-PRIV-003](../product/requirements.md#nfr-priv--privacy-and-compliance)).
Rows are append-only: a change inserts a new row; the latest row per key is current.
**[base-append]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organization_id` | uuid | yes | | null = platform-level (e.g. Attendra account emails) |
| `customer_id` | uuid | no | | FK → `customers` |
| `channel` | text | no | | `sms` \| `email` \| `whatsapp` \| `voice` \| `push` |
| `purpose` | text | no | | `transactional` \| `marketing` \| `call_recording` |
| `status` | text | no | | `granted` \| `revoked` |
| `source` | text | no | | `widget_checkbox` \| `voice_verbal` \| `stop_keyword` \| `customer_app` \| `dashboard` \| `import` \| `api` |
| `evidence` | jsonb | no | `'{}'` | e.g. `{ conversationId, messageId, text, ip }` |
| `captured_by_type` | text | no | | **[actor]** |
| `captured_by_id` | uuid | yes | | |

Index: `(customer_id, organization_id, channel, purpose, created_at DESC)`.
A view `current_consents` exposes the latest row per key. Suppression lists for sending
derive from it ([12](12-notifications.md)).

Transactional messages about a customer's own booking/order are allowed without explicit
consent in most jurisdictions but are still suppressed after a `revoked` row for that
channel (e.g. after STOP).
