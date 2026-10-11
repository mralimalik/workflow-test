# Integrations

## Purpose

Keep the tools businesses already use in sync with Attendra — which remains the source of
truth — and let developers build on Attendra through a public API and webhooks.

## Scope

- **Calendars:** Google (Phase 2), Microsoft (Phase 3) — push bookings, read busy time.
- **Public API + API keys, outbound webhooks** (Phase 4).
- **POS / CRM** (Phase 4+) on the same connection framework.

## Business rules

1. Attendra is the source of truth ([FR-INT-003](../product/requirements.md#fr-int--integrations)).
   External changes to events we created are **not** applied back to bookings; instead the
   sync detects drift and either re-pushes our version or (setting) alerts staff.
2. Busy time from linked calendars blocks availability for that resource (not the
   location), excluding events we created ourselves (`sync_mappings`).
3. Calendar event content follows `event_privacy`: `details` (customer first name,
   service, reference code) or `minimal` ("Booked – Attendra").
4. Each connection syncs serially (per-connection concurrency 1) to preserve ordering;
   failures back off exponentially; after N failures the connection becomes `error` and
   owners are alerted.
5. Tokens are envelope-encrypted; scopes are the minimum needed (calendar events read/write
   for linked calendars).
6. API keys carry permissions from the same catalogue and a location scope; requests
   through API keys are audited with actor type `api_key`.
7. Outbound webhooks: signed with HMAC-SHA256 (`Attendra-Signature: t=…,v1=…`), at-least-once,
   retried with backoff up to 24 h, auto-disabled after sustained failure; payloads are
   versioned event objects ([BACKEND.md §10.2](../../BACKEND.md#102-event-catalogue)).

## Flows

### Google Calendar

```
connect: OAuth (offline access) → integration_connections → pick calendars → calendar_links
push:    booking.confirmed/rescheduled/cancelled → calendar-sync/push-booking → upsert event
         → sync_mappings (external_id, etag, content_hash)
busy:    Google push notification (watch channel) → /webhooks/google/calendar
         → calendar-sync/pull-busy (incremental sync token) → external_busy_blocks → avail cache bump
renew:   calendar-sync/renew-watch before watch_expires_at
```

## Data

[`integration_connections`](../data-model/13-integrations.md#integration_connections),
[`calendar_links`](../data-model/13-integrations.md#calendar_links),
[`sync_mappings`](../data-model/13-integrations.md#sync_mappings),
[`external_busy_blocks`](../data-model/04-scheduling-and-resources.md#external_busy_blocks),
[`webhook_endpoints`](../data-model/13-integrations.md#webhook_endpoints),
[`webhook_deliveries`](../data-model/13-integrations.md#webhook_deliveries),
[`api_keys`](../data-model/02-tenancy-and-access.md#api_keys).

## API

| Method | Path | Permission |
|---|---|---|
| GET | `/orgs/{orgId}/integrations` | `integrations.manage` |
| GET | `/orgs/{orgId}/integrations/{provider}/connect` (OAuth start) · `/callback` | `integrations.manage` (staff may connect their own calendar with `schedules.manage_own`) |
| DELETE | `/orgs/{orgId}/integrations/{connectionId}` | `integrations.manage` |
| GET · POST · PATCH · DELETE | `/orgs/{orgId}/integrations/{connectionId}/calendar-links[/{id}]` | `integrations.manage` |
| POST | `/orgs/{orgId}/integrations/{connectionId}/resync` | `integrations.manage` |
| GET · POST · DELETE | `/orgs/{orgId}/api-keys[/{id}]` | `api_keys.manage` (secret shown once) |
| GET · POST · PATCH · DELETE | `/orgs/{orgId}/webhook-endpoints[/{id}]` | `integrations.manage` |
| GET | `/orgs/{orgId}/webhook-endpoints/{id}/deliveries` · POST `/deliveries/{id}/redeliver` | `integrations.manage` |
| POST | `/webhooks/google/calendar`, `/webhooks/microsoft/calendar` | provider validation |

## Events and jobs

Emits `integration.connected/disconnected/errored`, `external_busy.changed`.
Queues: `calendar-sync`, `webhooks-out`.

## Permissions

`integrations.manage`, `api_keys.manage`, `schedules.manage_own`.

## Edge cases

| Case | Handling |
|---|---|
| Staff deletes our event in Google | Next sync detects missing event → re-create (default) or alert (setting) |
| Recurring personal events (weekly gym) | Expanded within the sync horizon (90 days) into busy blocks |
| Refresh token revoked | Connection `needs_reauth`; busy blocks kept until stale threshold, then cleared with an alert |

## Requirements covered

FR-INT-001 … FR-INT-006.
