# 09 · Platform billing

Money flowing **from organizations to Attendra**: plans, prices, subscriptions,
discounts, usage and invoices. Stripe Billing is the billing engine (proration, invoices,
taxes, retries); these tables are the catalogue Attendra controls plus local mirrors of
Stripe objects for fast reads and entitlement checks. Behaviour:
[features/billing-and-plans.md](../features/billing-and-plans.md).
Conventions: [README §1](README.md#1-conventions).

```
plans ──< plan_prices                       (immutable prices; new price = new row)
plans ──< plan_usage_allowances >── usage_meters
organizations ──1 billing_customers ──< subscriptions ──< subscription_items
organizations ──< organization_entitlement_overrides
coupons ──< promotion_codes
subscriptions ──< invoices
organizations ──< usage_records             (our metering ledger → Stripe meter events)
```

**Ownership of truth.** Plans, prices, allowances, entitlements and usage are authored in
Attendra and pushed to Stripe. Subscription state, invoices and payment status are
authored by Stripe and mirrored here from webhooks (`inbound_webhook_events`) plus a
nightly reconciliation job.

---

## plans

Global. **[base] [ver]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `key` | text | no | | UNIQUE: `starter`, `growth`, `enterprise` |
| `name` | text | no | | |
| `description` | text | yes | | |
| `status` | text | no | `'active'` | `active` (sellable) \| `legacy` (existing subscribers only) \| `archived` |
| `is_public` | boolean | no | `true` | false = assigned by admins only (Enterprise/custom) |
| `entitlements` | jsonb | no | | see schema below |
| `trial_days` | integer | no | `14` | |
| `provider_product_id` | text | yes | | Stripe Product |
| `sort_order` | integer | no | `0` | |

`entitlements` (Zod-validated):

```jsonc
{
  "maxLocations": 3,                          // null = unlimited
  "maxUsers": 10,
  "maxPhoneNumbersPerLocation": 1,
  "capabilities": ["appointments", "inquiries"],
  "channels": ["voice_pstn", "web_widget", "in_app"],
  "features": { "customRoles": false, "apiAccess": false, "byok": false,
                "callRecording": true, "liveTakeover": false, "whiteLabelWidget": false },
  "customerPayments": { "enabled": true, "applicationFeeBps": 100 },
  "rateLimits": { "apiPerMinute": 0, "concurrentVoiceSessions": 5 },
  "retentionDaysMax": { "recordings": 90, "transcripts": 365 }
}
```

## plan_prices

**Immutable** once used. Changing what a plan costs = inserting a new price and
deactivating the old one; existing subscriptions keep the old price until migrated
([FR-BIL-004](../product/requirements.md#fr-bil--platform-billing)). **[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `plan_id` | uuid | no | | FK → `plans` |
| `interval` | text | no | | `month` \| `year` |
| `currency` | char(3) | no | | |
| `unit_amount_minor` | bigint | no | | price per unit (per location) |
| `billing_scheme` | text | no | `'per_unit'` | `per_unit` \| `tiered` |
| `tiers` | jsonb | yes | | for tiered (volume discounts on locations) |
| `is_active` | boolean | no | `true` | new subscriptions use active prices only |
| `provider_price_id` | text | yes | | Stripe Price; UNIQUE |
| `superseded_by_id` | uuid | yes | | FK → `plan_prices`: the price existing subscribers migrate to |
| `migration_policy` | text | no | `'grandfather'` | `grandfather` (keep forever) \| `migrate_at_renewal` (with notice) |
| `migration_notice_days` | integer | no | `30` | |

UNIQUE `(plan_id, interval, currency) WHERE is_active`.

## usage_meters

Global. **[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `key` | text | no | | UNIQUE: `ai_voice_minutes`, `ai_text_messages`, `sms_segments`, `whatsapp_conversations`, `phone_numbers` |
| `name` | text | no | | |
| `unit` | text | no | | `minute` \| `message` \| `segment` \| `conversation` \| `number_month` |
| `aggregation` | text | no | `'sum'` | |
| `provider_meter_id` | text | yes | | Stripe Billing Meter |

## plan_usage_allowances

Included usage and overage per plan and meter ([FR-BIL-006](../product/requirements.md#fr-bil--platform-billing)).
**[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `plan_id` | uuid | no | | FK → `plans` |
| `usage_meter_id` | uuid | no | | FK → `usage_meters` |
| `included_quantity` | numeric(14,3) | no | | per billing period, per location if `per_location` |
| `per_location` | boolean | no | `true` | |
| `overage_currency` | char(3) | no | | |
| `overage_unit_amount_minor` | numeric(14,4) | no | | sub-cent allowed (e.g. $0.004/segment) |
| `hard_cap_quantity` | numeric(14,3) | yes | | stop service beyond this (else bill overage) |
| `provider_overage_price_id` | text | yes | | Stripe metered Price |

UNIQUE `(plan_id, usage_meter_id, overage_currency)`.

## organization_entitlement_overrides

Per-organization exceptions granted by platform admins ([FR-BIL-009](../product/requirements.md#fr-bil--platform-billing)).
Merged over the plan's entitlements by `EntitlementsService`. **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `overrides` | jsonb | no | | partial entitlements object |
| `reason` | text | no | | |
| `expires_at` | timestamptz | yes | | |
| `granted_by_platform_admin_id` | uuid | no | | |

## billing_customers

**[base] [tenant]** UNIQUE `(organization_id)`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `provider_customer_id` | text | no | | Stripe Customer; UNIQUE |
| `billing_email` | citext | no | | |
| `billing_name` | text | no | | |
| `address` | jsonb | yes | | |
| `tax_ids` | jsonb | no | `'[]'` | `[{ type, value }]` |
| `default_payment_method_summary` | jsonb | no | `'{}'` | display only |
| `currency` | char(3) | no | | fixed after first subscription (Stripe rule) |
| `overage_spend_cap_minor` | bigint | yes | | organization-chosen monthly overage limit; null = no cap ([voice minute limits](../features/billing-and-plans.md#voice-minute-metering-and-limits)) |
| `usage_alert_thresholds_bps` | integer[] | no | `'{8000,10000}'` | alert at 80% / 100% of allowance |

## subscriptions

Mirror of the Stripe subscription. One current subscription per organization.
**[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `provider_subscription_id` | text | yes | | null while in a card-less trial created locally; UNIQUE |
| `plan_id` | uuid | no | | FK → `plans` |
| `plan_price_id` | uuid | no | | FK → `plan_prices` |
| `status` | text | no | | `trialing` \| `active` \| `past_due` \| `unpaid` \| `canceled` \| `incomplete` \| `incomplete_expired` \| `paused` |
| `quantity` | integer | no | `1` | billable locations |
| `current_period_start` | timestamptz | yes | | |
| `current_period_end` | timestamptz | yes | | |
| `trial_ends_at` | timestamptz | yes | | |
| `cancel_at_period_end` | boolean | no | `false` | |
| `canceled_at` | timestamptz | yes | | |
| `ended_at` | timestamptz | yes | | |
| `scheduled_change` | jsonb | yes | | pending downgrade / price migration: `{ planPriceId, quantity, effectiveAt, providerScheduleId }` |
| `discount` | jsonb | yes | | applied coupon snapshot `{ couponId, promotionCodeId, endsAt }` |
| `past_due_since` | timestamptz | yes | | drives the dunning ladder ([access states](../features/billing-and-plans.md#access-states)) |
| `provider_synced_at` | timestamptz | yes | | last webhook/reconcile |

UNIQUE `(organization_id) WHERE status NOT IN ('canceled','incomplete_expired')`.

## subscription_items

Mirror of Stripe subscription items: the base licensed price plus metered overage prices.
**[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `subscription_id` | uuid | no | | FK ON DELETE CASCADE |
| `kind` | text | no | | `base` \| `metered` \| `addon` |
| `plan_price_id` | uuid | yes | | for `base` |
| `usage_meter_id` | uuid | yes | | for `metered` |
| `provider_price_id` | text | no | | |
| `provider_item_id` | text | yes | | |
| `quantity` | integer | yes | | null for metered |

## coupons

Mirror of Stripe coupons, authored in the admin console ([FR-BIL-005](../product/requirements.md#fr-bil--platform-billing)).
Global. **[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `name` | text | no | | "Launch 50%" |
| `discount_type` | text | no | | `percent` \| `amount` |
| `percent_off_bps` | integer | yes | | |
| `amount_off_minor` | bigint | yes | | |
| `currency` | char(3) | yes | | required for `amount` |
| `duration` | text | no | | `once` \| `repeating` \| `forever` |
| `duration_in_months` | integer | yes | | for `repeating` |
| `applies_to_plan_ids` | uuid[] | no | `'{}'` | empty = all plans |
| `max_redemptions` | integer | yes | | |
| `times_redeemed` | integer | no | `0` | mirrored |
| `redeem_by` | timestamptz | yes | | |
| `is_active` | boolean | no | `true` | |
| `provider_coupon_id` | text | yes | | UNIQUE |

## promotion_codes

Customer-facing codes that apply a coupon, with restrictions. Global. **[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `coupon_id` | uuid | no | | FK → `coupons` |
| `code` | citext | no | | UNIQUE |
| `is_active` | boolean | no | `true` | |
| `first_time_only` | boolean | no | `false` | |
| `minimum_amount_minor` | bigint | yes | | |
| `minimum_amount_currency` | char(3) | yes | | |
| `max_redemptions` | integer | yes | | |
| `expires_at` | timestamptz | yes | | |
| `restricted_to_organization_id` | uuid | yes | | targeted offer |
| `provider_promotion_code_id` | text | yes | | UNIQUE |

## invoices

Mirror of Stripe invoices for the billing page. **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `subscription_id` | uuid | yes | | |
| `provider_invoice_id` | text | no | | UNIQUE |
| `number` | text | yes | | |
| `status` | text | no | | `draft` \| `open` \| `paid` \| `uncollectible` \| `void` |
| `currency` | char(3) | no | | |
| `subtotal_minor` | bigint | no | | |
| `discount_minor` | bigint | no | `0` | |
| `tax_minor` | bigint | no | `0` | |
| `total_minor` | bigint | no | | |
| `amount_paid_minor` | bigint | no | `0` | |
| `amount_due_minor` | bigint | no | | |
| `period_start` | timestamptz | yes | | |
| `period_end` | timestamptz | yes | | |
| `hosted_invoice_url` | text | yes | | |
| `pdf_url` | text | yes | | |
| `due_at` | timestamptz | yes | | |
| `paid_at` | timestamptz | yes | | |
| `attempt_count` | integer | no | `0` | |
| `next_payment_attempt_at` | timestamptz | yes | | |

## usage_records

Our append-only metering ledger. Written when billable usage happens (conversation ended,
SMS sent…), aggregated hourly and reported to Stripe meters. Partitioned by month on
`occurred_at`. **[base-append] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `location_id` | uuid | yes | | |
| `usage_meter_key` | text | no | | |
| `quantity` | numeric(14,3) | no | | e.g. 3.250 minutes |
| `occurred_at` | timestamptz | no | | partition key |
| `source_type` | text | no | | `conversation` \| `media_session` \| `notification` \| `phone_number` |
| `source_id` | uuid | no | | |
| `idempotency_key` | text | no | | `{meter}:{sourceType}:{sourceId}`; UNIQUE with `occurred_at` |
| `cost_estimate_minor` | numeric(14,4) | yes | | our provider cost (margin analytics) |
| `cost_currency` | char(3) | yes | | |
| `reported_at` | timestamptz | yes | | when included in a Stripe meter event |
| `provider_event_id` | text | yes | | |

PK `(id, occurred_at)`. Index `(organization_id, usage_meter_key, occurred_at)`.
