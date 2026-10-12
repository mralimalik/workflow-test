# Table reservations

## Purpose

Let restaurants (including hotel restaurants and bars) take table reservations by phone,
widget, app and public page, with correct table assignment, turn times and kitchen
pacing — using the shared booking engine.

## Scope

- **In (Phase 3):** dining areas, tables, combinations, service periods, turn rules,
  pacing, automatic and manual table assignment, floor view, seating states, deposits
  for large parties (via payments), walk-ins.
- **Out:** waitlist with SMS paging (later), server sections and covers-per-server
  analytics (later), POS table sync (integrations).

## Concepts

- **Table** = `resources.type = 'table'` with `capacity_min..capacity_max` and floor
  coordinates in `attributes`.
- **Area** = `resource_groups.kind = 'area'` (Patio, Main room, Bar).
- **Combination** = `resource_combinations` (T4+T5 for 8–10 guests).
- **Service period** = labelled intervals of a `schedules` row with
  `purpose = 'service_periods'` (Lunch 12:00–15:00, Dinner 18:00–23:00).
- **Turn time** = how long a party occupies a table (`reservation_turn_rules`).
- **Pacing** = max covers/parties per window (`reservation_pacing_rules`).

## Business rules

1. Reservation start times must fall inside a service period; last seating =
   period end − (setting `lastSeatingBeforeCloseMinutes`).
2. Duration = turn rule matching (period, weekday, party size), else
   `reservations.defaultTurnMinutes`.
3. Party size online/agent ≤ `reservations.maxPartySizeOnline`; larger → handoff or
   request (status `pending`, staff confirm).
4. **Table assignment** (auto): candidate tables/combinations where
   `capacity_min ≤ party ≤ capacity_max`, in preferred area if requested, free for the
   whole turn; choose the smallest fitting capacity (least waste), then area priority,
   then single table over combination.
5. **Pacing**: a reservation is accepted only if the window it starts in stays within
   `max_covers`/`max_parties` (and the online share for online/agent sources); enforced
   under an advisory lock on `(location, window)` inside the booking transaction.
6. Allocations use the same exclusion constraints as appointments — tables can never be
   double-booked; combinations allocate each member table.
7. Statuses map to restaurant language: `confirmed` → "Booked", `checked_in` → "Seated",
   `completed` → "Left", `no_show`.
8. Late arrival: after `lateArrivalGraceMinutes` without check-in, staff are prompted to
   mark no-show (never automatic).
9. Deposits/card guarantees per policy (e.g. party ≥ 8 → deposit) — [payments](payments.md#policies).
10. Walk-ins are created by staff as reservations with `source_channel = dashboard`,
    starting now, status `checked_in`.

## Flows

Agent: `check_reservation_availability(date, partySize, period?, areaPreference?)` →
offers times → `hold_reservation` → read back (date, time, party size, name, area,
occasion) → `confirm_reservation`. Dashboard floor view: live table states (free,
reserved soon, seated, overdue) from today's allocations, drag a reservation to another
table → `reassign`.

## Data

[`bookings`](../data-model/06-bookings.md#bookings) (`kind = reservation`),
[`reservation_details`](../data-model/06-bookings.md#reservation_details),
[`reservation_turn_rules`](../data-model/06-bookings.md#reservation_turn_rules),
[`reservation_pacing_rules`](../data-model/06-bookings.md#reservation_pacing_rules),
[`resources`](../data-model/04-scheduling-and-resources.md#resources),
[`resource_groups`](../data-model/04-scheduling-and-resources.md#resource_groups),
[`resource_combinations`](../data-model/04-scheduling-and-resources.md#resource_combinations),
[`schedules`](../data-model/04-scheduling-and-resources.md#schedules).

## API

Tables, areas and combinations use the resource endpoints in
[scheduling-and-availability](scheduling-and-availability.md#api). Specific:

| Method | Path | Permission |
|---|---|---|
| GET · PUT | `{L}/reservation-settings` (turn rules, pacing rules, service periods) | `catalog.read` · `catalog.manage` |
| GET | `{L}/reservations/availability?date=&partySize=&areaId=` | `bookings.read` |
| GET | `{L}/floor?at=` | `bookings.read` (tables + current/upcoming allocations) |
| POST | `{L}/reservations` | `bookings.create` |
| POST | `{L}/reservations/walk-in` | `bookings.create` |
| GET · PATCH · actions | `{L}/bookings/{id}…` | as [appointments](appointments.md#api) (`/check-in` = seat, `/complete` = left, `/reassign` = move table) |
| GET | `/public/locations/{locationId}/reservations/availability` | public |
| POST | `/public/locations/{locationId}/reservations/holds` | public (OTP before confirm) |

## Events and jobs

Same booking events as appointments with `kind = reservation`. Job:
`reservations/late-arrival-prompt` (delayed per reservation).

## Permissions

`bookings.*`, `catalog.manage` (settings), `resources.manage` (tables).

## Edge cases

| Case | Handling |
|---|---|
| Party grows on arrival | Staff reassign to a larger table/combination; conflict shown if none free |
| Party of 2 when only 6-tops free | Allowed only if setting `allowOversizedTables`; otherwise not offered (protects capacity) |
| Reservation spans period end | Allowed if it starts before last seating; turn may extend past period end |
| Hotel restaurant with hotel guests | Same model; guest identity is a customer; room-charge payment is a future integration |

## Requirements covered

FR-RES-001 … FR-RES-006.
