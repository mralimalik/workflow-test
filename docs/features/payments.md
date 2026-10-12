# Customer payments

## Purpose

Let businesses require and collect payments from their customers — deposits,
prepayments, card guarantees, fees and order payments — according to their own policies,
safely, through Stripe Connect.

## Scope

- **In (Phase 3):** Stripe Connect onboarding, policies, payment links / checkout,
  deposit/prepayment flows for bookings, order payments, card guarantees with later
  charge, no-show and late-cancellation fees, refunds, application fees, reconciliation.
- **Out:** saved cards for one-tap pay (later), in-person card readers, payouts reporting
  UI (later). Attendra subscription billing is in [billing-and-plans](billing-and-plans.md).

## Concepts

- **Payable:** a booking or an order.
- **Policy:** [`policies`](../data-model/05-catalog-and-policies.md#policies) of type
  `deposit`, `prepayment`, `card_guarantee`, `no_show`, `cancellation`.

## Policies

Which policy applies:

| Payable | Source of policy (first match) |
|---|---|
| Appointment | `location_services.payment_policy_id` → `services.payment_policy_id` → org default policy of that type |
| Reservation | reservation settings policy whose `appliesWhen` matches (e.g. `partySizeGte: 8`) |
| Order | ordering settings `paymentMode` (`prepaid` / pay on pickup / pay on delivery) |

At creation the evaluated rules are copied into `policy_snapshot`, and `requires_payment`,
amount and due window are computed from the snapshot.

## Business rules

1. Payments are collected only if the organization's payment account has
   `charges_enabled`; otherwise policies requiring payment are disabled in the UI and
   ignored at runtime (with a dashboard warning).
2. The agent never takes card details by voice; it sends a payment link by SMS (or
   WhatsApp/email) and can wait on the call for confirmation (`payment.succeeded` event)
   ([FR-PAY-003](../product/requirements.md#fr-pay--customer-payments), [NFR-SEC-008](../product/requirements.md#nfr-sec--security)).
3. A payable that requires payment is `pending` / `pending_payment` until paid; if unpaid
   by `expires_at`, it becomes `expired` (allocations released / order dropped).
4. Card guarantee: a SetupIntent saves the card on the connected account; a fee is
   charged off-session only for `no_show` / late cancellation as the snapshot says, with
   a notification to the customer.
5. Refunds: up to captured − refunded; cancellation within the free window auto-refunds
   deposits if the snapshot says refundable; staff refunds require `payments.refund` and
   a reason; all refunds are audited.
6. Application fee per plan entitlement (`customerPayments.applicationFeeBps`), applied to
   each charge; refunded proportionally on refunds when `refund_application_fee`.
7. Currency = location currency; connected account must support it.
8. All Stripe calls use idempotency keys; all Stripe webhooks go through the inbound
   webhook store and are processed idempotently.

## Flows

```
booking requires deposit
  → bookings: status pending, requires_payment, payment row (requires_payment, expires_at)
  → payments: create Checkout Session on connected account (destination charge + app fee)
  → notifications: send payment.link (SMS) ; agent: "I've sent a secure link…"
  ← Stripe webhook checkout.session.completed / payment_intent.succeeded
  → payments: status succeeded → event payment.succeeded
  → bookings: amount_paid updated → status confirmed → booking.confirmed → confirmation SMS
```

## Data

[`payment_accounts`](../data-model/08-payments.md#payment_accounts),
[`payments`](../data-model/08-payments.md#payments),
[`refunds`](../data-model/08-payments.md#refunds),
[`policies`](../data-model/05-catalog-and-policies.md#policies),
[`inbound_webhook_events`](../data-model/14-system.md#inbound_webhook_events).

## API

| Method | Path | Permission |
|---|---|---|
| GET | `/orgs/{orgId}/payment-account` | `payments.read` |
| POST | `/orgs/{orgId}/payment-account/onboarding-link` | `payments.manage_account` |
| POST | `/orgs/{orgId}/payment-account/dashboard-link` | `payments.manage_account` (Stripe Express dashboard) |
| GET | `{L}/payments?status=&payableType=&from=` | `payments.read` |
| GET | `{L}/payments/{id}` | `payments.read` |
| POST | `{L}/bookings/{id}/payment-requests` · `{L}/orders/{id}/payment-requests` | `bookings.update` / `orders.manage` (send link manually) |
| POST | `{L}/payments/{id}/refunds` | `payments.refund` |
| POST | `{L}/bookings/{id}/charge-fee` | `payments.refund` (no-show / late cancellation fee per snapshot) |
| POST | `/public/payments/{id}/checkout` | public (signed link token) |
| POST | `/webhooks/stripe-connect` | Stripe signature |

## Events and jobs

Emits `payment.succeeded/failed/expired`, `refund.succeeded/failed`, `payment_account.updated`.
Jobs: `payments/expire-payment-link`, `payments/reconcile` (nightly, compares with Stripe),
`payments/charge-fee` (off-session).

## Permissions

`payments.read`, `payments.refund`, `payments.manage_account`.

## Edge cases

| Case | Handling |
|---|---|
| Customer pays after the payable expired | Webhook finds expired payable → automatic full refund + apology notification; if the slot is still free, offer re-booking link |
| Double payment (two links opened) | One payable has one active payment request; reissuing cancels the previous Checkout Session |
| Connected account becomes restricted | New payment-required bookings fall back per setting: `block` or `allow_without_payment`; owners alerted |
| Partial refund then cancellation | Refund only the remaining refundable amount per snapshot |

## Requirements covered

FR-PAY-001 … FR-PAY-006, NFR-SEC-008.
