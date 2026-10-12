# ADR-0011 · One booking model with allocations and exclusion constraints

**Status:** Accepted · 2026-10-11

## Context

Appointments, table reservations and (future) lodging stays all reserve resources over
time. They differ in what is booked and how capacity is computed, but share customers,
lifecycle, payments, notifications, conversations and calendar sync.

## Decision

- One `bookings` table with `kind` (`appointment` | `reservation` | `block` | `stay`),
  kind-specific detail tables (`reservation_details`, future `stay_details`), and
  `booking_items` for what is booked.
- Resource usage is recorded in `booking_allocations` with `tstzrange` columns and
  **exclusion constraints** per resource and per staff member (across locations).
- Holds are bookings in status `held` with an expiry, so they are protected by the same
  constraints.
- Food orders are a **separate** model (`orders`) because they reserve products, not time.

## Alternatives considered

- **Separate tables per capability** (`appointments`, `reservations`, `stays`). Duplicates
  lifecycle, payments, notifications and customer views; cross-capability calendars
  become unions.
- **Slot tables** (pre-generated rows per slot). Simple locking, but explosive row counts,
  painful schedule changes and poor fit for variable durations.

## Consequences

- Double booking is impossible at the database level for every time-based capability.
- New time-based capabilities add a `kind` and a details table, not a new booking system.
- Group sessions need a capacity-counter pattern (future `class_sessions`), documented in
  [data model 06](../data-model/06-bookings.md#booking_allocations).
