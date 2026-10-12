# 06 · Bookings

One booking model for every time-based commitment: appointments, table reservations,
internal blocks and (future) lodging stays. Kind-specific data hangs off the shared
header. Double-booking protection lives in `booking_allocations`.
Behaviour: [features/appointments.md](../features/appointments.md),
[features/reservations.md](../features/reservations.md),
[features/scheduling-and-availability.md](../features/scheduling-and-availability.md).
Conventions: [README §1](README.md#1-conventions).

```
bookings ──< booking_items            what is booked (services, variants)
         ──< booking_allocations      which resources, when  ← EXCLUSION CONSTRAINTS
         ──< booking_participants     extra guests / attendees
         ──< booking_events           append-only history
         ──1 reservation_details      reservation-only fields
         ──< payments                 ([08](08-payments.md))
         ──< form_responses           ([05](05-catalog-and-policies.md#form_responses))
reservation_turn_rules, reservation_pacing_rules   per-location reservation config
```

---

## bookings

**[base] [tenant] [location] [meta]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `kind` | text | no | | `appointment` \| `reservation` \| `block` (internal time block, e.g. meeting/lunch) \| `stay` (lodging, future) |
| `status` | text | no | | see state machine below |
| `reference_code` | text | no | | `BK-` + 6 chars Crockford base32 (no ambiguous chars), random; UNIQUE `(organization_id, reference_code)` |
| `customer_id` | uuid | yes | | FK → `customers`; null only for `block` |
| `customer_profile_id` | uuid | yes | | FK → `customer_profiles` |
| `starts_at` | timestamptz | no | | customer-facing start (excludes buffers) |
| `ends_at` | timestamptz | no | | `CHECK (ends_at > starts_at)` |
| `timezone` | text | no | | snapshot of location timezone at booking time |
| `party_size` | integer | no | `1` | reservations: covers; appointments: attendees |
| `source_channel` | text | no | | `voice_pstn` \| `web_widget` \| `in_app` \| `whatsapp` \| `sms` \| `customer_app` \| `public_page` \| `dashboard` \| `api` \| `integration` |
| `conversation_id` | uuid | yes | | FK → `conversations` when created by the agent |
| `created_by_type` | text | no | | **[actor]** |
| `created_by_id` | uuid | yes | | |
| `hold_expires_at` | timestamptz | yes | | set while `status = 'held'` |
| `requires_payment` | boolean | no | `false` | evaluated from policy at creation |
| `payment_status` | text | no | `'not_required'` | `not_required` \| `pending` \| `authorized` \| `partially_paid` \| `paid` \| `partially_refunded` \| `refunded` \| `failed` |
| `subtotal_amount_minor` | bigint | no | `0` | sum of items |
| `tax_amount_minor` | bigint | no | `0` | |
| `total_amount_minor` | bigint | no | `0` | |
| `amount_paid_minor` | bigint | no | `0` | maintained from `payments` |
| `currency` | char(3) | no | | |
| `policy_snapshot` | jsonb | no | `'{}'` | cancellation/payment/no-show rules in force at creation |
| `customer_notes` | text | yes | | from customer/agent |
| `internal_notes` | text | yes | | staff only |
| `locale` | text | yes | | language for this customer's messages |
| `confirmed_at` | timestamptz | yes | | |
| `checked_in_at` | timestamptz | yes | | reservations: seated |
| `completed_at` | timestamptz | yes | | |
| `cancelled_at` | timestamptz | yes | | |
| `cancelled_by_type` | text | yes | | **[actor]** |
| `cancelled_by_id` | uuid | yes | | |
| `cancellation_reason` | text | yes | | `customer_request` \| `business` \| `payment_not_received` \| `no_show` \| `duplicate` \| free text |
| `no_show_at` | timestamptz | yes | | |
| `version` | integer | no | `1` | optimistic concurrency for staff edits |

Indexes:
- `(organization_id, location_id, starts_at)` — calendars
- `(customer_id, starts_at DESC)` — customer app (customer RLS policy)
- `(organization_id, status, hold_expires_at) WHERE status = 'held'` — hold sweeper
- `(organization_id, conversation_id) WHERE conversation_id IS NOT NULL`

### State machine

```
                ┌──────────────► expired            (hold timed out / payment window missed)
                │
  held ──► pending ──► confirmed ──► checked_in ──► completed
    │         │            │              │
    │         │            ├──► no_show   └──► (in_progress for reservations: seated)
    └─────────┴────────────┴──► cancelled
```

| Status | Allocations active | Meaning |
|---|---|---|
| `held` | yes | Slot reserved while details/confirmation are collected; expires at `hold_expires_at` |
| `pending` | yes | Waiting for staff approval (`requires_confirmation`) or for payment |
| `confirmed` | yes | Committed |
| `checked_in` | yes | Customer arrived / party seated |
| `completed` | no* | Service delivered (*allocations stay `is_active` until `ends_at` for accurate calendars, then irrelevant) |
| `no_show` | no | |
| `cancelled` | no | |
| `expired` | no | |

Transitions are performed only by `bookings` application services (actions in the API),
each writing a `booking_events` row and an outbox event.

## booking_items

What is booked. Appointments: one row per service (sequential multi-service bookings
have several). Reservations: optional (set menus / experiences). **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `booking_id` | uuid | no | | FK → `bookings` ON DELETE CASCADE |
| `item_type` | text | no | | `service` \| `experience` \| `fee` |
| `service_id` | uuid | yes | | FK → `services` |
| `service_variant_id` | uuid | yes | | FK → `service_variants` |
| `name_snapshot` | text | no | | |
| `starts_at` | timestamptz | no | | within the booking |
| `ends_at` | timestamptz | no | | |
| `duration_minutes` | integer | no | | snapshot |
| `unit_price_minor` | bigint | no | `0` | snapshot after location override |
| `quantity` | integer | no | `1` | |
| `tax_amount_minor` | bigint | no | `0` | |
| `total_amount_minor` | bigint | no | `0` | |
| `requested_staff_member_id` | uuid | yes | | customer's explicit choice; null = "any" ([FR-APT-004](../product/requirements.md#fr-apt--appointments)) |
| `sort_order` | smallint | no | `0` | |

## booking_allocations

The resources a booking occupies and when. **This table is where double-booking becomes
impossible** ([FR-SCH-003](../product/requirements.md#fr-sch--scheduling-and-availability-shared-engine),
[FR-SCH-004](../product/requirements.md#fr-sch--scheduling-and-availability-shared-engine)). **[base] [tenant] [location]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `booking_id` | uuid | no | | FK → `bookings` ON DELETE CASCADE |
| `booking_item_id` | uuid | yes | | FK → `booking_items` |
| `resource_id` | uuid | no | | composite FK → `resources` |
| `staff_member_id` | uuid | yes | | denormalized from the resource; enables the cross-location constraint |
| `role` | text | no | `'primary'` | from the service resource rule |
| `during` | tstzrange | no | | the time the resource is used for the customer |
| `blocked_during` | tstzrange | no | | `during` extended by buffers; what the constraint protects |
| `is_active` | boolean | no | `true` | false once the booking is cancelled/expired/no-show; maintained by the bookings service in the same transaction as the status change |
| `assignment` | text | no | `'auto'` | `auto` \| `requested` (customer chose) \| `manual` (staff assigned) |

Constraints (raw SQL in the migration):

```sql
-- One resource can never be in two active allocations at overlapping times.
ALTER TABLE booking_allocations ADD CONSTRAINT booking_allocations_resource_ex
  EXCLUDE USING gist (resource_id WITH =, blocked_during WITH &&) WHERE (is_active);

-- One person can never be booked at two locations at overlapping times.
ALTER TABLE booking_allocations ADD CONSTRAINT booking_allocations_staff_ex
  EXCLUDE USING gist (staff_member_id WITH =, blocked_during WITH &&)
  WHERE (is_active AND staff_member_id IS NOT NULL);

ALTER TABLE booking_allocations ADD CONSTRAINT booking_allocations_range_ck
  CHECK (NOT isempty(during) AND blocked_during @> during);
```

A violation (`23P01`) is mapped to `409 slot_unavailable`. Expired holds still hold
`is_active = true` until released; the create-booking transaction first deactivates
expired-hold allocations that overlap the requested range
([features/scheduling-and-availability.md](../features/scheduling-and-availability.md#holds)),
so a stale hold never blocks a real customer.

Indexes: GiST `(organization_id, location_id, blocked_during) WHERE is_active` for
calendar/availability range scans.

**Group sessions** (capacity > 1, [FR-APT-009](../product/requirements.md#fr-apt--appointments))
do not fit an exclusion constraint per attendee. They will use a future `class_sessions`
table (one row per scheduled session holding the resource allocation) with a capacity
counter updated under `SELECT … FOR UPDATE`; attendee bookings reference
`class_session_id`. Nothing in the current schema needs to change for that.

## booking_participants

Additional people on a booking (group bookings, guest names for reservations).
**[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `booking_id` | uuid | no | | FK ON DELETE CASCADE |
| `customer_id` | uuid | yes | | if the participant is a known customer |
| `name` | text | yes | | |
| `role` | text | no | `'guest'` | `guest` \| `attendee` \| `child` |
| `notes` | text | yes | | |

## booking_events

Append-only history of a booking. **[base-append] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `booking_id` | uuid | no | | FK |
| `type` | text | no | | `created` \| `status_changed` \| `rescheduled` \| `reassigned` \| `items_changed` \| `note_added` \| `payment_updated` \| `reminder_sent` \| `customer_contacted` |
| `from_status` | text | yes | | |
| `to_status` | text | yes | | |
| `changes` | jsonb | no | `'{}'` | e.g. `{ "startsAt": ["old", "new"], "resourceIds": [[...], [...]] }` |
| `actor_type` | text | no | | **[actor]** |
| `actor_id` | uuid | yes | | |
| `source_channel` | text | yes | | |
| `conversation_id` | uuid | yes | | |

Index: `(booking_id, created_at)`.

## reservation_details

Reservation-only fields, 1:1 with `bookings` where `kind = 'reservation'`. **[tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `booking_id` | uuid | no | | PK, FK → `bookings` ON DELETE CASCADE |
| `organization_id` | uuid | no | | RLS |
| `area_preference_id` | uuid | yes | | FK → `resource_groups` (kind `area`) |
| `seating_preferences` | text[] | no | `'{}'` | `window` \| `booth` \| `outdoor` \| `quiet` \| `bar` |
| `occasion` | text | yes | | `birthday` \| `anniversary` \| `business` \| `date` \| other |
| `high_chairs` | smallint | no | `0` | |
| `accessibility_needs` | text | yes | | |
| `dietary_notes` | text | yes | | informational only |
| `service_period_label` | text | yes | | snapshot ("Dinner") |
| `turn_minutes` | integer | no | | duration applied |
| `seated_at` | timestamptz | yes | | |
| `left_at` | timestamptz | yes | | actual turn time analytics |

## reservation_turn_rules

How long a party occupies a table, by party size and service period
([FR-RES-002](../product/requirements.md#fr-res--table-reservations)). **[base] [tenant] [location]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `service_period_label` | text | yes | | null = all periods |
| `weekday` | smallint | yes | | null = all days |
| `party_size_min` | integer | no | | |
| `party_size_max` | integer | no | | |
| `turn_minutes` | integer | no | | |

## reservation_pacing_rules

Protects the kitchen: limits per time window ([FR-RES-003](../product/requirements.md#fr-res--table-reservations)).
**[base] [tenant] [location]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `service_period_label` | text | yes | | |
| `weekday` | smallint | yes | | |
| `window_minutes` | integer | no | `15` | |
| `max_covers` | integer | yes | | per window |
| `max_parties` | integer | yes | | per window |
| `online_share_bps` | integer | yes | | share of capacity bookable online/agent; rest kept for walk-ins/staff |

Pacing is enforced in the booking transaction with an advisory lock on
`(location_id, window_start)` and a count of active reservations in that window.

---

## Appendix — Lodging fit (future)

Stays use `bookings.kind = 'stay'`: `starts_at`/`ends_at` are check-in/check-out instants;
`resources.type = 'unit'` are rooms; `resource_groups.kind = 'room_type'` are room types;
allocations reserve a unit for the whole stay with the same exclusion constraint.
Lodging-specific tables (`rate_plans`, `rate_calendar`, `inventory_restrictions`,
`stay_details`) would be added by a `lodging` module without changing anything above.
See [features/lodging.md](../features/lodging.md).
