# Food ordering

## Purpose

Let restaurants and takeaways take accurate orders by phone, widget, app and public page
— with modifiers, per-location menus and availability, pickup/delivery/dine-in, payment,
and a live kitchen queue.

## Scope

- **In (Phase 3):** menus, categories, products, modifier groups, location availability
  and stock, draft orders (cart), agent ordering tools, fulfilment types, delivery zones,
  taxes, tips, busy mode, kitchen queue, order lifecycle, payment links.
- **Out:** promotions (Phase 4), POS sync (integrations), third-party courier dispatch
  (later), kitchen printers via local agent (later; queue screen first).

## Concepts

Product, menu item, modifier group/option, draft order, fulfilment type — see
[glossary](../product/glossary.md) and [data model 07](../data-model/07-ordering.md).

## Business rules

1. A product is orderable at a location now if: the location has `ordering` enabled and
   is within ordering hours; a served menu containing it is available now and supports
   the fulfilment type; `location_products.is_available`, not sold out, stock > 0 if
   tracked; ordering not paused (busy mode).
2. Price per line = resolved price ([data model 07](../data-model/07-ordering.md)) +
   modifiers (respecting `free_selections` and product-level overrides) × quantity.
3. Modifier validation: each group's min/max selections and per-option max quantity;
   required groups must be answered before an item is added — the agent asks.
4. Totals: subtotal − discounts + taxes (exclusive) + delivery fee + service fee + tip;
   inclusive taxes are reported but not added. Rounding per currency at line level.
5. Delivery: address must fall in an active zone (smallest priority first); zone's
   `min_order_minor` must be met; fee waived over `free_delivery_over_minor`.
6. ETA = max(prep times in order) + queue load factor + busy-mode extra (+ zone ETA for
   delivery). `promised_at` is set at acceptance.
7. Scheduled orders (`requested_for`) allowed up to `ordering.scheduledOrdersMaxDays`,
   only within ordering hours of that day.
8. Draft orders expire after 30 minutes of inactivity (`draft_expires_at`).
9. Placing requires: a customer with a phone (for status updates), confirmation of the
   read-back, and payment per policy (`prepaid` → payment link; otherwise pay on
   pickup/delivery if the location allows it).
10. Stock decrements atomically at placement (`UPDATE … SET stock = stock - n WHERE stock >= n`);
    failure → item reported unavailable before placing.
11. Allergens/dietary: the agent states only listed tags, never guarantees safety, and
    suggests contacting staff for severe allergies (handoff reason `out_of_scope`)
    ([FR-ORD-007](../product/requirements.md#fr-ord--food-ordering)).
12. Auto-accept setting: on → `placed` becomes `accepted` immediately; off → staff accept
    or reject within `ordering.acceptTimeoutMinutes`, else the customer is notified and the
    order cancelled (refund if paid).

## Flows

### Agent order

```
"Can I get two large pepperoni, one without cheese, and a coke — for pickup?"
→ start_order(fulfillment=pickup) → search_menu("pepperoni") → add_item(product, size=large, qty=1)
→ add_item(product, size=large, remove=[cheese], qty=1) → add_item(coke)   (agent asks required choices)
→ get_order_summary → reads back every line, modifiers, total, ETA
→ customer confirms → place_order → if prepaid: send_payment_link → order waits in pending_payment
```

### Kitchen queue (dashboard)

Live columns: New → Accepted → Preparing → Ready (→ Out for delivery). Actions call
`POST {L}/orders/{id}/accept|reject|start|ready|dispatch|complete|cancel`. Real-time via
`order.*` events. Busy mode toggle in the header.

## Data

All tables in [data model 07](../data-model/07-ordering.md), plus
[`tax_rates`](../data-model/05-catalog-and-policies.md#tax_rates),
[`payments`](../data-model/08-payments.md#payments),
[`customer_addresses`](../data-model/03-customers.md#customer_addresses).

## API

Menu management:

| Method | Path | Permission |
|---|---|---|
| GET · POST · PATCH · DELETE | `/orgs/{orgId}/menus[/{id}]` | `catalog.*` |
| GET · POST · PATCH · DELETE | `/orgs/{orgId}/menus/{id}/categories[/{categoryId}]` | `catalog.*` |
| PUT | `/orgs/{orgId}/menus/{id}/categories/{categoryId}/items` | `catalog.manage` |
| GET · POST · PATCH · DELETE | `/orgs/{orgId}/products[/{id}]` | `catalog.*` |
| PUT | `/orgs/{orgId}/products/{id}/modifier-groups` | `catalog.manage` |
| GET · POST · PATCH · DELETE | `/orgs/{orgId}/modifier-groups[/{id}]` (+ options) | `catalog.*` |
| POST | `/orgs/{orgId}/menus/import` | `catalog.manage` (CSV, async) |
| GET · PUT | `{L}/menus` | `catalog.manage` (which menus are served) |
| GET · PATCH | `{L}/products/{productId}` | `orders.manage` (availability, sold out, price, stock) |
| GET · POST · PATCH · DELETE | `{L}/delivery-zones[/{id}]` | `catalog.*` |
| PATCH | `{L}/ordering/busy-mode` | `orders.manage` |

Orders:

| Method | Path | Permission |
|---|---|---|
| GET | `{L}/orders?status=&from=&to=` | `orders.read` |
| POST | `{L}/orders` | `orders.manage` (staff-entered, e.g. phone order taken by human) |
| GET | `{L}/orders/{id}` · `/events` | `orders.read` |
| POST | `{L}/orders/{id}/accept` · `reject` · `start` · `ready` · `dispatch` · `complete` · `cancel` · `eta` | `orders.manage` |
| GET | `/public/locations/{locationId}/menu?fulfillment=&at=` | public (cached) |
| POST | `/public/locations/{locationId}/orders` (draft) · PATCH items · POST `/place` | public with conversation/OTP token |
| GET | `/me/orders`, `/me/orders/{id}` | customer |

## Events and jobs

Emits `menu.changed`, `location_product.availability_changed`, `order.placed/accepted/status_changed/cancelled`.
Jobs: `holds/expire-draft-order`, `ordering/accept-timeout`, `payments/expire-payment-link`.

## Permissions

`catalog.*`, `orders.*` — [catalogue](organizations-and-access.md#permission-catalogue).

## Edge cases

| Case | Handling |
|---|---|
| Item sells out while in a draft | Revalidated at `place_order`; agent tells the customer and offers alternatives |
| Ambiguous speech ("a large with everything") | Agent must resolve to explicit options; "everything" is not a valid modifier — ask |
| Customer adds item from a menu not available now | Not offered; agent says when it is available |
| Delivery address outside zones | Offer pickup; reason `out_of_zone` if staff override is attempted |
| Payment link not paid | Order stays `pending_payment` until expiry → `expired`, kitchen never sees it |
| Kitchen overloaded | Busy mode (extra minutes or pause until time); agent quotes updated ETA or says ordering is paused |

## Requirements covered

FR-ORD-001 … FR-ORD-009, FR-PAY-003.
