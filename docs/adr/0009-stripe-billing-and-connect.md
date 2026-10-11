# ADR-0009 · Stripe Billing for subscriptions, Stripe Connect for customer payments

**Status:** Accepted · 2026-10-11

## Context

Two money flows: organizations pay Attendra (subscriptions per location, trials,
upgrades/downgrades with proration, coupons and promotion codes, price changes with
grandfathering, metered usage, dunning), and customers pay organizations (deposits,
prepayments, fees, orders) with Attendra optionally taking a fee.

## Decision

- **Stripe Billing** is the billing engine: Products/Prices mirror `plans`/`plan_prices`;
  subscriptions with quantity = billable locations; proration on upgrade; subscription
  schedules for period-end downgrades and price migrations; Coupons/Promotion Codes;
  Billing Meters for usage; Smart Retries + our dunning ladder; Customer Portal for
  payment methods/invoices.
- **Stripe Connect** (Express accounts by default) for customer payments; destination
  charges with `application_fee_amount`; payment links/Checkout so card data never
  touches Attendra (PCI SAQ-A scope).
- Attendra authors catalogue and usage; Stripe authors subscription/invoice state; local
  mirrors are updated from webhooks and reconciled nightly
  ([data model 09](../data-model/09-platform-billing.md)).

## Alternatives considered

- **Own billing engine.** Proration, tax, invoicing and dunning are large, regulated
  problems; not our differentiation.
- **Paddle / Lemon Squeezy (merchant of record).** Simplifies global tax but does not
  cover customer → business payments; Stripe covers both flows with one integration.

## Consequences

- Price changes create new Prices; old ones are kept for grandfathered subscriptions.
- Webhook processing must be idempotent and ordered per object (inbound webhook store).
- Countries where Stripe Connect is unavailable need an alternative processor later
  (the `payments.provider` column allows it).
