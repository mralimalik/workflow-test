# Notifications

## Purpose

Send the right transactional message to customers and the right alert to staff, on the
right channel and in the right language, exactly once, respecting consent.

## Scope

- **In (Phase 2):** SMS and email; templates per event/channel/locale with org/location
  overrides; reminders; delivery tracking; opt-out handling; staff alerts (email, in-app,
  web push). WhatsApp templates and mobile push in Phase 4.
- **Out:** marketing campaigns (later, separate module with stricter consent rules).

## Business rules

1. Notifications are triggered only by domain events (outbox), never inline in requests.
2. Template lookup: location override → organization override → platform default;
   locale: booking/customer locale → location default → organization default → `en`.
3. Channel choice for customer messages: per event, organization setting lists channels
   in order (e.g. `["sms", "email"]`); first channel with a valid destination and no
   suppression is used; `auth.otp` uses the channel requested.
4. Reminders: offsets from `notifications.reminderOffsetsMinutes` (default 24 h and
   2 h); scheduled as delayed jobs with deterministic ids so reschedules replace them and
   cancellations remove them ([FR-NOT-003](../product/requirements.md#fr-not--notifications)).
5. Quiet hours (location setting) delay non-urgent messages (reminders) to the next
   allowed time; never delay OTPs or order status.
6. Every customer message includes the business name; SMS includes opt-out text where
   legally required.
7. Links in messages are short links to the customer app / payment page, signed and
   expiring where they grant access.

## Consent and suppression

| Category | Requires | Suppressed when |
|---|---|---|
| `security` (OTP, login alerts) | nothing | never (except invalid destination) |
| `transactional` (confirmations, reminders, order status, payment links) | an existing relationship (booking/order) | latest consent for that channel at that org is `revoked` (e.g. after STOP) |
| `marketing` | explicit `granted` consent for org + channel + `marketing` | no current grant |
| `staff_alert` | membership preferences | user disabled that alert |

Inbound STOP / UNSUBSCRIBE (SMS/WhatsApp) creates a `revoked` consent row
(`source = stop_keyword`) for that organization (the number identifies it) and replies
with the confirmation required by the carrier. START re-grants.

## Flows

```
booking.confirmed (outbox) → notifications consumer
  → resolve recipients + channel + template + locale → check suppression
  → insert notifications row (queued, dedupe_key) → provider send (Twilio/SMTP)
  → status webhooks → notification.status_changed → realtime (booking timeline shows "SMS delivered")
  → usage record (sms_segments) for billing
```

## Event → message map (customers)

| Event | Message |
|---|---|
| `booking.confirmed` | confirmation with date/time/location/manage link |
| `booking.rescheduled` | updated details |
| `booking.cancelled` | cancellation (+ refund info if any) |
| reminder job | reminder with manage link |
| `booking.held` with payment required | payment link (`payment.link`) |
| `order.accepted` / `order.ready` / `order.status_changed (out_for_delivery)` | status + ETA |
| `order.cancelled` | cancellation + refund info |
| `payment.succeeded` | receipt (email) |
| `customer.created` from phone booking | welcome + customer app link (combined with confirmation) |

Staff alerts: new booking/order (optional), `handoff.requested` (urgent), `task.assigned`,
overdue tasks, `payment.failed` for deposits, integration errors, billing problems
(owners/admins).

## Data

[`notification_templates`](../data-model/12-notifications.md#notification_templates),
[`notifications`](../data-model/12-notifications.md#notifications),
[`push_devices`](../data-model/12-notifications.md#push_devices),
[`consents`](../data-model/03-customers.md#consents),
[`memberships.notification_preferences`](../data-model/02-tenancy-and-access.md#memberships).

## API

| Method | Path | Permission |
|---|---|---|
| GET | `/orgs/{orgId}/notification-templates?eventKey=&channel=&locale=` | `notifications.manage` (effective + overrides) |
| PUT · DELETE | `/orgs/{orgId}/notification-templates/{eventKey}/{channel}/{locale}` | `notifications.manage` (override / revert to default) |
| POST | `/orgs/{orgId}/notification-templates/preview` | `notifications.manage` (render with sample data) |
| GET | `{L}/notifications?relatedType=&relatedId=` | `bookings.read` |
| GET · PUT | `/orgs/{orgId}/me/notification-preferences` | own membership |
| POST · DELETE | `/me/push-devices`, `/orgs/{orgId}/me/push-devices` | customer / user |
| POST | `/webhooks/twilio/sms-status`, `/webhooks/twilio/sms-inbound`, `/webhooks/email/{provider}` | provider signature |

## Events and jobs

Consumes the events above. Emits `notification.status_changed`. Queues: `notifications`,
`reminders` ([BACKEND.md §10.3](../../BACKEND.md#103-queues-and-jobs)).

## Permissions

`notifications.manage`.

## Edge cases

| Case | Handling |
|---|---|
| Same event delivered twice | `dedupe_key` uniqueness → second send suppressed (`duplicate`) |
| Booking cancelled before a delayed reminder fires | Job removed on cancel; processor re-checks booking status anyway |
| SMS to a landline | Provider error → fallback to next channel (email) if available |
| Template variables missing for a locale override | Validation at save time; render falls back to default template |

## Requirements covered

FR-NOT-001 … FR-NOT-006, NFR-AVAIL-003.
