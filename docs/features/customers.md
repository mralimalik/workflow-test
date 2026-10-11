# Customers

## Purpose

Give every end customer one global Attendra identity that works across all businesses,
while each business keeps its own private relationship (profile, notes, consent) — and
give customers one app to see and manage everything.

## Scope

- **In:** global identity, per-organization profiles, matching from phone/widget/app,
  consent, customer list/detail in the dashboard, CSV import, customer app (web/PWA),
  public location pages, data export/deletion (Phase 3), identity merge (Phase 3).
- **Out:** marketplace discovery of new businesses; loyalty programs (later).

## Concepts

- **Customer** (global) vs **customer profile** (per organization) — [glossary](../product/glossary.md).
- **Identity assurance** of a conversation — [voice-agent](voice-agent.md#identity-and-verification).

## Business rules

1. Matching order when a customer contacts a business: logged-in session → verified
   contact point → unverified caller ID (E.164 exact match) → new customer.
2. A profile is created the first time a customer interacts with an organization
   (conversation with identification, booking, order, import).
3. Businesses see: profile fields + identity name, phone, email, locale. Never the
   customer's other profiles, bookings or orders.
4. Customers see in the app: all their bookings and orders across organizations, the
   businesses they've interacted with, and their consents per business.
5. Available actions on a booking/order in the customer app come from the API's
   `allowedActions` (computed from the business's policy and the item state) — never
   decided client-side.
6. Blocked profile (`status = blocked`): the agent and public pages do not offer booking;
   the agent says the business asks them to call during opening hours (handoff/callback).
7. CSV import creates or matches identities by phone/email; imported contact points are
   **not** marked verified; import requires a consent-basis declaration.
8. Data export: JSON + CSV of identity, profiles, bookings, orders, consents; produced
   asynchronously and delivered by an expiring link.
9. Deletion: identity anonymized (`anonymized_at`), sessions revoked, addresses deleted,
   profiles anonymized; bookings/orders/payments keep non-personal data for business
   records and legal retention ([NFR-PRIV-001](../product/requirements.md#nfr-priv--privacy-and-compliance)).

## Flows

### Customer app home

```
GET /me/home → upcoming bookings + active orders across all orgs (customer RLS policy),
               grouped by business; recent businesses; pending payments
```

### Talk to a business from the app ([FR-CUS-006](../product/requirements.md#fr-cus--customers))

The app opens the location's `in_app` channel endpoint; the conversation starts with
`identity_assurance = session` and the customer's profile, so the agent can act on
existing bookings without further verification.

### Public location page

`/{orgSlug}/{locationSlug}` (Next.js, SSR, cached): name, address, hours, services or
menu, "Book", "Reserve", "Order", "Talk to us". Booking from the public page requires OTP
before confirmation.

## Data

[`customers`](../data-model/01-identity-and-auth.md#customers),
[`customer_profiles`](../data-model/03-customers.md#customer_profiles),
[`customer_addresses`](../data-model/03-customers.md#customer_addresses),
[`consents`](../data-model/03-customers.md#consents).

## API

Business audience:

| Method | Path | Permission |
|---|---|---|
| GET | `/orgs/{orgId}/customers?q=&tag=&locationId=` | `customers.read` |
| POST | `/orgs/{orgId}/customers` | `customers.manage` (create identity+profile from phone/email) |
| GET · PATCH | `/orgs/{orgId}/customers/{profileId}` | `customers.read` · `customers.manage` |
| GET | `/orgs/{orgId}/customers/{profileId}/timeline` | `customers.read` (bookings, orders, conversations at this org) |
| GET · POST | `/orgs/{orgId}/customers/{profileId}/consents` | `customers.read` · `customers.manage` |
| POST | `/orgs/{orgId}/customers/imports` | `customers.import` (async, `202`) |
| GET | `/orgs/{orgId}/customers/imports/{id}` | `customers.import` |
| POST | `/orgs/{orgId}/customers/exports` | `customers.export` |

Customer audience:

| Method | Path | Purpose |
|---|---|---|
| GET · PATCH | `/me` | identity (name, locale, timezone) |
| GET | `/me/home` | dashboard data |
| GET | `/me/bookings?status=&from=` | all bookings across orgs |
| GET | `/me/bookings/{id}` | detail incl. `allowedActions` |
| POST | `/me/bookings/{id}/reschedule` · `/cancel` | per policy |
| GET | `/me/orders` · `/me/orders/{id}` | orders across orgs |
| GET | `/me/businesses` | organizations/locations with a profile |
| GET · POST · PATCH · DELETE | `/me/addresses[/{id}]` | delivery addresses |
| GET · PUT | `/me/consents` | per business, channel, purpose |
| POST | `/me/data-export` · `/me/deletion-request` | privacy |

Public audience: `GET /public/locations/{orgSlug}/{locationSlug}` (profile, hours,
capabilities), plus capability-specific public endpoints in their feature docs.

## Events and jobs

Events: `customer.created`, `customer_profile.created/updated`, `consent.changed`,
`customer.anonymized`. Jobs: `customer-import` (chunked), `customer-export`,
`customer-anonymize`, profile `stats` updater (consumes booking/order events).

## Permissions

See `customers.*` in the [permission catalogue](organizations-and-access.md#permission-catalogue).

## Edge cases

| Case | Handling |
|---|---|
| Two people share one phone (family) | Separate identities need separate verified contact points; until then bookings show under the phone owner; staff can edit `display_name` per booking |
| Customer books at two branches of the same org | One profile per organization; history shows the location per booking |
| Customer asks a business to delete their data | Business can anonymize its profile (`customers.manage`); global identity deletion only by the customer or platform support |
| Phone number recycled by carrier | New owner logging in by OTP sees old bookings → on first OTP login for an identity inactive > 12 months, require confirming name/email or start fresh identity |

## Requirements covered

FR-CUS-001 … FR-CUS-010, NFR-PRIV-001, NFR-PRIV-003.
