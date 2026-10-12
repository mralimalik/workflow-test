# Voice agent

## Purpose

An AI front-desk agent that each business configures without code, which runs on any
channel, speaks the business's languages, acts only through safe server-side tools, and
knows when to hand off.

## Scope

- **In:** agent configuration and versioning, instruction composition, tool registry,
  identity verification, guardrails, provider resolution, test console, transcripts and
  post-conversation analysis, conversation review, live monitoring.
- **Out:** channel transport details → [channels](channels.md); handoff mechanics →
  [handoff](handoff.md); knowledge ingestion → [knowledge-base](knowledge-base.md).
- Architecture: [ARCHITECTURE.md §6](../../ARCHITECTURE.md#6-conversation-and-voice-architecture).

## Concepts

Agent, agent version, agent runtime, tool, model profile — [glossary](../product/glossary.md).

## Business rules

1. Every organization has an organization agent; a location agent, if present, replaces
   it for that location (no field-level merge — simpler to reason about).
2. Only **published** versions run in production conversations; the test console can
   run the draft.
3. The business controls persona, greeting, languages, custom instructions, which tools
   are disabled, verification strictness, handoff rules, call limits. It cannot add tools
   or change system/safety instructions.
4. Tools available in a conversation = tools of the location's enabled capabilities
   ∩ not disabled by the agent config ∩ allowed by identity assurance.
5. The agent must confirm (read back) before any write tool that commits: confirm
   booking, reschedule, cancel, place order.
6. Dates are always spoken with weekday and date ("Tuesday the 14th of October at 3 pm"),
   times in the location's timezone.
7. The agent never invents prices, policies, availability or facts: those come only from
   tool results and retrieved knowledge; otherwise it says it doesn't know and offers a
   callback ([FR-AGT-004](../product/requirements.md#fr-agt--agent)).

## Instruction composition

The runtime compiles instructions per conversation from versioned templates in code plus
tenant data (cached as `agent-ctx`):

```
[1 System & safety]        platform-owned, immutable: role, honesty, no advice, no card data,
                           confirmation rules, tool-use rules, handoff obligations
[2 Business profile]       org/location name, address, hours today/this week, timezone,
                           currency, capabilities, policies' customer_text
[3 Persona & language]     agent name, tone, formality, greeting, supported languages
[4 Capability playbooks]   per enabled capability: step-by-step flow (book / reserve / order / inquiry)
[5 Catalogue summary]      compact list of services/menu categories (details via tools, not inline)
[6 Business instructions]  customer-written text, inside a delimited block, lower precedence
                           than [1]; filtered for prompt-injection patterns at publish time
[7 Conversation context]   channel, identity assurance, known customer name, upcoming bookings summary
```

Large or frequently changing data (availability, full menus, FAQs) is never inlined; the
agent retrieves it through tools, which keeps instructions short and latency low.

## Tool registry

Tools are defined in code (`agent-runtime/tools`), each with a Zod input schema, an
output schema written for speech, required identity assurance, idempotency, and the
domain service it calls.

| Tool | Capability | Writes | Min. assurance |
|---|---|---|---|
| `get_business_info(topic)` | all | — | none |
| `search_knowledge(query)` | inquiries | — | none |
| `select_location(hint)` | central endpoints | — | none |
| `find_services(query)` | appointments | — | none |
| `check_availability(serviceId, variantId?, staffPreference?, dateRange, partOfDay?)` | appointments | — | none |
| `hold_slot(slotToken)` | appointments | hold | none |
| `confirm_booking(holdId, customer{name, phone?, email?}, answers?)` | appointments | ✓ | none (new booking) |
| `find_my_bookings()` | appointments, reservations | — | `caller_id` (lists only date/time/service), `otp_verified` for details |
| `reschedule_booking(bookingId, slotToken)` | appointments, reservations | ✓ | `otp_verified` or `session` (or `caller_id` if `verification.requireOtpForChanges = false`) |
| `cancel_booking(bookingId, reason)` | appointments, reservations | ✓ | same as reschedule |
| `check_reservation_availability(date, partySize, period?, area?)` | reservations | — | none |
| `hold_reservation(slotToken)` / `confirm_reservation(...)` | reservations | ✓ | none |
| `search_menu(query)` / `get_item_options(productId)` | ordering | — | none |
| `start_order(fulfillment)` / `add_item` / `update_item` / `remove_item` / `set_delivery_address` / `get_order_summary` | ordering | draft | none |
| `place_order(orderId)` | ordering | ✓ | none |
| `send_payment_link(payableType, payableId, channel)` | payments | ✓ | none |
| `check_order_status(referenceCode?)` | ordering | — | `caller_id` |
| `send_verification_code(channel)` / `verify_code(code)` | all | — | none — raises assurance to `otp_verified` |
| `take_message(message, callbackPhone?)` | inquiries | task | none |
| `transfer_to_human(reason)` | all | handoff | none |
| `end_conversation(reason)` | all | — | none |

**Slot tokens:** availability results return opaque signed tokens (location, service,
start, resources, expiry) so the model never fabricates a bookable time.

## Identity and verification

`conversations.identity_assurance`:

| Level | How reached | Allows |
|---|---|---|
| `none` | default | info, new bookings/orders (customer provides details) |
| `caller_id` | inbound number matches a customer | greet by name, list upcoming booking times |
| `otp_verified` | `verify_code` succeeded (SMS to the number on file) | view details, reschedule, cancel |
| `session` | customer app in-app channel | everything the customer could do in the app |

## Guardrails

- **Hard rules in code** (not model-dependent): handoff triggers
  ([handoff](handoff.md#business-rules)), max call duration, silence timeout, tool rate
  limits per conversation, maximum holds, refusal of card numbers (DTMF and speech
  patterns detected and the audio segment redacted from transcripts).
- Tool-call validation: schema, tenant/location scope, assurance level, slot-token
  signature, idempotency key `conversationId:toolCallId`.
- Output checks for text channels: no URLs except whitelisted business/payment links;
  PII masking in summaries.
- Prompt-injection hygiene: knowledge and business instructions are fenced as data;
  tool outputs are data, never instructions.

## Provider resolution

At conversation start the runtime resolves the model profile for modality
`realtime_voice` (or `text_chat` for text channels) using `ai_profile_assignments`:
`channel_endpoint → location → organization → plan → platform`, applying
`rollout_percent` buckets by conversation id. If the profile's credential is unhealthy
(circuit breaker), its `fallback_profile_id` is used. The resolved profile id is stored
on the conversation ([data model 11](../data-model/11-agents-and-ai.md)).

## Conversation review

After a conversation ends, a worker job finalizes the transcript, then uses the
`summarization`/`classification` profiles to produce `summary`, `intent`, `outcome`,
`sentiment`, `ai_resolved`. Staff can listen (permission), read, tag and mark
`review_status`; "needs improvement" conversations feed agent evals.

## Flows

Test console: dashboard → "Test agent" → choose location, channel mode (voice/text),
draft or published → `POST {L}/agents/{id}/test-sessions` → WebRTC/text session with a
`test` flag (no notifications sent, bookings created in a sandbox state `held` and
auto-released, or optionally real with confirmation).

Live monitor: managers open an active conversation → transcript deltas stream over
Socket.IO room `conv:{id}`; "take over" for widget/app ([handoff](handoff.md)).

## Data

[`agents`](../data-model/11-agents-and-ai.md#agents),
[`agent_versions`](../data-model/11-agents-and-ai.md#agent_versions),
[`ai_model_profiles`](../data-model/11-agents-and-ai.md#ai_model_profiles),
[`ai_profile_assignments`](../data-model/11-agents-and-ai.md#ai_profile_assignments),
[`conversations`](../data-model/10-channels-and-conversations.md#conversations),
[`messages`](../data-model/10-channels-and-conversations.md#messages),
[`conversation_events`](../data-model/10-channels-and-conversations.md#conversation_events),
[`media_sessions`](../data-model/10-channels-and-conversations.md#media_sessions).

## API

| Method | Path | Permission |
|---|---|---|
| GET | `/orgs/{orgId}/agents` | `agents.read` |
| GET · PATCH | `/orgs/{orgId}/agents/{id}` (draft, `If-Match`) | `agents.read` · `agents.manage` |
| POST | `/orgs/{orgId}/agents` (location agent) · DELETE `/agents/{id}` | `agents.manage` |
| POST | `/orgs/{orgId}/agents/{id}/publish` | `agents.publish` |
| GET | `/orgs/{orgId}/agents/{id}/versions[/{versionId}]` | `agents.read` |
| POST | `/orgs/{orgId}/agents/{id}/versions/{versionId}/restore` | `agents.manage` (copies into draft) |
| GET | `/orgs/{orgId}/agents/{id}/preview-instructions?locationId=` | `agents.manage` (compiled instructions for transparency) |
| POST | `{L}/agents/{id}/test-sessions` | `agents.manage` |
| GET | `{L}/conversations?channel=&outcome=&from=&q=` | `conversations.read` |
| GET | `{L}/conversations/{id}` · `/messages` · `/events` | `conversations.read` |
| GET | `{L}/conversations/{id}/recording` (signed URL) | `conversations.listen_recordings` |
| PATCH | `{L}/conversations/{id}` (tags, review_status) | `conversations.read` |
| GET | `{L}/conversations/active` | `conversations.read` |

Runtime-internal (media gateway ↔ api): tool execution goes through in-process module
calls in `media`; no public endpoint.

## Events and jobs

Emits `conversation.started/ended`, `agent.published`. Jobs: `conversation-post/*`,
`agent-evals/run` (on publish, optional).

## Permissions

`agents.*`, `conversations.*` — [catalogue](organizations-and-access.md#permission-catalogue).

## Edge cases

| Case | Handling |
|---|---|
| Caller speaks an unsupported language | Agent says (in default language and, if detectable, theirs) it can't help in that language → take message / handoff |
| Provider outage mid-call | Media gateway plays fallback prompt; handoff or message capture ([NFR-AVAIL-002](../product/requirements.md#nfr-avail--availability-and-reliability)) |
| Model calls a disabled or unknown tool | Rejected with a tool error the model can recover from; logged as `guardrail_triggered` |
| Business instructions contradict policy ("always give 50% discount") | System section wins; publish-time lint warns |
| Customer asks to speak to a human | Immediate handoff (hard rule) |

## Requirements covered

FR-AGT-001 … FR-AGT-010, NFR-PERF-003, NFR-SEC-008.
