# Billing and plans

## Purpose

Charge organizations for Attendra fairly and flexibly: per-location subscriptions with
included usage and overage, trials, upgrades/downgrades, discounts and offers, price
changes without breaking existing customers, and a clear path when payment fails.

## Scope

- **In (Phase 2):** plans and prices (admin), trials, checkout, subscription changes with
  proration, scheduled downgrades, coupons and promotion codes, price migration and
  grandfathering, usage metering and overage, invoices, billing portal, dunning and
  access states, entitlement enforcement. Custom enterprise pricing (Phase 3).
- **Out:** reseller/agency billing (later), credits/prepaid packs (later).

## Concepts

Plan, price, entitlement, usage meter, subscription — [glossary](../product/glossary.md).

## Pricing model

| Component | How it's billed | Stripe object |
|---|---|---|
| Base subscription | per billable location per month/year | licensed Price, `quantity = locations` |
| Included usage | allowance per location per period (e.g. 300 AI minutes) | — (our ledger) |
| Overage | per unit above allowance (AI minutes, SMS segments, WhatsApp conversations) | metered Price on a Billing Meter |
| Add-ons | extra phone numbers, extra seats, premium voice | licensed Price as extra item |
| Discounts | coupons / promotion codes | Coupon, Promotion Code |

Example (illustrative): Starter $99/location/month incl. 300 min; Growth $249 incl.
1,000 min; Enterprise custom. Annual = 2 months free. Final numbers TBD
([prd §12](../product/prd.md#12-open-questions)).

## Business rules

1. **Trial:** 14 days on Growth entitlements, no card. At trial end without a payment
   method → `restricted` access state (below). Adding a card converts to the chosen plan.
2. **Upgrade** (higher plan, more locations, monthly → annual): immediate, prorated
   (`proration_behavior = create_prorations`, invoice now).
3. **Downgrade** (lower plan, fewer locations, annual → monthly): scheduled at period end
   via subscription schedule; blocked if current usage exceeds the target entitlements
   (e.g. too many locations) until resolved
   ([FR-BIL-003](../product/requirements.md#fr-bil--platform-billing)).
4. **Price change on a plan** = new `plan_prices` row. New subscribers get it immediately.
   Existing subscribers: `grandfather` (stay on the old price indefinitely) or
   `migrate_at_renewal` (notice email `migration_notice_days` before, then a schedule
   phase switches the price at renewal) ([FR-BIL-004](../product/requirements.md#fr-bil--platform-billing)).
5. **Discounts:** coupons (percent/amount; once/repeating N months/forever; plan
   restrictions; max redemptions; redeem-by) and promotion codes (first-time only,
   minimum amount, expiry, targeted to one organization). One discount per subscription
   at a time (Stripe rule); admin can replace it.
6. **Quantity** = number of active, non-deleted locations. Adding a location increments
   quantity (prorated); deactivating decrements at period end.
7. **Usage:** every billable event writes a `usage_records` row (idempotent); hourly job
   aggregates unreported rows to Stripe meter events. Allowance is applied by pricing
   the metered Price with a free first tier equal to the allowance × quantity (or by
   reporting only overage — chosen per meter in implementation, documented in code).
8. **Hard caps:** when `hard_cap_quantity` is reached, the capability degrades (e.g. new
   calls go to the configured fallback) and owners are alerted at 80% and 100%.
9. Enterprise: custom prices (private `plan_prices`), entitlement overrides, invoices
   with bank transfer (Stripe `send_invoice`).

## Voice minute metering and limits

How AI minutes are measured and what happens when an allowance runs out, including with
several calls in progress at once.

1. **What is metered:** AI-handled audio time per media session (`media_sessions` with
   the agent connected), from answer to hang-up or transfer. Time after a transfer to a
   human is telephony-only, not AI minutes. Measured in seconds and reported to Stripe as
   decimal minutes (e.g. 3.25), so customers are not charged for rounding.
2. **Allowance is pooled** per organization per billing period:
   `included_quantity × billable locations`. Any location's calls draw from the same pool.
3. **Live tracking:** the media gateway increments a Redis counter
   `att:{env}:usage:{orgId}:{period}:ai_voice_seconds` every 10 s for each active
   session (heartbeat). At session end the exact duration is written to
   `usage_records`, and the counter is reconciled from Postgres hourly. Redis gives
   real-time balance checks; Postgres is the billing truth.
4. **Default: overage on, calls never cut.** When the allowance is used up, calls keep
   working and the extra minutes are billed as overage on the next invoice. In the
   "5 minutes left, two callers, and a third joins with 10 seconds left" case, all three
   calls are answered and continue normally. Usage beyond the pool is overage at the plan
   rate. Owners are alerted at 80% and 100% of the allowance.
5. **When a limit applies** (a plan without overage such as the trial, a plan
   `hard_cap_quantity`, or the organization's own spending cap
   `billing_customers.overage_spend_cap_minor`):
   - **Admission control at call start:** a new call is accepted only if the remaining
     balance is above a small reserve (default 60 s). Otherwise it goes to the endpoint
     `fallback` (forward to the business's number, voicemail or message), and the
     conversation is logged with `end_reason = usage_limit`.
   - **Calls already in progress are never dropped mid-sentence.** When the balance hits
     zero, each active call gets a wrap-up window (default 90 s, setting): the agent
     finishes the current task (e.g. confirms the booking it is holding), says it will
     have someone follow up if needed, and ends politely. The overrun is capped at
     wrap-up × concurrent calls, which is bounded by the `concurrentVoiceSessions`
     entitlement.
   - Overrun seconds during wrap-up are recorded. Under a hard cap they are absorbed
     (not billed); under a spending cap they count toward the next period's usage
     report as normal overage up to the cap.
6. **Concurrency** is a separate entitlement (`rateLimits.concurrentVoiceSessions`).
   It limits simultaneous calls regardless of remaining minutes; calls above it go to the
   fallback.
7. Text conversations (widget chat, WhatsApp) are metered separately
   (`ai_text_messages`, `whatsapp_conversations`) with the same pooling and limit rules.
8. **Later:** prepaid minute packs (top-ups) as one-time Stripe charges that add to the
   current period's pool.

## Overage billing and credit risk

Overage is billed **in arrears**; the base subscription is billed **in advance**. Controls
that keep unpaid overage small and bounded:

1. **Monthly overage on every plan.** Annual plans pay the base fee yearly, but usage is
   billed monthly through a separate monthly usage subscription item, so a year of
   overage never accumulates on one invoice.
2. **Early charge threshold.** When unbilled overage reaches a threshold (default $100,
   per currency), Stripe billing thresholds invoice and charge it immediately, mid-period.
3. **Risk-tiered overage caps.** New organizations get a default overage cap (e.g. $50 per
   period) that rises automatically after consecutive on-time payments (e.g. 3 invoices),
   or manually by admins (entitlement override). The organization can always set a lower
   cap themselves.
4. **Trials have no overage.** Trial usage is hard-capped at the trial allowance; a valid
   card is required to convert.
5. **Payment failure stops overage immediately.** While an invoice is past due, the
   organization is limited to its remaining included minutes (overage cap treated as 0);
   new usage beyond that goes to fallback.
6. **Card checks at signup/checkout:** Stripe card verification and Radar fraud rules.
7. **Dunning** per the access states below; unpaid after the ladder → written off and
   the organization closed; repeat sign-ups with the same payment fingerprint or owner
   identity are flagged for review.

Worst case per new organization ≈ one period's capped overage.

## Access states

Driven by `subscriptions.status` and `past_due_since` (dunning ladder) → `organizations.status`:

| Stage | Trigger | Organization status | Effect |
|---|---|---|---|
| Active | paid | `active` | full access |
| Grace | payment failed (day 0–7) | `active` | banner + emails; Stripe retries |
| Restricted | day 7+, or trial ended without card | `restricted` | dashboard works; agent keeps answering but only takes messages/callbacks (no new bookings/orders); no outbound SMS except transactional for existing bookings |
| Suspended | day 21+ | `suspended` | agent off (fallback forward/voicemail), dashboard read-only + billing page |
| Closed | canceled + 30 days | `closed` | data retained per policy, then deleted |

Platform admins can override with an expiring grace extension.

## Data

All tables in [data model 09](../data-model/09-platform-billing.md).

## API

Business audience:

| Method | Path | Permission |
|---|---|---|
| GET | `/plans` | authenticated (public plans + prices) |
| GET | `/orgs/{orgId}/billing` | `billing.read` (subscription, entitlements, usage this period) |
| POST | `/orgs/{orgId}/billing/checkout` | `billing.manage` (Stripe Checkout for first subscription) |
| POST | `/orgs/{orgId}/billing/preview-change` | `billing.manage` (proration preview) |
| POST | `/orgs/{orgId}/billing/change` | `billing.manage` (plan/interval/quantity) |
| POST | `/orgs/{orgId}/billing/cancel` · `/resume` | `billing.manage` |
| POST | `/orgs/{orgId}/billing/promotion-code` | `billing.manage` (apply code) |
| POST | `/orgs/{orgId}/billing/portal-session` | `billing.manage` (Stripe Customer Portal) |
| GET | `/orgs/{orgId}/billing/invoices` | `billing.read` |
| GET | `/orgs/{orgId}/billing/usage?from=&to=&meter=` | `billing.read` |

Admin audience: see [super-admin](super-admin.md#api). Webhooks: `POST /webhooks/stripe`.

## Events and jobs

Emits `subscription.changed`, `entitlements.changed`, `invoice.payment_failed`,
`usage.threshold_reached`. Jobs: `usage/report-to-stripe` (hourly), `billing/sync-stripe-object`,
`billing/dunning-transition` (daily), `billing/reconcile` (nightly), `billing/price-migration-notice`.

## Permissions

`billing.read`, `billing.manage` (owners and admins).

## Edge cases

| Case | Handling |
|---|---|
| Currency of billing customer fixed by Stripe | Chosen at first subscription from organization country; changing requires a new customer (admin) |
| Webhook arrives before local write | Upsert by provider id; reconciliation fixes ordering issues |
| Usage reported late (provider delay) | Usage records keep `occurred_at`; reporting includes the correct period timestamp within Stripe's allowed window |
| Organization deletes a location mid-period | Quantity decreases at period end (no refund mid-period) |

## Requirements covered

FR-BIL-001 … FR-BIL-009.
