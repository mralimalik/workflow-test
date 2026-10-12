# Analytics

## Purpose

Show businesses the value Attendra creates and where to improve: conversations,
bookings and orders by channel, containment, handoffs, missed calls recovered, usage —
per location and across locations.

## Scope

- **Phase 2:** overview dashboard, usage vs allowance.
- **Phase 3:** cross-location comparison, CSV export.
- **Later:** dedicated analytics store (read models / OLAP) if query load requires it.

## Metrics (definitions)

| Metric | Definition | Source |
|---|---|---|
| Conversations | count by channel, location, day | `conversations` |
| Containment rate | `ai_resolved = true` / ended conversations | `conversations` |
| Booking conversion | conversations with intent `book`/`reserve` and outcome `booking_created` / those with that intent | `conversations` |
| Bookings by source | count by `source_channel` | `bookings` |
| Revenue booked via agent | sum of `total_amount_minor` of bookings/orders with `conversation_id` not null | `bookings`, `orders` |
| After-hours captured | conversations started outside location opening hours that produced a booking/order | `conversations` + schedules |
| Handoff rate & reasons | handoffs / conversations; by `reason_code`; answer rate | `handoffs` |
| No-show rate | `no_show` / (completed + no_show) | `bookings` |
| Avg voice latency | p50/p95 of `metrics.avgLatencyMs` | `conversations` |
| Usage | per meter vs allowance | `usage_records`, `plan_usage_allowances` |

All metrics are computed in the location's timezone for day boundaries and respect the
member's location scope.

## Business rules

1. Analytics queries run against daily rollup tables (`analytics_daily_location_metrics`,
   created by the analytics module from events) once volume requires; Phase 2 can query
   source tables with time-bounded indexed queries.
2. Exports run asynchronously and produce a file with an expiring link.

## Data

Source tables above; rollups are read models owned by the `analytics` module (not
system-of-record data).

## API

| Method | Path | Permission |
|---|---|---|
| GET | `/orgs/{orgId}/analytics/overview?from=&to=&locationId=` | `analytics.read` |
| GET | `/orgs/{orgId}/analytics/conversations?groupBy=day|channel|outcome` | `analytics.read` |
| GET | `/orgs/{orgId}/analytics/bookings?groupBy=day|source|service|staff` | `analytics.read` |
| GET | `/orgs/{orgId}/analytics/handoffs?groupBy=reason|location` | `analytics.read` |
| GET | `/orgs/{orgId}/analytics/locations/compare?metric=&from=&to=` | `analytics.read` |
| POST | `/orgs/{orgId}/analytics/exports` | `analytics.read` |

## Events and jobs

Consumes conversation, booking, order and handoff events for rollups. Job:
`analytics/rollup-daily`.

## Permissions

`analytics.read`.

## Requirements covered

FR-ANL-001 … FR-ANL-004.
