# 02 · Tenancy and access

Organizations, their locations, capabilities and team access. Behaviour:
[features/organizations-and-access.md](../features/organizations-and-access.md).
Conventions: [README §1](README.md#1-conventions).

```
organizations ──< locations ──< location_capabilities
      │
      ├──< memberships >── users          memberships ──< membership_locations >── locations
      │         └── roles
      ├──< invitations
      └──< api_keys
```

---

## organizations

The tenant root. RLS on this table uses `id` instead of `organization_id`.
**[base] [ver]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `name` | text | no | | display name |
| `slug` | citext | no | | UNIQUE; used in URLs (`/o/{slug}`, public pages) |
| `legal_name` | text | yes | | invoices |
| `status` | text | no | `'active'` | `active` \| `restricted` (billing past due) \| `suspended` \| `closed` — lifecycle in [billing-and-plans](../features/billing-and-plans.md#access-states) |
| `industry` | text | yes | | informational + template selection; no behaviour depends on it |
| `country` | char(2) | no | | |
| `default_locale` | text | no | `'en'` | |
| `supported_locales` | text[] | no | `'{en}'` | must include `default_locale` ([FR-ORG-008](../product/requirements.md#fr-org--organizations-locations-team-and-access)) |
| `default_timezone` | text | no | | default for new locations |
| `default_currency` | char(3) | no | | |
| `logo_file_id` | uuid | yes | | FK → `files` |
| `brand` | jsonb | no | `'{}'` | `{ primaryColor, accentColor }` for customer-facing surfaces |
| `website_url` | text | yes | | |
| `support_email` | citext | yes | | |
| `support_phone_e164` | text | yes | | |
| `settings` | jsonb | no | `'{}'` | organization-level settings layer ([settings schema](../features/organizations-and-access.md#settings-and-inheritance)) |
| `require_mfa` | boolean | no | `false` | |
| `onboarding_state` | jsonb | no | `'{}'` | wizard progress; `{ completedSteps: [], completedAt }` |
| `created_by_user_id` | uuid | yes | | FK → `users` |
| `suspended_at` | timestamptz | yes | | |
| `suspension_reason` | text | yes | | |
| `closed_at` | timestamptz | yes | | |
| `data_retention` | jsonb | no | `'{}'` | per-type retention overrides within platform limits ([NFR-PRIV-002](../product/requirements.md#nfr-priv--privacy-and-compliance)) |

## locations

A branch. Every organization has ≥ 1. **[base] [tenant] [soft] [ver]**
Exposes `UNIQUE (organization_id, id)` for composite FKs.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `name` | text | no | | "Downtown" |
| `slug` | citext | no | | UNIQUE `(organization_id, slug) WHERE deleted_at IS NULL` |
| `status` | text | no | `'active'` | `active` \| `temporarily_closed` \| `inactive` |
| `timezone` | text | no | | IANA; every time computation for this location uses it |
| `currency` | char(3) | yes | | null → organization default |
| `supported_locales` | text[] | yes | | null → organization's; must be a subset |
| `default_locale` | text | yes | | null → organization's |
| `address_line1` | text | yes | | null allowed for virtual/online-only locations |
| `address_line2` | text | yes | | |
| `city` | text | yes | | |
| `region` | text | yes | | state/province |
| `postal_code` | text | yes | | |
| `country` | char(2) | no | | |
| `latitude` | numeric(9,6) | yes | | geocoded; used for "nearest location" routing and delivery |
| `longitude` | numeric(9,6) | yes | | |
| `phone_display_e164` | text | yes | | public contact number (may differ from agent numbers) |
| `email` | citext | yes | | |
| `description` | text | yes | | public page |
| `translations` | jsonb | no | `'{}'` | **[i18n]** for `name`, `description`, directions |
| `opening_schedule_id` | uuid | yes | | FK → `schedules` (purpose `opening_hours`) |
| `settings_override` | jsonb | no | `'{}'` | location layer of settings inheritance |
| `sort_order` | integer | no | `0` | |

Index: `(organization_id, status)`.

## location_capabilities

Which capabilities a location accepts, with capability-specific settings
([FR-ORG-004](../product/requirements.md#fr-org--organizations-locations-team-and-access)). **[base] [tenant] [ver]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `location_id` | uuid | no | | composite FK → `locations` |
| `capability` | text | no | | `appointments` \| `reservations` \| `ordering` \| `inquiries` \| `lodging` |
| `is_enabled` | boolean | no | `true` | |
| `settings` | jsonb | no | `'{}'` | capability layer of settings; schema per capability, documented in each feature doc |
| `enabled_at` | timestamptz | yes | | |

UNIQUE `(location_id, capability)`. Enabling a capability is checked against plan
entitlements ([09](09-platform-billing.md#plans)).

## roles

System roles (shared, `organization_id` null) and custom roles per organization
([FR-ORG-006](../product/requirements.md#fr-org--organizations-locations-team-and-access)). **[base] [ver]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organization_id` | uuid | yes | | null = system role. RLS: visible if null or own org |
| `key` | text | no | | `owner` \| `admin` \| `manager` \| `staff` \| `viewer` \| custom slug |
| `name` | text | no | | |
| `description` | text | yes | | |
| `permissions` | text[] | no | | permission keys from the [catalogue](../features/organizations-and-access.md#permission-catalogue); validated |
| `is_system` | boolean | no | `false` | system roles are immutable |

UNIQUE `(organization_id, key)` (with `NULLS NOT DISTINCT`).

## memberships

A user's access to one organization. **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `user_id` | uuid | no | | FK → `users` |
| `role_id` | uuid | no | | FK → `roles` |
| `location_scope` | text | no | `'all'` | `all` \| `selected` — `selected` uses `membership_locations` |
| `status` | text | no | `'active'` | `active` \| `suspended` |
| `staff_member_id` | uuid | yes | | FK → `staff_members`: links the login to the person who delivers services (shows "my schedule") |
| `title` | text | yes | | job title shown in the team list |
| `invited_by_user_id` | uuid | yes | | |
| `joined_at` | timestamptz | no | `now()` | |
| `notification_preferences` | jsonb | no | `'{}'` | staff alert preferences ([12](12-notifications.md)) |

UNIQUE `(organization_id, user_id)`. Constraint: at least one active `owner` membership
per organization (enforced in the access service; a trigger-free check on role change).

## membership_locations

Locations a `selected`-scope membership may access. Join table; no [base].

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organization_id` | uuid | no | | RLS |
| `membership_id` | uuid | no | | FK → `memberships` ON DELETE CASCADE |
| `location_id` | uuid | no | | composite FK → `locations` |

PK `(membership_id, location_id)`.

## invitations

**[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `email` | citext | no | | |
| `role_id` | uuid | no | | FK → `roles` |
| `location_scope` | text | no | `'all'` | |
| `location_ids` | uuid[] | no | `'{}'` | applied on acceptance |
| `token_hash` | bytea | no | | UNIQUE |
| `status` | text | no | `'pending'` | `pending` \| `accepted` \| `revoked` \| `expired` |
| `expires_at` | timestamptz | no | | 7 days |
| `invited_by_user_id` | uuid | no | | |
| `accepted_by_user_id` | uuid | yes | | |
| `accepted_at` | timestamptz | yes | | |

UNIQUE `(organization_id, email) WHERE status = 'pending'`.

## api_keys

Organization API keys for the public API ([FR-INT-005](../product/requirements.md#fr-int--integrations)). **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `name` | text | no | | |
| `prefix` | text | no | | first 8 chars shown in UI; UNIQUE |
| `secret_hash` | bytea | no | | SHA-256 of the full key |
| `permissions` | text[] | no | | subset of the permission catalogue |
| `location_scope` | text | no | `'all'` | |
| `location_ids` | uuid[] | no | `'{}'` | |
| `environment` | text | no | `'live'` | `live` \| `test` |
| `created_by_user_id` | uuid | no | | |
| `last_used_at` | timestamptz | yes | | updated at most once per minute |
| `expires_at` | timestamptz | yes | | |
| `revoked_at` | timestamptz | yes | | |
