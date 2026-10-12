# Organizations and access

## Purpose

Model each business as an organization with one or many locations, let each location
enable its own capabilities and override settings, and control exactly which team member
can do what, where.

## Scope

- **In:** organizations, locations, capabilities, settings inheritance, memberships,
  invitations, system roles, custom roles (Phase 2), permission checks, onboarding wizard
  and industry templates (Phase 2), organization suspension states.
- **Out:** franchise hierarchies (organization groups) — possible later as a parent
  entity above organizations.

## Concepts

Organization, location, capability, membership, role, effective settings — see the
[glossary](../product/glossary.md).

## Business rules

1. Creating an organization creates: the owner membership, one location (from the wizard),
   the organization-level agent, default notification templates link (platform defaults),
   and a trial subscription ([billing-and-plans](billing-and-plans.md)).
2. An organization always has ≥ 1 active owner and ≥ 1 location.
3. The number of locations, users and enabled capabilities is limited by entitlements;
   exceeding returns `403 plan_limit_reached`.
4. A location's timezone can be changed only if it has no future active bookings, or
   with explicit confirmation that shifts nothing (bookings are stored in UTC; local
   wall times of future bookings would change — the UI shows the affected count).
5. Deleting a location is a soft delete allowed only without future active bookings or
   open orders; its numbers and endpoints must be released or moved first.
6. Memberships with `location_scope = selected` see only those locations everywhere:
   API, real-time rooms, search, analytics.
7. Roles are permission sets; system roles cannot be edited; custom roles can only use
   catalogue permissions.
8. Settings inheritance: values resolve from the most specific layer that defines them
   (see below). Locked keys (set by plan or platform) cannot be overridden lower.

## Settings and inheritance

```
platform defaults  →  plan entitlements/locks  →  organizations.settings
   →  locations.settings_override  →  location_capabilities.settings
```

Resolution is done by `SettingsResolver`, cached as `org-settings` / `loc-settings`
([BACKEND.md §9.2](../../BACKEND.md#92-cache-catalogue)). Settings schema (Zod, in
contracts) — top-level keys:

| Key | Examples |
|---|---|
| `booking` | `minNoticeMinutes`, `maxAdvanceDays`, `slotIntervalMinutes`, `holdMinutes`, `allowAnyStaff`, `customerSelfService` |
| `reservations` | `maxPartySizeOnline`, `defaultTurnMinutes`, `lateArrivalGraceMinutes` |
| `ordering` | `autoAccept`, `defaultPrepMinutes`, `busyMode: { extraMinutes, pausedUntil }`, `scheduledOrdersMaxDays`, `tipsEnabled` |
| `notifications` | `reminderOffsetsMinutes: [1440, 120]`, `quietHours`, `staffAlerts` |
| `conversations` | `recording`, `retentionDays`, `transcriptRedaction` |
| `customers` | `customFields` schema, `requireEmail` |
| `locale` | `dateFormat`, `timeFormat`, `firstDayOfWeek` |

Each feature doc defines the semantics of its keys.

## Onboarding

Wizard steps (state in `organizations.onboarding_state`) ([FR-ORG-009](../product/requirements.md#fr-org--organizations-locations-team-and-access)):

1. Organization: name, country, default language(s), currency, industry (optional).
2. First location: address (geocoded), timezone (suggested), opening hours.
3. Capabilities: choose appointments / reservations / ordering / inquiries.
4. Catalogue: from template or blank — services + staff, or tables, or menu (CSV import).
5. Agent: name, greeting, tone, languages, handoff number.
6. Channel: buy a number or set up forwarding; copy widget snippet.
7. Test: talk to the agent in the browser; then go live.

Templates ([FR-ORG-010](../product/requirements.md#fr-org--organizations-locations-team-and-access))
are JSON documents managed by platform admins (stored as platform files or a
`templates` admin resource) that prefill steps 4–5; applying a template only creates
ordinary tenant data.

## Data

[`organizations`](../data-model/02-tenancy-and-access.md#organizations),
[`locations`](../data-model/02-tenancy-and-access.md#locations),
[`location_capabilities`](../data-model/02-tenancy-and-access.md#location_capabilities),
[`roles`](../data-model/02-tenancy-and-access.md#roles),
[`memberships`](../data-model/02-tenancy-and-access.md#memberships),
[`membership_locations`](../data-model/02-tenancy-and-access.md#membership_locations),
[`invitations`](../data-model/02-tenancy-and-access.md#invitations).

## API

| Method | Path | Permission |
|---|---|---|
| POST | `/orgs` | authenticated user |
| GET | `/orgs` | own memberships |
| GET · PATCH | `/orgs/{orgId}` | `organization.read` · `organization.update` |
| GET · PATCH | `/orgs/{orgId}/settings` | `organization.read` · `settings.update` |
| GET · POST | `/orgs/{orgId}/locations` | `locations.read` · `locations.create` |
| GET · PATCH · DELETE | `/orgs/{orgId}/locations/{locationId}` | `locations.read` · `locations.update` · `locations.delete` |
| GET · PATCH | `{L}/settings` | `locations.read` · `settings.update` |
| GET · PUT | `{L}/capabilities/{capability}` | `locations.read` · `locations.update` |
| GET | `{L}/settings/effective` | `locations.read` |
| GET | `/orgs/{orgId}/me` | member (own role, permissions, location scope) |
| GET | `/orgs/{orgId}/members` | `team.read` |
| PATCH · DELETE | `/orgs/{orgId}/members/{membershipId}` | `team.manage` |
| POST | `/orgs/{orgId}/ownership-transfer` | owner |
| POST | `/orgs/{orgId}/invitations/{id}/resend` | `team.manage` |
| GET · POST | `/orgs/{orgId}/invitations` | `team.manage` |
| DELETE | `/orgs/{orgId}/invitations/{id}` | `team.manage` |
| POST | `/invitations/{token}/accept` | invited user (authenticated) |
| GET · POST · PATCH · DELETE | `/orgs/{orgId}/roles[/{roleId}]` | `team.manage` (custom roles: entitlement) |
| GET | `/permissions` | authenticated user (catalogue) |
| GET · PATCH | `/orgs/{orgId}/onboarding` | `organization.update` |
| POST | `/orgs/{orgId}/onboarding/apply-template` | `organization.update` |

## Events and jobs

Events: `organization.created/updated/suspended`, `location.created/updated/capability_changed`,
`membership.created/updated/removed`, `role.updated`, `invitation.created/accepted`.
Jobs: `invitation-expiry` (daily).

## Permission catalogue

The single list of permission keys. Format `resource.action`. System role grants:
**O**wner, **A**dmin, **M**anager, **S**taff, **V**iewer.

| Permission | O | A | M | S | V | Notes |
|---|---|---|---|---|---|---|
| `organization.read` | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `organization.update` | ✓ | ✓ |  |  |  |  |
| `organization.delete` | ✓ |  |  |  |  | close organization |
| `settings.update` | ✓ | ✓ | ✓ |  |  | managers: location-level keys only |
| `locations.read` | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `locations.create` | ✓ | ✓ |  |  |  |  |
| `locations.update` | ✓ | ✓ | ✓ |  |  |  |
| `locations.delete` | ✓ | ✓ |  |  |  |  |
| `team.read` | ✓ | ✓ | ✓ | ✓ |  |  |
| `team.manage` | ✓ | ✓ |  |  |  | invite, change roles, remove |
| `billing.read` | ✓ | ✓ |  |  |  |  |
| `billing.manage` | ✓ | ✓ |  |  |  |  |
| `catalog.read` | ✓ | ✓ | ✓ | ✓ | ✓ | services, policies, forms, menus |
| `catalog.manage` | ✓ | ✓ | ✓ |  |  |  |
| `resources.read` | ✓ | ✓ | ✓ | ✓ | ✓ | staff members, resources, schedules |
| `resources.manage` | ✓ | ✓ | ✓ |  |  |  |
| `schedules.manage_own` | ✓ | ✓ | ✓ | ✓ |  | staff edit their own availability and time off |
| `bookings.read` | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `bookings.create` | ✓ | ✓ | ✓ | ✓ |  |  |
| `bookings.update` | ✓ | ✓ | ✓ | ✓ |  | reschedule, reassign, notes |
| `bookings.cancel` | ✓ | ✓ | ✓ | ✓ |  |  |
| `bookings.read_own_only` |  |  |  |  |  | restriction flag for custom roles: staff see only their own bookings |
| `orders.read` | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `orders.manage` | ✓ | ✓ | ✓ | ✓ |  | accept, status changes (kitchen) |
| `customers.read` | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `customers.manage` | ✓ | ✓ | ✓ | ✓ |  | edit profile, notes, tags |
| `customers.import` | ✓ | ✓ |  |  |  |  |
| `customers.export` | ✓ | ✓ |  |  |  |  |
| `conversations.read` | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `conversations.listen_recordings` | ✓ | ✓ | ✓ |  |  |  |
| `conversations.takeover` | ✓ | ✓ | ✓ | ✓ |  | live takeover |
| `handoffs.manage` | ✓ | ✓ | ✓ | ✓ |  |  |
| `tasks.manage` | ✓ | ✓ | ✓ | ✓ |  |  |
| `agents.read` | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `agents.manage` | ✓ | ✓ | ✓ |  |  | edit draft |
| `agents.publish` | ✓ | ✓ |  |  |  |  |
| `knowledge.manage` | ✓ | ✓ | ✓ |  |  |  |
| `channels.manage` | ✓ | ✓ |  |  |  | numbers, forwarding, widget |
| `notifications.manage` | ✓ | ✓ | ✓ |  |  | templates, reminders |
| `payments.read` | ✓ | ✓ | ✓ |  |  |  |
| `payments.refund` | ✓ | ✓ | ✓ |  |  |  |
| `payments.manage_account` | ✓ |  |  |  |  | Stripe Connect onboarding |
| `integrations.manage` | ✓ | ✓ |  |  |  | calendars, webhooks |
| `api_keys.manage` | ✓ | ✓ |  |  |  |  |
| `analytics.read` | ✓ | ✓ | ✓ |  | ✓ |  |
| `audit.read` | ✓ | ✓ |  |  |  |  |

## Edge cases

| Case | Handling |
|---|---|
| Last owner tries to leave | Rejected until ownership is transferred |
| Manager scoped to location A requests location B data | `404` (not `403`) to avoid revealing existence |
| Plan downgrade below current location count | Downgrade blocked until locations are deactivated, or excess locations become read-only at period end |
| User belongs to several organizations | Org switcher; sessions are per user, permissions per membership |

## Requirements covered

FR-ORG-001 … FR-ORG-010, NFR-SEC-001.
