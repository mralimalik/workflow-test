# Channels

## Purpose

Connect customers to the agent wherever they are — phone, the business's website, the
Attendra customer app, and later WhatsApp and SMS — through adapters on one conversation
model.

## Scope

- **Phone (Phase 2):** number purchase, forwarding from an existing number, inbound
  calls, recording, routing, transfers.
- **Web widget (Phase 2):** embeddable voice + text, origin restriction, identification.
- **In-app (Phase 2):** per-location agent inside the customer app.
- **WhatsApp (Phase 4):** text (then calls) via Meta Cloud API.
- **SMS conversational, outbound calls (Phase 4).**

## Concepts

Channel, channel endpoint, conversation, media session — [glossary](../product/glossary.md).

## Business rules

### Common

1. Every inbound contact resolves a `channel_endpoint`; paused/disabled endpoints use
   their `fallback` (forward / voicemail / message) and still create a conversation record.
2. Location resolution by `routing_mode`: `fixed` → endpoint location; `ask` → the agent
   calls `select_location`; `caller_history` → last location in the customer's profile,
   else ask; `nearest` → by stated area/postcode against location coordinates, else ask.
3. Concurrency limits per organization (`concurrentVoiceSessions` entitlement); above the
   limit, calls go to the endpoint fallback.

### Phone

4. **Purchased numbers:** chosen in the dashboard by country/area/type; regulatory bundles
   handled where the country requires (e.g. address/ID verification) before activation.
5. **Forwarding:** the business keeps its public number and sets call forwarding
   (always / no-answer / busy) to an Attendra number; the dashboard shows carrier-specific
   instructions and a "test forwarding" call check.
6. **Recording:** effective setting = endpoint config → location setting → plan
   allowance. When on, the greeting includes the disclosure configured for the location
   (and consent is recorded per `call_recording` purpose where required) ([FR-CHN-003](../product/requirements.md#fr-chn--channels)).
7. Max call duration and silence timeout from agent config; the agent wraps up politely
   before the hard limit.
8. DTMF: supported for `verify_code` fallback and simple menus if configured.

### Web widget

9. Loads only on `allowedOrigins`; the public key alone grants nothing beyond starting a
   conversation; each conversation gets a short-lived conversation token.
10. Identification policy (`requireIdentification`) decides when the widget collects
    phone/email + OTP: `before_booking` (default), `before_conversation`, or `never`
    (inquiries only).
11. Voice requires a user gesture and mic permission; text fallback always available.

### In-app

12. Requires a logged-in customer; conversation starts with `identity_assurance = session`.

### WhatsApp (future)

13. Business-initiated messages only via approved templates within Meta's rules; customer
    service window (24 h) respected; opt-in recorded as consent.

## Flows

Inbound phone call, web voice and text flows are specified in
[ARCHITECTURE.md §6.2–6.3](../../ARCHITECTURE.md#62-inbound-phone-call).

## Data

[`phone_numbers`](../data-model/10-channels-and-conversations.md#phone_numbers),
[`channel_endpoints`](../data-model/10-channels-and-conversations.md#channel_endpoints),
[`conversations`](../data-model/10-channels-and-conversations.md#conversations),
[`media_sessions`](../data-model/10-channels-and-conversations.md#media_sessions),
[`messages`](../data-model/10-channels-and-conversations.md#messages).

## API

Business:

| Method | Path | Permission |
|---|---|---|
| GET | `/orgs/{orgId}/phone-numbers/available?country=&areaCode=&type=` | `channels.manage` |
| POST | `/orgs/{orgId}/phone-numbers` (purchase) | `channels.manage` + entitlement |
| GET · PATCH · DELETE | `/orgs/{orgId}/phone-numbers/{id}` (release) | `channels.manage` |
| POST | `/orgs/{orgId}/phone-numbers/{id}/test-forwarding` | `channels.manage` |
| GET · POST | `/orgs/{orgId}/channel-endpoints` | `channels.manage` |
| GET · PATCH · DELETE | `/orgs/{orgId}/channel-endpoints/{id}` | `channels.manage` |
| GET | `/orgs/{orgId}/channel-endpoints/{id}/embed-snippet` | `channels.manage` |

Public (widget / customer app):

| Method | Path | Auth |
|---|---|---|
| GET | `/public/widgets/{publicKey}/config` | widget key + origin |
| POST | `/public/conversations` | widget key + origin, or customer session (in-app) → conversation token + realtime client secret or text stream URL |
| POST | `/public/conversations/{id}/messages` (text, SSE response) | conversation token |
| POST | `/public/conversations/{id}/identify/start` · `/verify` | conversation token |
| POST | `/public/conversations/{id}/end` | conversation token |

Webhooks: `POST /webhooks/twilio/voice`, `/webhooks/twilio/status`,
`/webhooks/twilio/recording`, later `/webhooks/meta/whatsapp`. Media WebSocket:
`wss://media…/twilio?token=…`.

## Events and jobs

Emits `channel_endpoint.created/updated`, `phone_number.purchased/released`,
`conversation.started/ended`. Jobs: `conversation-post/copy-recording`,
`channels/number-cost-usage` (monthly usage record per number).

## Permissions

`channels.manage`.

## Edge cases

| Case | Handling |
|---|---|
| Forwarded call arrives with the business number as "To" and original caller lost | Use `ForwardedFrom`/`From` headers; if caller id missing, assurance `none` |
| Widget embedded on an unlisted origin | Config request rejected (`403`); owner sees attempts in endpoint diagnostics |
| Two endpoints for the same location and channel | Allowed (e.g. two numbers: sales line and support line) with separate agents/greetings |
| Number released by mistake | Grace period while provider allows re-purchase; admin can restore |

## Requirements covered

FR-CHN-001 … FR-CHN-008.
