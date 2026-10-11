# Scheduling and availability

## Purpose

Answer "when can this be booked?" correctly and fast for any time-based capability, and
guarantee at the database level that no resource or person is ever double-booked,
regardless of which channel books.

## Scope

- **In:** schedules (weekly + exceptions), staff members, resources, resource groups,
  combinations, external busy time, the availability engine, holds, the allocation
  algorithm, concurrency guarantees.
- **Out:** capability-specific rules (service rules → [appointments](appointments.md);
  turn times/pacing → [reservations](reservations.md)) which plug into this engine.

## Concepts

Schedule, resource, resource group, allocation, hold — [glossary](../product/glossary.md).

## Business rules

1. **Effective working time of a resource on a date** =
   (resource availability schedule, or location opening hours if none)
   ∩ location opening hours
   − schedule exceptions (`closed`) ± (`custom_hours` / `extra_hours`).
2. **Free time** = effective working time − active allocations' `blocked_during`
   − external busy blocks − unexpired holds of others.
3. A candidate start time must: be on the slot grid (`slot_interval_minutes`, anchored to
   the interval start); respect `min_notice_minutes` and `max_advance_days`; fit the full
   duration + buffers inside free time for **every** required resource simultaneously.
4. "Any available" picks resources by: customer's preferred staff (profile) → group
   `priority` → least booked that day (load balancing) → stable id order.
5. Time is computed in the location's timezone, stored in UTC. On DST transitions,
   nonexistent local times are skipped and ambiguous ones use the first occurrence
   ([FR-SCH-006](../product/requirements.md#fr-sch--scheduling-and-availability-shared-engine)).
6. Availability responses are for display; the booking transaction re-validates and the
   exclusion constraints are final ([BACKEND.md §9.1](../../BACKEND.md#91-rules)).

## Holds

- A hold is a booking with `status = held`, allocations active, `hold_expires_at = now +
  holdMinutes` (default 3, setting `booking.holdMinutes`).
- Agent flow: `check_availability` → `hold_slot` (when the customer picks a time) →
  read back → `confirm_booking`. Public pages/widget: hold when the customer selects a
  slot; confirm on submit.
- Expiry: a delayed job `holds/expire-hold` marks it `expired` and deactivates
  allocations; a sweeper every minute catches missed jobs.
- **Stale holds never block real customers:** the create/hold transaction first runs
  `UPDATE booking_allocations SET is_active = false … WHERE` overlapping AND booking is
  `held` AND `hold_expires_at < now()` before inserting.
- A conversation may hold at most 2 slots at once; holding a new one releases the oldest.

## Flows

### Availability search

```
GET {L}/availability?serviceId=&variantId=&staffMemberId=&from=2026-10-12&to=2026-10-19&partySize=
1. Load (cached) location profile, service + overrides + resource rules, schedules, exceptions
2. Load allocations + busy blocks in [from-buffer, to+buffer] for candidate resources (one range query each, GiST)
3. Build free-interval sets per resource (interval arithmetic in kernel/time)
4. Generate grid candidates; test every rule (needs 1 from group X AND 1 from group Y…)
5. Return slots: [{ startsAt, endsAt, resources: [{ resourceId, staffMemberId }] | "any" }]
```

Performance target: p95 < 300 ms for 14 days ([NFR-PERF-002](../product/requirements.md#nfr-perf--performance)).
Results cached 60 s per location/service/date with version-token invalidation.

### Booking transaction (concurrency)

```
BEGIN; SET LOCAL app.organization_id = …
  deactivate expired holds overlapping the range
  INSERT bookings (status held|confirmed)
  INSERT booking_allocations (one per resource)   ← exclusion constraints checked here
  INSERT booking_events, outbox_events
COMMIT
  23P01 exclusion_violation → retry once with the next-best resource for "any",
                              else 409 slot_unavailable + 3 nearest alternatives
```

## Data

[`schedules`](../data-model/04-scheduling-and-resources.md#schedules),
[`schedule_intervals`](../data-model/04-scheduling-and-resources.md#schedule_intervals),
[`schedule_exceptions`](../data-model/04-scheduling-and-resources.md#schedule_exceptions),
[`staff_members`](../data-model/04-scheduling-and-resources.md#staff_members),
[`resources`](../data-model/04-scheduling-and-resources.md#resources),
[`resource_groups`](../data-model/04-scheduling-and-resources.md#resource_groups),
[`resource_combinations`](../data-model/04-scheduling-and-resources.md#resource_combinations),
[`external_busy_blocks`](../data-model/04-scheduling-and-resources.md#external_busy_blocks),
[`booking_allocations`](../data-model/06-bookings.md#booking_allocations).

## API

| Method | Path | Permission |
|---|---|---|
| GET · POST | `/orgs/{orgId}/staff-members` | `resources.read` · `resources.manage` |
| GET · PATCH · DELETE | `/orgs/{orgId}/staff-members/{id}` | `resources.read` · `resources.manage` |
| GET · POST | `{L}/resources` | `resources.read` · `resources.manage` |
| GET · PATCH · DELETE | `{L}/resources/{id}` | `resources.read` · `resources.manage` |
| GET · POST · PATCH · DELETE | `{L}/resource-groups[/{id}]` | `resources.*` |
| PUT | `{L}/resource-groups/{id}/members` | `resources.manage` |
| GET · POST · PATCH · DELETE | `{L}/resource-combinations[/{id}]` | `resources.*` |
| GET · POST | `{L}/schedules` | `resources.read` · `resources.manage` |
| GET · PATCH · DELETE | `{L}/schedules/{id}` | `resources.*` |
| PUT | `{L}/schedules/{id}/intervals` | `resources.manage` or `schedules.manage_own` |
| GET · POST · PATCH · DELETE | `{L}/schedules/{id}/exceptions[/{exceptionId}]` | `resources.manage` or `schedules.manage_own` |
| POST | `/orgs/{orgId}/holidays/apply` | `resources.manage` (bulk exceptions to many locations) |
| GET | `{L}/opening-hours/effective?from=&to=` | `locations.read` (resolved local open intervals per date, DST-correct) |
| GET | `{L}/availability` | `bookings.read` |
| GET | `/public/locations/{locationId}/availability` | public (rate limited, cached) |

## Events and jobs

Emits `schedule.changed`, `resource.changed` (→ avail cache, agent context).
Consumes `external_busy.changed`, `booking.*` (→ avail cache version bump).
Jobs: `holds/expire-hold`, `holds/sweep` (every minute).

## Permissions

`resources.*`, `schedules.manage_own`, `bookings.read` — [catalogue](organizations-and-access.md#permission-catalogue).

## Edge cases

| Case | Handling |
|---|---|
| Staff works at two locations the same day | Separate resources per location, protected jointly by the `staff_member_id` constraint |
| Schedule edited after bookings exist | Existing bookings stay; dashboard flags bookings now outside working hours for review |
| Overnight hours (bar until 02:00) | Intervals split across weekdays; slot generation crosses midnight correctly |
| Location timezone without DST vs customer abroad | All display in location timezone; customer app shows both when they differ |
| Thundering herd on a popular slot | Exclusion constraint guarantees one winner; losers get alternatives |

## Requirements covered

FR-SCH-001 … FR-SCH-006, NFR-PERF-002.
