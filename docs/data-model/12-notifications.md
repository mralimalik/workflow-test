# 12 · Notifications

Outbound messages to customers and staff (SMS, email, WhatsApp, push, in-app). Behaviour:
[features/notifications.md](../features/notifications.md). Conventions: [README §1](README.md#1-conventions).

```
notification_templates (platform defaults + org overrides)
        │ rendered by
        ▼
notifications (one row per message sent; partitioned)  ──> customers | users
push_devices (customer/user devices for push)
```

Staff alert preferences live in `memberships.notification_preferences`
([02](02-tenancy-and-access.md#memberships)); customer consent lives in
[`consents`](03-customers.md#consents).

---

## notification_templates

Platform default templates (`organization_id` null) and organization overrides. Lookup
order: org + location-specific → org → platform; locale falls back to the
organization's default, then `en`. **[base] [ver]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organization_id` | uuid | yes | | null = platform default |
| `location_id` | uuid | yes | | location-specific override |
| `event_key` | text | no | | `booking.confirmed`, `booking.reminder`, `booking.rescheduled`, `booking.cancelled`, `order.accepted`, `order.ready`, `payment.link`, `auth.otp`, `customer.welcome`, `handoff.staff_alert`, `task.assigned`, … |
| `channel` | text | no | | `sms` \| `email` \| `whatsapp` \| `push` \| `in_app` |
| `locale` | text | no | | |
| `subject` | text | yes | | email |
| `body` | text | no | | ICU MessageFormat with whitelisted variables (`{customer.firstName}`, `{booking.startsAtLocal}`, `{location.name}`, `{links.manage}`) |
| `html_body` | text | yes | | email (MJML compiled) |
| `provider_template_ref` | text | yes | | WhatsApp approved template name / SMS sender template where required |
| `is_active` | boolean | no | `true` | |

UNIQUE `(organization_id, location_id, event_key, channel, locale)` NULLS NOT DISTINCT.
Platform defaults for `auth.*` events cannot be overridden (security wording).

## notifications

One row per outbound message. Partitioned by month on `created_at`.
**[base-append] [tenant-nullable]** + `updated_at`. PK `(id, created_at)`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organization_id` | uuid | yes | | null for platform messages (OTP for customer app login) |
| `location_id` | uuid | yes | | |
| `recipient_type` | text | no | | `customer` \| `user` \| `address` (raw destination, e.g. invitation email) |
| `recipient_id` | uuid | yes | | |
| `channel` | text | no | | |
| `destination` | text | no | | E.164 / email / device token id (masked in logs) |
| `event_key` | text | no | | |
| `template_id` | uuid | yes | | |
| `locale` | text | no | | |
| `category` | text | no | | `transactional` \| `marketing` \| `security` \| `staff_alert` — consent rules differ ([features/notifications.md](../features/notifications.md#consent-and-suppression)) |
| `related_type` | text | yes | | `booking` \| `order` \| `payment` \| `handoff` \| `task` \| `conversation` |
| `related_id` | uuid | yes | | |
| `rendered` | jsonb | no | | `{ subject, body }` as sent (PII redacted after retention period) |
| `status` | text | no | `'queued'` | `queued` \| `scheduled` \| `sending` \| `sent` \| `delivered` \| `read` \| `failed` \| `bounced` \| `suppressed` \| `canceled` |
| `suppression_reason` | text | yes | | `no_consent` \| `opted_out` \| `quiet_hours` \| `invalid_destination` \| `duplicate` |
| `scheduled_for` | timestamptz | yes | | |
| `provider` | text | yes | | |
| `provider_credential_id` | uuid | yes | | |
| `provider_message_id` | text | yes | | for status webhooks |
| `segments` | smallint | yes | | SMS segments (usage) |
| `error_code` | text | yes | | |
| `error_message` | text | yes | | |
| `sent_at` | timestamptz | yes | | |
| `delivered_at` | timestamptz | yes | | |
| `dedupe_key` | text | yes | | e.g. `reminder:{bookingId}:{offset}`; UNIQUE with `created_at` where not null |

Indexes: `(organization_id, related_type, related_id)`, `(provider, provider_message_id)`.

## push_devices

Devices registered for push (web push now; iOS/Android with the mobile app). **[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `subject_type` | text | no | | `customer` \| `user` |
| `subject_id` | uuid | no | | |
| `platform` | text | no | | `web` \| `ios` \| `android` |
| `token` | text | no | | push token / web push subscription JSON; UNIQUE |
| `app_version` | text | yes | | |
| `locale` | text | yes | | |
| `last_seen_at` | timestamptz | no | `now()` | |
| `disabled_at` | timestamptz | yes | | provider reported invalid |

## notification_preferences (reserved)

Customer-level marketing preferences beyond consent (frequency, topics) — not needed for
v1; consent rows cover opt-in/out. Staff preferences use `memberships.notification_preferences`.
