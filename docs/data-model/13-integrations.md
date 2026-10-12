# 13 · Integrations

Connections to external business systems (calendars now; POS/CRM later), mapping between
our ids and theirs, and outbound webhooks. Attendra is always the source of truth
([FR-INT-003](../product/requirements.md#fr-int--integrations)). Behaviour:
[features/integrations.md](../features/integrations.md). Conventions: [README §1](README.md#1-conventions).

```
integration_connections ──< calendar_links >── resources | locations
                        ──< sync_mappings      (our entity ↔ external object)
webhook_endpoints ──< webhook_deliveries
```

---

## integration_connections

An authorized link between an organization (optionally a location or a user) and an
external system. **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `location_id` | uuid | yes | | |
| `connected_by_user_id` | uuid | no | | |
| `provider` | text | no | | `google_calendar` \| `microsoft_calendar` \| `square` \| `toast` \| `clover` \| `hubspot` … |
| `category` | text | no | | `calendar` \| `pos` \| `crm` \| `accounting` |
| `status` | text | no | `'active'` | `active` \| `needs_reauth` \| `error` \| `disconnected` |
| `external_account_id` | text | yes | | e.g. Google account email / tenant id |
| `scopes` | text[] | no | `'{}'` | |
| `token_ciphertext` | bytea | no | | envelope-encrypted `{ accessToken, refreshToken, expiresAt }` |
| `data_key_ciphertext` | bytea | no | | |
| `master_key_id` | text | no | | |
| `settings` | jsonb | no | `'{}'` | provider-specific options |
| `last_sync_at` | timestamptz | yes | | |
| `last_error` | text | yes | | |
| `error_count` | integer | no | `0` | backoff / alerting |

## calendar_links

One external calendar linked to one resource (a staff member's calendar) or one
location. **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `integration_connection_id` | uuid | no | | FK ON DELETE CASCADE |
| `resource_id` | uuid | yes | | FK → `resources` |
| `location_id` | uuid | yes | | location-wide calendar (all bookings) |
| `external_calendar_id` | text | no | | |
| `direction` | text | no | `'push_and_busy'` | `push` (write our bookings) \| `busy` (read busy only) \| `push_and_busy` |
| `event_privacy` | text | no | `'details'` | `details` (customer name + service) \| `minimal` ("Booked") |
| `sync_token` | text | yes | | incremental sync cursor |
| `watch_channel_id` | text | yes | | push-notification channel |
| `watch_expires_at` | timestamptz | yes | | renewed by job |
| `status` | text | no | `'active'` | |

`CHECK (num_nonnulls(resource_id, location_id) = 1)`.

## sync_mappings

Generic mapping of our entities to external objects, used by every integration. Prevents
duplicates and echo loops. **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `integration_connection_id` | uuid | no | | FK ON DELETE CASCADE |
| `entity_type` | text | no | | `booking` \| `customer_profile` \| `order` \| `product` |
| `entity_id` | uuid | no | | |
| `external_type` | text | no | | `calendar_event` \| `pos_order` \| `pos_item` \| `crm_contact` |
| `external_id` | text | no | | |
| `external_etag` | text | yes | | |
| `content_hash` | text | yes | | hash of what we last pushed |
| `last_synced_at` | timestamptz | no | | |
| `sync_status` | text | no | `'synced'` | `synced` \| `pending` \| `failed` \| `deleted` |
| `last_error` | text | yes | | |

UNIQUE `(integration_connection_id, entity_type, entity_id, external_type)`;
UNIQUE `(integration_connection_id, external_type, external_id)`.

## webhook_endpoints

Organization-registered outbound webhooks ([FR-INT-004](../product/requirements.md#fr-int--integrations)).
**[base] [tenant] [soft]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `url` | text | no | | https only |
| `description` | text | yes | | |
| `event_types` | text[] | no | | subset of public events; `*` = all |
| `location_ids` | uuid[] | no | `'{}'` | empty = all |
| `secret_ciphertext` | bytea | no | | signing secret (HMAC-SHA256) |
| `data_key_ciphertext` | bytea | no | | |
| `master_key_id` | text | no | | |
| `status` | text | no | `'active'` | `active` \| `disabled` (auto-disabled after sustained failures) |
| `api_version` | text | no | `'v1'` | payload version |

## webhook_deliveries

**[base-append] [tenant]** + `updated_at`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `webhook_endpoint_id` | uuid | no | | FK |
| `event_id` | uuid | no | | `outbox_events.id` |
| `event_type` | text | no | | |
| `attempt` | smallint | no | `1` | |
| `status` | text | no | `'pending'` | `pending` \| `succeeded` \| `failed` \| `abandoned` |
| `response_status` | smallint | yes | | |
| `response_body_excerpt` | text | yes | | first 1 KB |
| `duration_ms` | integer | yes | | |
| `next_attempt_at` | timestamptz | yes | | |

UNIQUE `(webhook_endpoint_id, event_id, attempt)`.
