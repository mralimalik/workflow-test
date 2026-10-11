# Lodging (future)

## Purpose

Record how hotel stays fit the platform so that adding them later — inside Attendra or as
a separate product sharing the same core — requires no change to existing tables.

## Status

Not scheduled. Decision on in-product vs separate product is open
([prd §12](../product/prd.md#12-open-questions)). Hotel **restaurants and spas** are already
covered by reservations and appointments.

## How it fits the current model

| Lodging concept | Existing construct |
|---|---|
| Property | `locations` (capability `lodging`) |
| Room type | `resource_groups.kind = 'room_type'` |
| Room (unit) | `resources.type = 'unit'` |
| Stay | `bookings.kind = 'stay'` with check-in/check-out instants |
| Room assignment | `booking_allocations` over the stay range — same exclusion constraint prevents double-assignment |
| Guests | `booking_participants` |
| Deposit / prepayment | `policies` + `payments` |
| Guest communications | notifications, conversations, handoff — unchanged |

## What a lodging module would add

- `stay_details` (1:1 with booking: adults, children, rate plan, room type requested,
  arrival time, special requests).
- `rate_plans` (refundable/non-refundable, meal plans, cancellation policy reference).
- `rate_calendar` (room type × date × rate plan → price, min stay, closed to arrival/departure).
- `inventory_restrictions` (stop-sell, min/max stay by date).
- Availability by **room type inventory** (count of units free per night) rather than
  slot grids; assignment of specific units can be deferred to check-in.
- Channel manager / OTA integrations through the integrations framework.

## Requirements covered

None yet; future requirements will use the `FR-LDG-*` prefix.
