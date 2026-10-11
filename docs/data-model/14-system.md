# 14 · System tables

Cross-cutting infrastructure tables used by every module: audit, outbox, idempotency,
inbound webhooks, files and feature flags. Usage rules are in [BACKEND.md](../../BACKEND.md).
Conventions: [README §1](README.md#1-conventions).

---

## audit_logs

Who did what to which record — for security, compliance and support
([NFR-SEC-007](../product/requirements.md#nfr-sec--security)). Append-only; partitioned by
month on `occurred_at`; the app role has `INSERT` and `SELECT` only. PK `(id, occurred_at)`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | | |
| `occurred_at` | timestamptz | no | `now()` | partition key |
| `organization_id` | uuid | yes | | null for platform-level actions; RLS for tenant rows |
| `location_id` | uuid | yes | | |
| `actor_type` | text | no | | `user` \| `customer` \| `platform_admin` \| `agent` \| `system` \| `api_key` |
| `actor_id` | uuid | yes | | |
| `impersonation_session_id` | uuid | yes | | set when an admin acts as a user |
| `action` | text | no | | `<resource>.<verb>`: `booking.cancelled`, `service.updated`, `member.role_changed`, `provider_credential.created`, `auth.login_failed`, `refund.created` … |
| `target_type` | text | yes | | |
| `target_id` | uuid | yes | | |
| `changes` | jsonb | no | `'{}'` | field diff `{ field: [old, new] }` with secrets/PII masked |
| `context` | jsonb | no | `'{}'` | `{ reason, conversationId, ... }` |
| `request_id` | text | yes | | |
| `ip` | inet | yes | | |
| `user_agent` | text | yes | | |

Indexes: `(organization_id, occurred_at DESC)`, `(organization_id, target_type, target_id, occurred_at DESC)`,
`(actor_type, actor_id, occurred_at DESC)`.

## outbox_events

Transactional outbox ([BACKEND §10.1](../../BACKEND.md#101-domain-events)). Rows are
written in the same transaction as the domain change and published by the relay.
Partitioned by month on `created_at`; published partitions are dropped after 14 days.
PK `(id, created_at)`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | | UUIDv7 → natural order |
| `created_at` | timestamptz | no | `now()` | |
| `organization_id` | uuid | yes | | |
| `aggregate_type` | text | no | | `booking`, `order`, … |
| `aggregate_id` | uuid | no | | |
| `event_type` | text | no | | `booking.confirmed` |
| `event_version` | smallint | no | `1` | payload schema version |
| `payload` | jsonb | no | | validated against `packages/contracts/events` |
| `trace_context` | jsonb | no | `'{}'` | W3C traceparent, requestId, actor |
| `published_at` | timestamptz | yes | | |
| `attempts` | smallint | no | `0` | |
| `last_error` | text | yes | | |

Index: `(created_at) WHERE published_at IS NULL`. The outbox is written and read only by
the outbox module under the platform scope (no tenant RLS on this table; the app role can
only `INSERT`, the relay role can `SELECT/UPDATE`).

## inbound_webhook_events

Every webhook received from a provider, stored before processing for idempotency and
replay ([BACKEND §5.11](../../BACKEND.md#511-webhooks-inbound)). Partitioned by month.
PK `(id, received_at)`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | | |
| `received_at` | timestamptz | no | `now()` | |
| `provider` | text | no | | `stripe` \| `stripe_connect` \| `twilio` \| `google` \| `microsoft` \| `meta` |
| `provider_event_id` | text | no | | UNIQUE `(provider, provider_event_id, received_at)`; dedupe also checked in Redis for 7 days |
| `event_type` | text | no | | |
| `organization_id` | uuid | yes | | resolved during processing |
| `payload` | jsonb | no | | raw (sensitive fields stripped) |
| `signature_valid` | boolean | no | | invalid ones are stored with `status = 'rejected'` for security monitoring |
| `status` | text | no | `'received'` | `received` \| `processing` \| `processed` \| `failed` \| `ignored` \| `rejected` |
| `attempts` | smallint | no | `0` | |
| `processed_at` | timestamptz | yes | | |
| `error` | text | yes | | |

## idempotency_keys

Stored responses for idempotent POSTs ([BACKEND §5.9](../../BACKEND.md#59-idempotency)).
**[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `scope` | text | no | | `{realm}:{subjectId}:{method}:{routeTemplate}` (or `agent:{conversationId}`) |
| `key` | text | no | | client-provided |
| `request_hash` | bytea | no | | SHA-256 of canonical body |
| `status` | text | no | `'in_progress'` | `in_progress` \| `completed` |
| `response_status` | smallint | yes | | |
| `response_body` | jsonb | yes | | |
| `resource_type` | text | yes | | |
| `resource_id` | uuid | yes | | |
| `expires_at` | timestamptz | no | | created + 24 h |

UNIQUE `(scope, key)`. Cleaned nightly.

## files

Metadata for every stored object (uploads, recordings, exports, knowledge documents).
Bytes live in object storage; access only via short-lived signed URLs. **[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organization_id` | uuid | yes | | null for platform/customer-owned files; RLS for tenant rows |
| `owner_type` | text | no | | `organization` \| `customer` \| `user` \| `platform` |
| `owner_id` | uuid | yes | | |
| `purpose` | text | no | | `logo` \| `avatar` \| `service_image` \| `product_image` \| `recording` \| `knowledge_document` \| `export` \| `attachment` |
| `storage_provider` | text | no | | `s3` \| `azure_blob` \| `local` |
| `bucket` | text | no | | |
| `object_key` | text | no | | UNIQUE `(bucket, object_key)`; never derived from user input |
| `content_type` | text | no | | validated by magic bytes |
| `size_bytes` | bigint | no | | |
| `checksum_sha256` | bytea | yes | | |
| `original_name` | text | yes | | sanitized |
| `visibility` | text | no | `'private'` | `private` \| `public` (logos and catalogue images via CDN) |
| `status` | text | no | `'pending'` | `pending` (upload URL issued) \| `ready` \| `quarantined` (failed scan) \| `deleted` |
| `retention_until` | timestamptz | yes | | recordings/exports purge date |
| `uploaded_by_type` | text | no | | **[actor]** |
| `uploaded_by_id` | uuid | yes | | |
| `deleted_at` | timestamptz | yes | | |

## feature_flags

Global flag definitions ([FR-ADM-005](../product/requirements.md#fr-adm--platform-administration)). **[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `key` | text | no | | UNIQUE, e.g. `ordering.enabled`, `voice.azure_realtime` |
| `description` | text | no | | |
| `type` | text | no | `'boolean'` | `boolean` \| `string` \| `number` \| `json` |
| `default_value` | jsonb | no | | |
| `rollout_percent` | smallint | no | `0` | for booleans, bucketed by organization id |
| `is_archived` | boolean | no | `false` | |

## feature_flag_overrides

**[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `feature_flag_id` | uuid | no | | FK |
| `scope_type` | text | no | | `plan` \| `organization` \| `location` \| `user` |
| `scope_id` | uuid | no | | |
| `value` | jsonb | no | | |
| `expires_at` | timestamptz | yes | | |
| `set_by_platform_admin_id` | uuid | yes | | |

UNIQUE `(feature_flag_id, scope_type, scope_id)`.

Feature flags gate **rollout of code**; plan entitlements gate **what customers paid
for** ([09](09-platform-billing.md#plans)). The two are never used interchangeably.
