# 04 · Scheduling and resources

Generic time building blocks shared by every capability: schedules (when), staff members
and resources (who/what), and external busy time. Bookings allocate resources
([06](06-bookings.md)). Behaviour and the availability algorithm:
[features/scheduling-and-availability.md](../features/scheduling-and-availability.md).
Conventions: [README §1](README.md#1-conventions).

```
schedules ──< schedule_intervals
          └─< schedule_exceptions
            ▲ used by: locations.opening_schedule_id, resources.availability_schedule_id,
            │          menus (ordering hours), reservation service periods, handoff_targets
staff_members (org) ──< resources (per location) >── resource_group_members >── resource_groups
resources ──< resource_combination_members >── resource_combinations     (table combos)
resources ──< external_busy_blocks                                       (calendar sync)
```

---

## schedules

A reusable weekly pattern plus exceptions. Owned by exactly one thing (location,
resource, menu, handoff target, …) identified by `purpose` + owner columns.
**[base] [tenant] [ver]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `location_id` | uuid | no | | composite FK → `locations`; timezone comes from the location |
| `purpose` | text | no | | `opening_hours` \| `resource_availability` \| `ordering_hours` \| `service_periods` \| `handoff_availability` \| `menu_availability` |
| `name` | text | yes | | "Summer hours", "Dinner service" |
| `valid_from` | date | yes | | seasonal schedules; null = always |
| `valid_until` | date | yes | | inclusive |
| `priority` | smallint | no | `0` | when several schedules of the same owner+purpose overlap in validity, highest wins |
| `owner_type` | text | no | | `location` \| `resource` \| `menu` \| `handoff_target` |
| `owner_id` | uuid | no | | id of the owner (polymorphic; integrity by the owning module) |

Index: `(organization_id, owner_type, owner_id, purpose)`.

## schedule_intervals

Weekly recurring intervals. Overnight spans are split into two rows (e.g. Fri 18:00–24:00
and Sat 00:00–02:00). **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `schedule_id` | uuid | no | | FK → `schedules` ON DELETE CASCADE |
| `weekday` | smallint | no | | ISO 1 (Mon) – 7 (Sun) |
| `start_time` | time | no | | local wall time |
| `end_time` | time | no | | `24:00` allowed; `CHECK (end_time > start_time)` |
| `label` | text | yes | | for service periods: "Lunch", "Dinner" |
| `capacity_override` | integer | yes | | e.g. pacing or covers limit for this period (used by reservations) |

Index: `(schedule_id, weekday)`. Intervals of one schedule and weekday must not overlap
(checked in the service; exclusion constraint on `(schedule_id, weekday, int4range(minutes))`).

## schedule_exceptions

Date-specific overrides: closures, holidays, special hours, time off. **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `schedule_id` | uuid | no | | FK → `schedules` ON DELETE CASCADE |
| `starts_on` | date | no | | local date |
| `ends_on` | date | no | | inclusive; `CHECK (ends_on >= starts_on)` |
| `kind` | text | no | | `closed` (no availability on these dates) \| `custom_hours` (replace weekly intervals) \| `extra_hours` (add to weekly intervals) |
| `intervals` | jsonb | no | `'[]'` | for `custom_hours` / `extra_hours`: `[{ "start": "10:00", "end": "14:00", "label": null }]` |
| `reason` | text | yes | | "Eid holiday", "Annual leave" |
| `source` | text | no | `'manual'` | `manual` \| `bulk_holiday` \| `import` |

Partial-day time off for a person (e.g. 14:00–16:00 dentist appointment) is either an
exception with `custom_hours` or — when it must appear on the calendar — a booking of
kind `block` ([06](06-bookings.md#bookings)).

## staff_members

People who deliver services, at organization level. A staff member may work at several
locations (one `resources` row per location). May be linked to a dashboard login via
`memberships.staff_member_id`. **[base] [tenant] [soft] [ver] [i18n]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `display_name` | text | no | | "Dr. Sarah Lee" |
| `title` | text | yes | | "Senior Stylist" |
| `bio` | text | yes | | public page |
| `avatar_file_id` | uuid | yes | | FK → `files` |
| `email` | citext | yes | | for notifications / calendar invites |
| `phone_e164` | text | yes | | |
| `status` | text | no | `'active'` | `active` \| `inactive` |
| `is_bookable_online` | boolean | no | `true` | false → bookable by staff only, not by agent/customers |
| `color` | text | yes | | calendar colour |
| `sort_order` | integer | no | `0` | |

## resources

Anything at a location whose time a booking allocates: a staff member's presence at that
location, a room, a chair, a table, a bay, equipment. **[base] [tenant] [soft] [ver] [i18n] [meta]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `location_id` | uuid | no | | composite FK → `locations` |
| `type` | text | no | | `staff` \| `room` \| `chair` \| `table` \| `bay` \| `equipment` \| `unit` (lodging) \| `other` |
| `name` | text | no | | |
| `staff_member_id` | uuid | yes | | FK → `staff_members`; required iff `type = 'staff'`; UNIQUE `(location_id, staff_member_id)` |
| `capacity_min` | integer | no | `1` | tables: smallest party seated |
| `capacity_max` | integer | no | `1` | tables: seats; staff/rooms: 1 |
| `availability_schedule_id` | uuid | yes | | FK → `schedules` (purpose `resource_availability`); null → location opening hours |
| `is_bookable` | boolean | no | `true` | |
| `status` | text | no | `'active'` | `active` \| `out_of_service` |
| `attributes` | jsonb | no | `'{}'` | type-specific: tables `{ shape, x, y, rotation, accessible, outdoor }`; rooms `{ floor }` |
| `color` | text | yes | | |
| `sort_order` | integer | no | `0` | |

Exposes `UNIQUE (organization_id, id)`. `CHECK (capacity_max >= capacity_min)`.

## resource_groups

Named sets of interchangeable resources: "Hygienists", "Treatment rooms", "Patio",
"Bar seating"; for lodging, room types. **[base] [tenant] [soft] [i18n]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `location_id` | uuid | no | | composite FK → `locations` |
| `kind` | text | no | | `pool` (interchangeable for services) \| `area` (dining area) \| `room_type` (lodging) |
| `name` | text | no | | |
| `description` | text | yes | | |
| `is_bookable_online` | boolean | no | `true` | areas customers may request |
| `sort_order` | integer | no | `0` | |

## resource_group_members

Join table. A resource can be in several groups (a stylist in "Colourists" and
"Stylists").

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organization_id` | uuid | no | | RLS |
| `resource_group_id` | uuid | no | | FK → `resource_groups` ON DELETE CASCADE |
| `resource_id` | uuid | no | | FK → `resources` ON DELETE CASCADE |
| `priority` | smallint | no | `0` | assignment preference when auto-assigning |

PK `(resource_group_id, resource_id)`.

## resource_combinations

Pre-defined combinations of resources that can be booked together as one unit — mainly
pushing tables together for large parties ([FR-RES-001](../product/requirements.md#fr-res--table-reservations)).
**[base] [tenant] [soft]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `location_id` | uuid | no | | composite FK → `locations` |
| `name` | text | no | | "T4 + T5" |
| `capacity_min` | integer | no | | |
| `capacity_max` | integer | no | | |
| `is_bookable_online` | boolean | no | `true` | |

## resource_combination_members

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organization_id` | uuid | no | | RLS |
| `resource_combination_id` | uuid | no | | FK ON DELETE CASCADE |
| `resource_id` | uuid | no | | FK → `resources` |

PK `(resource_combination_id, resource_id)`. Booking a combination creates one allocation
per member table, so member tables are protected by the normal exclusion constraint.

## external_busy_blocks

Busy time read from external calendars (Google/Outlook) for a resource. Subtracted during
availability search; not part of the exclusion constraint (external calendars are not
transactional with us). Owned by `scheduling`, written by `calendar-sync`. **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `resource_id` | uuid | no | | FK → `resources` ON DELETE CASCADE |
| `calendar_link_id` | uuid | no | | FK → `calendar_links` ([13](13-integrations.md#calendar_links)) |
| `external_event_id` | text | no | | |
| `during` | tstzrange | no | | |
| `is_all_day` | boolean | no | `false` | |
| `synced_at` | timestamptz | no | | |

UNIQUE `(calendar_link_id, external_event_id)`; GiST index `(resource_id, during)`.
Events that Attendra itself pushed are recognized via `sync_mappings` and **not** stored
here (no echo).
