# 05 · Catalogue and policies

The appointment service catalogue, plus cross-capability building blocks: policies,
intake forms and taxes. The ordering catalogue (menus/products) is in [07](07-ordering.md).
Behaviour: [features/appointments.md](../features/appointments.md),
[features/payments.md](../features/payments.md#policies).
Conventions: [README §1](README.md#1-conventions).

```
service_categories ──< services ──< service_variants
                          ├──< location_services >── locations
                          ├──< service_resource_rules ──> resource_groups | resources
                          ├──> policies (cancellation, deposit, …)
                          └──> forms ──< form_versions ──< form_responses
tax_categories ──< tax_rates
```

**Inheritance rule.** Catalogue entities are defined once per organization. Locations
opt in (`location_services`) and may override a whitelisted set of fields; `NULL` in an
override column means "inherit".

---

## service_categories

**[base] [tenant] [soft] [i18n]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `name` | text | no | | |
| `description` | text | yes | | |
| `sort_order` | integer | no | `0` | |

## services

A bookable appointment type. **[base] [tenant] [soft] [ver] [i18n] [meta]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `category_id` | uuid | yes | | FK → `service_categories` |
| `name` | text | no | | |
| `description` | text | yes | | shown publicly and used by the agent |
| `agent_notes` | text | yes | | extra guidance for the agent only ("ask if this is a first visit") |
| `duration_minutes` | integer | no | | `CHECK (> 0)` |
| `buffer_before_minutes` | integer | no | `0` | blocks resources before the appointment (not shown to customer) |
| `buffer_after_minutes` | integer | no | `0` | clean-up time |
| `price_type` | text | no | `'fixed'` | `fixed` \| `from` (starting at) \| `free` \| `on_request` (agent says "price given at consultation") |
| `price_amount_minor` | bigint | yes | | required for `fixed`/`from` |
| `currency` | char(3) | yes | | null → organization default |
| `tax_category_id` | uuid | yes | | FK → `tax_categories` |
| `capacity` | integer | no | `1` | > 1 = group session ([FR-APT-009](../product/requirements.md#fr-apt--appointments)) |
| `min_notice_minutes` | integer | yes | | null → capability setting |
| `max_advance_days` | integer | yes | | null → capability setting |
| `slot_interval_minutes` | integer | yes | | start-time granularity; null → capability setting |
| `visibility` | text | no | `'public'` | `public` (customers, agent, staff) \| `staff_only` |
| `requires_confirmation` | boolean | no | `false` | true → bookings start `pending` until staff accept |
| `cancellation_policy_id` | uuid | yes | | FK → `policies` (type `cancellation`) |
| `payment_policy_id` | uuid | yes | | FK → `policies` (type `deposit`/`prepayment`/`card_guarantee`) |
| `intake_form_id` | uuid | yes | | FK → `forms` |
| `color` | text | yes | | |
| `image_file_id` | uuid | yes | | FK → `files` |
| `sort_order` | integer | no | `0` | |
| `status` | text | no | `'active'` | `active` \| `archived` |

## service_variants

Variants with their own duration/price ("Haircut – short hair 30 min / long hair 60 min").
A booking item references a variant when the service has any. **[base] [tenant] [soft] [i18n]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `service_id` | uuid | no | | FK → `services` |
| `name` | text | no | | |
| `duration_minutes` | integer | no | | |
| `price_amount_minor` | bigint | yes | | null → service price |
| `sort_order` | integer | no | `0` | |

## location_services

A service offered at a location, with overrides ([FR-APT-002](../product/requirements.md#fr-apt--appointments)).
**[base] [tenant] [ver]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `location_id` | uuid | no | | composite FK → `locations` |
| `service_id` | uuid | no | | FK → `services` |
| `is_enabled` | boolean | no | `true` | |
| `price_amount_minor` | bigint | yes | | override |
| `duration_minutes` | integer | yes | | override |
| `buffer_before_minutes` | integer | yes | | override |
| `buffer_after_minutes` | integer | yes | | override |
| `min_notice_minutes` | integer | yes | | override |
| `max_advance_days` | integer | yes | | override |
| `cancellation_policy_id` | uuid | yes | | override |
| `payment_policy_id` | uuid | yes | | override |

UNIQUE `(location_id, service_id)`.

## service_resource_rules

What a service needs to be performed ([FR-APT-003](../product/requirements.md#fr-apt--appointments)).
Each rule is satisfied by one resource from a group or a specific resource; all rules of
a service must be satisfied simultaneously. **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `service_id` | uuid | no | | FK → `services` ON DELETE CASCADE |
| `location_id` | uuid | yes | | null = applies at every location; otherwise location-specific rule set (replaces the null set for that location) |
| `resource_group_id` | uuid | yes | | FK → `resource_groups` |
| `resource_type` | text | yes | | e.g. any `staff` at the location who is linked to the service via a group |
| `quantity` | smallint | no | `1` | |
| `role` | text | no | `'primary'` | `primary` (the "with whom" the customer may choose — usually staff) \| `supporting` (room, chair, equipment) |
| `offset_start_minutes` | integer | no | `0` | resource needed from this offset (e.g. room needed only for the last 30 min) |
| `offset_end_minutes` | integer | yes | | null = until end |

`CHECK (num_nonnulls(resource_group_id, resource_type) = 1)`. A service with no rules
needs no resource (location-level availability only).

## policies

Reusable, versioned business rules used by services, reservation settings, ordering
settings and payment flows. Bookings/orders copy the rules into `policy_snapshot`, so
editing a policy never changes existing commitments. **[base] [tenant] [soft] [ver] [i18n]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `type` | text | no | | `cancellation` \| `deposit` \| `prepayment` \| `card_guarantee` \| `no_show` |
| `name` | text | no | | "Standard 24h", "Large party deposit" |
| `rules` | jsonb | no | | schema per type, below |
| `customer_text` | text | yes | | human wording the agent and pages read out; generated from rules if null |
| `is_default` | boolean | no | `false` | default for its type in the organization (partial unique) |

`rules` schemas (validated by Zod in `packages/contracts`):

```jsonc
// cancellation
{ "freeUntilMinutesBefore": 1440, "lateFee": { "type": "percent", "valueBps": 5000 },
  "allowCustomerSelfService": true, "rescheduleCountsAsCancellation": false }
// deposit / prepayment
{ "amount": { "type": "fixed", "amountMinor": 2000 } | { "type": "percent", "valueBps": 2000 },
  "appliesWhen": { "partySizeGte": 8, "serviceIds": [], "always": false },
  "dueWithinMinutes": 30, "refundableUntilMinutesBefore": 1440 }
// card_guarantee
{ "holdAmountMinor": 5000, "chargeOn": ["no_show", "late_cancellation"] }
// no_show
{ "fee": { "type": "fixed", "amountMinor": 2500 }, "graceMinutes": 15, "blockAfterCount": 3 }
```

## forms

Intake questionnaires attached to services (and later reservations/orders)
([FR-APT-008](../product/requirements.md#fr-apt--appointments)). **[base] [tenant] [soft]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `name` | text | no | | |
| `purpose` | text | no | | `booking_intake` \| `reservation` \| `order` \| `customer_profile` |
| `current_version_id` | uuid | yes | | FK → `form_versions` (published) |

## form_versions

Immutable once published. **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `form_id` | uuid | no | | FK → `forms` |
| `version` | integer | no | | UNIQUE `(form_id, version)` |
| `schema` | jsonb | no | | `{ fields: [{ key, type: text|number|boolean|select|multiselect|date|phone|email, label, translations, required, options, askedByAgent, sensitive }] }` |
| `published_at` | timestamptz | yes | | |
| `published_by_user_id` | uuid | yes | | |

Fields marked `sensitive` are never spoken back by the agent and are excluded from
summaries.

## form_responses

**[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `form_version_id` | uuid | no | | FK → `form_versions` |
| `subject_type` | text | no | | `booking` \| `order` \| `customer_profile` |
| `subject_id` | uuid | no | | |
| `customer_id` | uuid | yes | | |
| `answers` | jsonb | no | | `{ "<fieldKey>": value }` validated against the version schema |
| `submitted_via` | text | no | | `agent` \| `customer_app` \| `widget` \| `dashboard` |

Index: `(organization_id, subject_type, subject_id)`.

## tax_categories

**[base] [tenant] [soft]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `name` | text | no | | "Food", "Alcohol", "Services" |
| `code` | text | yes | | external tax code |

## tax_rates

Rates per category, optionally per location ([FR-ORD-008](../product/requirements.md#fr-ord--food-ordering)).
**[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `tax_category_id` | uuid | yes | | null = applies to all categories |
| `location_id` | uuid | yes | | null = all locations |
| `name` | text | no | | "GST 17%" |
| `rate_bps` | integer | no | | |
| `is_inclusive` | boolean | no | `false` | price includes tax |
| `applies_to` | text[] | no | `'{order,booking}'` | |
| `valid_from` | date | yes | | |
| `valid_until` | date | yes | | |
| `priority` | smallint | no | `0` | compound order |
