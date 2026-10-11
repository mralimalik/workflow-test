# Features

One document per feature, following the [feature template](../README.md#feature-document-template).
Endpoints are written relative to `/v1` and follow [BACKEND.md §5](../../BACKEND.md#5-api-conventions);
business endpoints are under `/orgs/{orgId}` and location-scoped ones under
`/orgs/{orgId}/locations/{locationId}` (abbreviated **`{L}`** in endpoint tables).

| Feature | Phase | Summary |
|---|---|---|
| [auth-and-identity](auth-and-identity.md) | 0–2 | Users, customers, platform admins; sessions, OTP, 2FA, bans |
| [organizations-and-access](organizations-and-access.md) | 0 | Organizations, locations, capabilities, settings inheritance, team, roles, permissions, onboarding |
| [customers](customers.md) | 1–3 | Global customer identity, per-business profiles, consent, customer app |
| [scheduling-and-availability](scheduling-and-availability.md) | 1 | Schedules, resources, availability engine, holds, double-booking protection |
| [appointments](appointments.md) | 1 | Service catalogue and appointment booking lifecycle |
| [reservations](reservations.md) | 3 | Table reservations: tables, areas, turn times, pacing |
| [food-ordering](food-ordering.md) | 3 | Menus, modifiers, orders, kitchen queue, delivery |
| [payments](payments.md) | 3 | Customer payments via Stripe Connect; policies |
| [billing-and-plans](billing-and-plans.md) | 2 | Plans, subscriptions, discounts, usage, dunning |
| [voice-agent](voice-agent.md) | 1–2 | Agent configuration, runtime, tools, guardrails, providers |
| [knowledge-base](knowledge-base.md) | 1–2 | FAQs, documents, URLs, retrieval |
| [channels](channels.md) | 1–4 | Phone, web widget, in-app, WhatsApp |
| [handoff](handoff.md) | 2–3 | Transfers, callbacks, live takeover, tasks |
| [notifications](notifications.md) | 2 | Transactional messages, reminders, staff alerts |
| [integrations](integrations.md) | 2–4 | Calendars, API keys, outbound webhooks, POS |
| [analytics](analytics.md) | 2–3 | Dashboards and metrics |
| [super-admin](super-admin.md) | 1–2 | Platform administration |
| [lodging](lodging.md) | Future | Hotel stays (design fit only) |
