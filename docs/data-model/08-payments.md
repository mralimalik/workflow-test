# 08 · Customer payments

Money flowing **from customers to businesses** through Stripe Connect: deposits,
prepayments, card guarantees, fees and order payments. Money flowing from businesses to
Attendra is [platform billing](09-platform-billing.md). Behaviour:
[features/payments.md](../features/payments.md). Conventions: [README §1](README.md#1-conventions).

```
organizations ──1 payment_accounts            (connected Stripe account)
bookings | orders ──< payments ──< refunds
```

Stripe is the processor; these tables are our ledger of intent and outcome. Every row
stores the Stripe ids needed to reconcile. Card data never touches Attendra.

---

## payment_accounts

The organization's connected account. **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `provider` | text | no | `'stripe'` | |
| `provider_account_id` | text | no | | `acct_...`; UNIQUE |
| `account_type` | text | no | `'express'` | `express` \| `standard` |
| `status` | text | no | `'onboarding'` | `onboarding` \| `active` \| `restricted` \| `disabled` |
| `charges_enabled` | boolean | no | `false` | |
| `payouts_enabled` | boolean | no | `false` | |
| `country` | char(2) | no | | |
| `default_currency` | char(3) | no | | |
| `requirements_due` | jsonb | no | `'{}'` | outstanding KYC items mirrored from Stripe |
| `onboarding_completed_at` | timestamptz | yes | | |

UNIQUE `(organization_id, provider)`. Locations use the organization's account; per-location
accounts are a possible extension (`location_id` nullable column) if franchises need it.

## payments

One attempt to collect a specific amount for a specific purpose. **[base] [tenant] [meta]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `location_id` | uuid | no | | |
| `payable_type` | text | no | | `booking` \| `order` |
| `payable_id` | uuid | no | | |
| `customer_id` | uuid | yes | | |
| `purpose` | text | no | | `deposit` \| `prepayment` \| `full_payment` \| `balance` \| `card_guarantee` \| `no_show_fee` \| `cancellation_fee` \| `tip` |
| `status` | text | no | `'requires_payment'` | `requires_payment` \| `processing` \| `requires_capture` (authorized hold) \| `succeeded` \| `failed` \| `canceled` \| `expired` \| `partially_refunded` \| `refunded` |
| `amount_minor` | bigint | no | | `CHECK (> 0)` |
| `amount_captured_minor` | bigint | no | `0` | |
| `amount_refunded_minor` | bigint | no | `0` | |
| `currency` | char(3) | no | | |
| `application_fee_minor` | bigint | no | `0` | Attendra's fee ([FR-PAY-006](../product/requirements.md#fr-pay--customer-payments)) |
| `collection_method` | text | no | | `payment_link` (sent by SMS/WhatsApp/email) \| `checkout_page` (customer app / widget) \| `saved_card` \| `in_person` (recorded manually) |
| `payment_link_url` | text | yes | | short-lived; also stored hashed-shortcode in our redirect service |
| `expires_at` | timestamptz | yes | | after this the payable may expire ([FR-PAY-004](../product/requirements.md#fr-pay--customer-payments)) |
| `provider` | text | no | `'stripe'` | |
| `provider_payment_intent_id` | text | yes | | UNIQUE where not null |
| `provider_checkout_session_id` | text | yes | | |
| `provider_charge_id` | text | yes | | |
| `payment_method_summary` | jsonb | no | `'{}'` | `{ brand, last4, wallet }` — display only |
| `failure_code` | text | yes | | |
| `failure_message` | text | yes | | |
| `succeeded_at` | timestamptz | yes | | |
| `idempotency_key` | text | no | | sent to Stripe; UNIQUE |
| `created_by_type` | text | no | | **[actor]** |
| `created_by_id` | uuid | yes | | |

Indexes: `(organization_id, payable_type, payable_id)`, `(organization_id, status, expires_at)`.

Effects: a `payment.succeeded` event makes the bookings/ordering module recompute
`amount_paid_minor` and `payment_status` on the payable and confirm it if payment was
the only thing pending.

## refunds

**[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `payment_id` | uuid | no | | FK → `payments` |
| `amount_minor` | bigint | no | | ≤ captured − refunded |
| `currency` | char(3) | no | | |
| `reason` | text | no | | `requested_by_customer` \| `cancellation_within_policy` \| `business_cancelled` \| `duplicate` \| `goodwill` \| `other` |
| `notes` | text | yes | | |
| `status` | text | no | `'pending'` | `pending` \| `succeeded` \| `failed` \| `canceled` |
| `refund_application_fee` | boolean | no | `true` | |
| `provider_refund_id` | text | yes | | UNIQUE where not null |
| `failure_reason` | text | yes | | |
| `idempotency_key` | text | no | | UNIQUE |
| `initiated_by_type` | text | no | | **[actor]** |
| `initiated_by_id` | uuid | yes | | |
| `succeeded_at` | timestamptz | yes | | |

---

## Future

- `customer_payment_methods` — saved cards per customer per connected account (Stripe
  customer + payment method ids) for one-tap payment in the customer app.
- `payouts` / `balance_transactions` mirrors for in-dashboard financial reporting.
- `disputes` mirror for chargebacks.
