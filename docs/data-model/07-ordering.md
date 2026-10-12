# 07 · Ordering

Menus, products, modifiers and orders for food ordering (and any future retail-style
ordering). Behaviour: [features/food-ordering.md](../features/food-ordering.md).
Conventions: [README §1](README.md#1-conventions).

```
menus ──< menu_categories ──< menu_items >── products ──< product_modifier_groups >── modifier_groups ──< modifier_options
menus ──< location_menus >── locations
products ──< location_products >── locations          (availability, price, stock per location)
orders ──< order_items ──< order_item_modifiers
       ──< order_events
       ──1 order_deliveries >── delivery_zones
       ──< payments ([08](08-payments.md))
```

**Catalogue model.** Products and modifier groups are defined once per organization and
reused across menus. A menu arranges products into categories and can override prices.
Locations choose which menus they serve and control per-product availability and stock.

Price resolution for a line: `location_products.price` → `menu_items.price` →
`products.base_price` (first non-null), plus selected modifier deltas
(`modifier_options.price_delta`, overridable per product).

---

## menus

**[base] [tenant] [soft] [ver] [i18n]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `name` | text | no | | "All day", "Breakfast", "Ramadan specials" |
| `description` | text | yes | | |
| `fulfillment_types` | text[] | no | `'{pickup,delivery,dine_in}'` | which fulfilment types this menu serves |
| `status` | text | no | `'active'` | `active` \| `archived` |
| `sort_order` | integer | no | `0` | |

Availability hours: a `schedules` row with `owner_type = 'menu'`, `purpose = 'menu_availability'`
per location ([04](04-scheduling-and-resources.md#schedules)); no schedule = available
whenever the location's ordering hours are open.

## location_menus

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organization_id` | uuid | no | | RLS |
| `location_id` | uuid | no | | composite FK → `locations` |
| `menu_id` | uuid | no | | FK → `menus` |
| `is_enabled` | boolean | no | `true` | |
| `priority` | smallint | no | `0` | when several menus are active, the order they are presented |

PK `(location_id, menu_id)`.

## menu_categories

**[base] [tenant] [soft] [i18n]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `menu_id` | uuid | no | | FK → `menus` |
| `name` | text | no | | "Starters", "Pizzas" |
| `description` | text | yes | | |
| `sort_order` | integer | no | `0` | |

## products

A sellable item. **[base] [tenant] [soft] [ver] [i18n] [meta]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `name` | text | no | | |
| `description` | text | yes | | |
| `agent_aliases` | text[] | no | `'{}'` | spoken names / misspellings to help recognition ("marg" → Margherita); also fed to STT vocabulary hints |
| `base_price_minor` | bigint | no | | |
| `currency` | char(3) | yes | | null → organization default |
| `tax_category_id` | uuid | yes | | FK → `tax_categories` |
| `image_file_id` | uuid | yes | | FK → `files` |
| `sku` | text | yes | | UNIQUE `(organization_id, sku) WHERE sku IS NOT NULL AND deleted_at IS NULL` |
| `dietary_tags` | text[] | no | `'{}'` | `vegetarian` \| `vegan` \| `halal` \| `kosher` \| `gluten_free` \| `dairy_free` \| `spicy` … |
| `allergens` | text[] | no | `'{}'` | EU 14 allergen keys; the agent only repeats what is listed ([FR-ORD-007](../product/requirements.md#fr-ord--food-ordering)) |
| `calories` | integer | yes | | |
| `prep_time_minutes` | integer | yes | | contributes to ETA |
| `is_alcohol` | boolean | no | `false` | age verification flows |
| `status` | text | no | `'active'` | `active` \| `archived` |

## menu_items

A product's placement in a menu category. **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `menu_category_id` | uuid | no | | FK → `menu_categories` ON DELETE CASCADE |
| `product_id` | uuid | no | | FK → `products` |
| `price_minor` | bigint | yes | | menu-level override |
| `is_featured` | boolean | no | `false` | agent may suggest it |
| `sort_order` | integer | no | `0` | |

UNIQUE `(menu_category_id, product_id)`.

## location_products

Per-location availability, pricing and stock ([FR-ORD-002](../product/requirements.md#fr-ord--food-ordering)).
**[base] [tenant] [location]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `product_id` | uuid | no | | FK → `products` |
| `is_available` | boolean | no | `true` | false = not sold here |
| `sold_out_until` | timestamptz | yes | | temporary "86" — available again after this instant; null with `is_sold_out` = indefinitely |
| `is_sold_out` | boolean | no | `false` | |
| `price_minor` | bigint | yes | | location override (highest precedence) |
| `stock_quantity` | integer | yes | | null = untracked; decremented in the order transaction |

UNIQUE `(location_id, product_id)`.

## modifier_groups

"Choose a size", "Extra toppings", "Remove ingredients". **[base] [tenant] [soft] [i18n]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `name` | text | no | | |
| `selection_min` | smallint | no | `0` | `> 0` = required |
| `selection_max` | smallint | no | `1` | `CHECK (selection_max >= selection_min)` |
| `max_quantity_per_option` | smallint | no | `1` | e.g. "extra cheese ×2" |
| `free_selections` | smallint | no | `0` | first N selections free |
| `kind` | text | no | `'add'` | `add` \| `remove` (no onions) \| `choice` (size) — affects how the agent phrases it and how the kitchen ticket prints |

## modifier_options

**[base] [tenant] [soft] [i18n]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `modifier_group_id` | uuid | no | | FK → `modifier_groups` |
| `name` | text | no | | |
| `agent_aliases` | text[] | no | `'{}'` | |
| `price_delta_minor` | bigint | no | `0` | may be negative |
| `is_default` | boolean | no | `false` | pre-selected |
| `linked_product_id` | uuid | yes | | option that is itself a product (combo side), for stock and kitchen routing |
| `allergens` | text[] | no | `'{}'` | |
| `dietary_tags` | text[] | no | `'{}'` | |
| `status` | text | no | `'active'` | |
| `sort_order` | integer | no | `0` | |

## product_modifier_groups

Attaches groups to products with optional overrides. **[tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organization_id` | uuid | no | | RLS |
| `product_id` | uuid | no | | FK ON DELETE CASCADE |
| `modifier_group_id` | uuid | no | | FK |
| `selection_min` | smallint | yes | | override |
| `selection_max` | smallint | yes | | override |
| `option_price_overrides` | jsonb | no | `'{}'` | `{ "<optionId>": deltaMinor }` (e.g. large pizza toppings cost more) |
| `sort_order` | integer | no | `0` | |

PK `(product_id, modifier_group_id)`.

## orders

Draft orders are the cart ([glossary](../product/glossary.md)). **[base] [tenant] [location] [meta]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `reference_code` | text | no | | `OR-` + 6 chars; UNIQUE `(organization_id, reference_code)` |
| `status` | text | no | `'draft'` | state machine below |
| `fulfillment_type` | text | no | | `pickup` \| `delivery` \| `dine_in` |
| `customer_id` | uuid | yes | | null only for anonymous drafts |
| `customer_profile_id` | uuid | yes | | |
| `source_channel` | text | no | | as `bookings.source_channel` |
| `conversation_id` | uuid | yes | | |
| `booking_id` | uuid | yes | | FK → `bookings`: pre-order for a reservation, or dine-in at a reserved table |
| `table_resource_id` | uuid | yes | | dine-in table |
| `menu_id` | uuid | yes | | menu used for pricing (snapshot reference) |
| `requested_for` | timestamptz | yes | | null = ASAP |
| `promised_at` | timestamptz | yes | | ETA given to the customer |
| `draft_expires_at` | timestamptz | yes | | drafts are swept after expiry |
| `subtotal_minor` | bigint | no | `0` | |
| `discount_minor` | bigint | no | `0` | |
| `tax_minor` | bigint | no | `0` | |
| `delivery_fee_minor` | bigint | no | `0` | |
| `service_fee_minor` | bigint | no | `0` | |
| `tip_minor` | bigint | no | `0` | |
| `total_minor` | bigint | no | `0` | |
| `amount_paid_minor` | bigint | no | `0` | |
| `currency` | char(3) | no | | |
| `payment_mode` | text | no | | `prepaid` \| `pay_on_pickup` \| `pay_on_delivery` |
| `payment_status` | text | no | `'not_required'` | as `bookings.payment_status` |
| `policy_snapshot` | jsonb | no | `'{}'` | |
| `customer_notes` | text | yes | | |
| `internal_notes` | text | yes | | |
| `locale` | text | yes | | |
| `placed_at` | timestamptz | yes | | |
| `accepted_at` | timestamptz | yes | | |
| `ready_at` | timestamptz | yes | | |
| `completed_at` | timestamptz | yes | | |
| `cancelled_at` | timestamptz | yes | | |
| `cancelled_by_type` | text | yes | | **[actor]** |
| `cancelled_by_id` | uuid | yes | | |
| `cancellation_reason` | text | yes | | |
| `rejection_reason` | text | yes | | `too_busy` \| `item_unavailable` \| `closing` \| `out_of_zone` \| other |
| `version` | integer | no | `1` | |

Indexes: `(organization_id, location_id, status, placed_at)` (kitchen queue),
`(customer_id, created_at DESC)`, `(organization_id, status, draft_expires_at) WHERE status = 'draft'`.

### State machine

```
draft ──► pending_payment ──► placed ──► accepted ──► preparing ──► ready ──► out_for_delivery ──► completed
  │             │                │           │            │           │              │
  └──► expired  └──► expired     └──► rejected└────────────┴───────────┴──────────────┴──► cancelled
                                                                       (ready ──► completed for pickup / dine-in)
```

`placed` = submitted to the business; `accepted` = business confirmed (automatically if
the location's auto-accept setting is on).

## order_items

**[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `order_id` | uuid | no | | FK ON DELETE CASCADE |
| `product_id` | uuid | no | | FK → `products` |
| `name_snapshot` | text | no | | |
| `unit_price_minor` | bigint | no | | resolved price at time of adding |
| `quantity` | integer | no | | `CHECK (> 0)` |
| `modifiers_total_minor` | bigint | no | `0` | per unit |
| `line_total_minor` | bigint | no | | `(unit + modifiers) × quantity` |
| `tax_minor` | bigint | no | `0` | |
| `notes` | text | yes | | "cut in half" |
| `sort_order` | smallint | no | `0` | |

## order_item_modifiers

**[tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | | PK |
| `organization_id` | uuid | no | | RLS |
| `order_item_id` | uuid | no | | FK ON DELETE CASCADE |
| `modifier_group_id` | uuid | no | | |
| `modifier_option_id` | uuid | no | | |
| `group_name_snapshot` | text | no | | |
| `option_name_snapshot` | text | no | | |
| `kind` | text | no | | snapshot of group kind (`add`/`remove`/`choice`) |
| `quantity` | smallint | no | `1` | |
| `price_delta_minor` | bigint | no | `0` | snapshot |

## order_events

Append-only history. Same shape as [`booking_events`](06-bookings.md#booking_events)
with `order_id` instead of `booking_id`; `type` values: `created`, `item_added`,
`item_updated`, `item_removed`, `status_changed`, `eta_changed`, `payment_updated`,
`note_added`. **[base-append] [tenant]**

## delivery_zones

**[base] [tenant] [location] [soft]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `name` | text | no | | |
| `shape` | text | no | | `radius` \| `polygon` |
| `radius_meters` | integer | yes | | for `radius`; measured from location coordinates |
| `polygon` | jsonb | yes | | GeoJSON Polygon for `polygon` |
| `fee_minor` | bigint | no | `0` | |
| `min_order_minor` | bigint | no | `0` | |
| `free_delivery_over_minor` | bigint | yes | | |
| `eta_minutes` | integer | no | | added to prep time |
| `priority` | smallint | no | `0` | smaller zones first |
| `is_active` | boolean | no | `true` | |

## order_deliveries

1:1 with delivery orders. **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `order_id` | uuid | no | | UNIQUE FK |
| `delivery_zone_id` | uuid | yes | | FK → `delivery_zones` |
| `customer_address_id` | uuid | yes | | source address (may be deleted later) |
| `address_snapshot` | jsonb | no | | full address at order time |
| `latitude` | numeric(9,6) | yes | | |
| `longitude` | numeric(9,6) | yes | | |
| `instructions` | text | yes | | |
| `provider` | text | no | `'self'` | `self` \| external courier key (future) |
| `external_delivery_id` | text | yes | | |
| `status` | text | no | `'pending'` | `pending` \| `assigned` \| `picked_up` \| `delivered` \| `failed` |
| `driver_name` | text | yes | | |
| `driver_phone_e164` | text | yes | | |
| `estimated_delivery_at` | timestamptz | yes | | |
| `delivered_at` | timestamptz | yes | | |

---

## Future: promotions

`promotions` (rules: percent/amount, product/category scope, min spend, schedule,
channels), `promo_codes` (code, usage limits, per-customer limit), and
`order_discounts` (applied lines with snapshots) — added by the ordering module in
Phase 4 ([FR-ORD-009](../product/requirements.md#fr-ord--food-ordering)) without changing
`orders` (which already carries `discount_minor`).
