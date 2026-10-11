# Appointments

## Purpose

Let any service business (clinic, salon, garage, tutor…) define what can be booked, at
which locations, with whom and with what rules — and let customers, the agent and staff
create and manage appointments through one lifecycle.

## Scope

- **In:** service categories, services, variants, location overrides, resource rules,
  policies (cancellation/payment) attachment, intake forms (Phase 2), booking lifecycle,
  reschedule/cancel/check-in/no-show, manual bookings and blocks, dashboard calendar,
  multi-service bookings (Phase 2).
- **Out (later):** group classes ([FR-APT-009](../product/requirements.md#fr-apt--appointments)),
  waitlist, recurring appointments, packages/memberships.

## Concepts

Service, variant, resource rule, booking, hold, policy — [glossary](../product/glossary.md).

## Business rules

1. A service is bookable at a location only if enabled in `location_services`, the
   `appointments` capability is enabled, and its resource rules can be satisfied there.
2. Effective service values = location override → service → capability settings.
3. Price shown/spoken: `fixed` → exact; `from` → "starting at"; `free`; `on_request` → no
   price stated.
4. Booking creation status: `held` (agent/public flows) → `confirmed`, or `pending` if
   `requires_confirmation` or payment is required by policy
   ([payments](payments.md#policies)).
5. **Reschedule** keeps the same booking id and reference code; it re-allocates
   atomically (new allocations inserted and old deactivated in one transaction) and
   records a `rescheduled` event. Allowed by customers/agent only within the cancellation
   policy window (or if `rescheduleCountsAsCancellation` is false).
6. **Cancel** by customer/agent: allowed per policy; late cancellation may trigger a fee
   (payments). Staff can always cancel (reason required).
7. **No-show**: staff mark after `starts_at + graceMinutes`; may trigger a no-show fee;
   `customer_profiles.stats.noShows` increments; after `blockAfterCount`, the profile is
   flagged for review (not auto-blocked).
8. **Completed**: set by staff or automatically at `ends_at + 2h` if checked in (setting).
9. **Blocks** (`kind = block`): staff create internal time blocks on resources; no
   customer; never visible publicly.
10. Multi-service bookings run services back-to-back; each item allocates its own
    resources; the booking spans first start to last end.
11. Intake form answers are required before confirmation if the form marks fields
    required; the agent asks only `askedByAgent` fields.

## Flows

### Agent booking (happy path)

```
customer: "I'd like a cleaning next Tuesday afternoon"
agent → find_services("cleaning") → check_availability(serviceId, date range, partOfDay)
agent: offers 2–3 times
customer picks → hold_slot(slot) → agent reads back: service, date (spoken with weekday),
time, staff, location, price, policy summary → customer confirms
→ confirm_booking(holdId, customer details) → SMS confirmation (notifications)
```

### Dashboard calendar

Day/week/resource views over `GET {L}/calendar?from=&to=` (bookings + blocks + exceptions);
drag-and-drop → `POST .../bookings/{id}/reschedule` with explicit resources; conflict →
`409` with reason, UI snaps back.

## Data

[`service_categories`](../data-model/05-catalog-and-policies.md#service_categories),
[`services`](../data-model/05-catalog-and-policies.md#services),
[`service_variants`](../data-model/05-catalog-and-policies.md#service_variants),
[`location_services`](../data-model/05-catalog-and-policies.md#location_services),
[`service_resource_rules`](../data-model/05-catalog-and-policies.md#service_resource_rules),
[`policies`](../data-model/05-catalog-and-policies.md#policies),
[`forms`](../data-model/05-catalog-and-policies.md#forms),
[`bookings`](../data-model/06-bookings.md#bookings),
[`booking_items`](../data-model/06-bookings.md#booking_items),
[`booking_allocations`](../data-model/06-bookings.md#booking_allocations),
[`booking_events`](../data-model/06-bookings.md#booking_events).

## API

Catalogue:

| Method | Path | Permission |
|---|---|---|
| GET · POST | `/orgs/{orgId}/service-categories` | `catalog.read` · `catalog.manage` |
| PATCH · DELETE | `/orgs/{orgId}/service-categories/{id}` | `catalog.manage` |
| GET · POST | `/orgs/{orgId}/services` | `catalog.read` · `catalog.manage` |
| GET · PATCH · DELETE | `/orgs/{orgId}/services/{id}` | `catalog.*` |
| GET · POST · PATCH · DELETE | `/orgs/{orgId}/services/{id}/variants[/{variantId}]` | `catalog.*` |
| PUT | `/orgs/{orgId}/services/{id}/resource-rules` | `catalog.manage` |
| GET · PUT | `{L}/services/{serviceId}` | `catalog.read` · `catalog.manage` (location override/enable) |
| GET · POST · PATCH · DELETE | `/orgs/{orgId}/policies[/{id}]` | `catalog.*` |
| GET · POST · PATCH · DELETE | `/orgs/{orgId}/forms[/{id}]`, POST `/forms/{id}/publish` | `catalog.*` |

Bookings (business):

| Method | Path | Permission |
|---|---|---|
| GET | `{L}/calendar?from=&to=&resourceId=` | `bookings.read` |
| GET | `{L}/bookings?status=&from=&to=&customerId=&staffMemberId=&referenceCode=` | `bookings.read` |
| POST | `{L}/bookings` | `bookings.create` (Idempotency-Key) |
| GET · PATCH | `{L}/bookings/{id}` | `bookings.read` · `bookings.update` (notes, items) |
| POST | `{L}/bookings/{id}/confirm` · `/reschedule` · `/reassign` · `/cancel` · `/check-in` · `/complete` · `/no-show` | `bookings.update` / `bookings.cancel` |
| GET | `{L}/bookings/{id}/events` | `bookings.read` |
| POST | `{L}/blocks` · DELETE `{L}/blocks/{id}` | `bookings.create` |

Public / customer: `GET /public/locations/{locationId}/services`,
`POST /public/locations/{locationId}/holds`, `POST /public/holds/{id}/confirm` (OTP-verified),
and `/me/bookings/*` ([customers](customers.md#api)).

## Events and jobs

Emits `booking.held/confirmed/rescheduled/cancelled/checked_in/completed/no_show/hold_expired`,
`catalog.changed`, `policy.changed`. Consumers: notifications (confirmations, reminders),
calendar-sync, payments, analytics, realtime. Jobs: `bookings/auto-complete` (hourly).

## Permissions

`catalog.*`, `bookings.*` — [catalogue](organizations-and-access.md#permission-catalogue).

## Edge cases

| Case | Handling |
|---|---|
| Customer requests a staff member not working that day | Agent offers that staff's next availability or another staff today |
| Service needs a room and staff; room free, staff busy | Rule set not satisfied → slot not offered |
| Price changed after booking | Booking keeps snapshot price; staff may edit items explicitly |
| Business disables a service with future bookings | Allowed; existing bookings unaffected; dashboard warns with count |
| Reschedule to a slot that becomes taken mid-request | `409` with alternatives; original booking untouched (atomic) |

## Requirements covered

FR-APT-001 … FR-APT-011.
