# 10 · Channels, conversations, handoff and tasks

The omnichannel core. Channel-specific details stay in channel adapters and in typed
`config` columns; everything downstream works with one conversation model.
Behaviour: [features/channels.md](../features/channels.md),
[features/voice-agent.md](../features/voice-agent.md), [features/handoff.md](../features/handoff.md).
Conventions: [README §1](README.md#1-conventions).

```
phone_numbers ──< channel_endpoints ──< conversations ──< media_sessions   (real-time audio legs)
                                                     ├──< messages          (turns: text, transcripts, tool calls)
                                                     ├──< conversation_events (trace)
                                                     ├──< handoffs >── handoff_targets
                                                     └──< tasks
conversations ──> agent_versions, customers, locations
```

Channel values used across the model (defined once in contracts):
`voice_pstn`, `web_widget`, `in_app`, `whatsapp`, `sms`, `email` (future).

---

## phone_numbers

Numbers Attendra provisions or that forward into Attendra ([FR-CHN-001](../product/requirements.md#fr-chn--channels)).
A number may back several channel endpoints (voice, SMS, WhatsApp). **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `e164` | text | no | | UNIQUE where `status <> 'released'` |
| `provider` | text | no | | `twilio` \| `telnyx` |
| `provider_credential_id` | uuid | no | | FK → `provider_credentials` (platform Twilio account or BYOK) |
| `provider_number_id` | text | yes | | Twilio `PN...` sid |
| `acquisition` | text | no | | `purchased` (bought via Attendra) \| `ported` \| `byo_provider` (customer's own Twilio) |
| `country` | char(2) | no | | |
| `number_type` | text | no | | `local` \| `mobile` \| `toll_free` |
| `capabilities` | text[] | no | | `voice`, `sms`, `mms`, `whatsapp` |
| `regulatory_bundle_ref` | text | yes | | provider compliance bundle where required |
| `forwarded_from_e164` | text | yes | | the business's own public number that forwards here (informational, for setup checks) |
| `status` | text | no | `'active'` | `pending` \| `active` \| `suspended` \| `released` |
| `monthly_cost_minor` | bigint | yes | | our cost |
| `cost_currency` | char(3) | yes | | |
| `purchased_at` | timestamptz | yes | | |
| `released_at` | timestamptz | yes | | |

## channel_endpoints

An addressable entry point on a channel belonging to an organization, optionally a
location ([glossary](../product/glossary.md)). **[base] [tenant] [soft] [ver]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `location_id` | uuid | yes | | null = organization-level (central number / multi-location widget) |
| `channel` | text | no | | |
| `name` | text | no | | "Downtown main line", "Website widget" |
| `status` | text | no | `'active'` | `active` \| `paused` (agent off: goes straight to fallback) \| `disabled` |
| `phone_number_id` | uuid | yes | | FK → `phone_numbers`; required for `voice_pstn`, `sms`, `whatsapp` |
| `public_key` | text | yes | | widget/in-app key (`wk_...`); UNIQUE; not a secret |
| `agent_id` | uuid | yes | | FK → `agents`; null → location agent → organization agent |
| `routing_mode` | text | no | `'fixed'` | `fixed` (location_id) \| `ask` (agent asks which location) \| `caller_history` (last location, else ask) \| `nearest` (by postcode/address, else ask) |
| `config` | jsonb | no | `'{}'` | channel-specific, discriminated by `channel` (below) |
| `fallback` | jsonb | no | | when the agent is unavailable/paused: `{ "mode": "forward" \| "voicemail" \| "message", "forwardTo": "+1...", "message": "..." }` |

UNIQUE `(phone_number_id, channel) WHERE deleted_at IS NULL`.

`config` by channel:

```jsonc
// voice_pstn
{ "recording": "inherit" | "on" | "off", "recordingDisclosure": "This call may be recorded…",
  "maxCallMinutes": 15, "greetingOverride": null, "dtmfMenu": null }
// web_widget
{ "allowedOrigins": ["https://smilecare.com"], "modes": ["voice", "text"],
  "theme": { "position": "bottom-right", "launcherText": "Talk to us" },
  "requireIdentification": "before_booking" | "before_conversation" | "never",
  "maxSessionMinutes": 10 }
// in_app
{ "modes": ["voice", "text"] }
// whatsapp (future)
{ "wabaId": "...", "phoneNumberId": "...", "templateNamespace": "..." }
```

## conversations

One interaction on one channel from start to end. **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `location_id` | uuid | yes | | null until resolved (central number) |
| `channel_endpoint_id` | uuid | no | | FK |
| `channel` | text | no | | denormalized |
| `direction` | text | no | `'inbound'` | `inbound` \| `outbound` |
| `status` | text | no | `'active'` | `active` \| `waiting_for_human` \| `with_human` \| `ended` |
| `customer_id` | uuid | yes | | identified customer |
| `customer_profile_id` | uuid | yes | | |
| `identity_assurance` | text | no | `'none'` | `none` \| `caller_id` (unverified phone match) \| `otp_verified` \| `session` (logged-in customer app) — gates which tools may touch existing bookings ([voice-agent](../features/voice-agent.md#identity-and-verification)) |
| `participant_address` | text | yes | | caller E.164, widget visitor id, WhatsApp wa_id |
| `agent_id` | uuid | yes | | |
| `agent_version_id` | uuid | yes | | FK → `agent_versions`: exact configuration used ([FR-AGT-002](../product/requirements.md#fr-agt--agent)) |
| `model_profile_id` | uuid | yes | | FK → `ai_model_profiles`: resolved at start |
| `locale` | text | yes | | detected/selected language |
| `started_at` | timestamptz | no | `now()` | |
| `ended_at` | timestamptz | yes | | |
| `end_reason` | text | yes | | `completed` \| `customer_hung_up` \| `agent_ended` \| `transferred` \| `timeout` \| `error` \| `max_duration` \| `usage_limit` |
| `intent` | text | yes | | `book` \| `reschedule` \| `cancel` \| `order` \| `reserve` \| `inquiry` \| `complaint` \| `other` (classified post-conversation) |
| `outcome` | text | yes | | `booking_created` \| `booking_changed` \| `booking_cancelled` \| `order_placed` \| `information_provided` \| `handed_off` \| `callback_scheduled` \| `abandoned` \| `no_action` |
| `ai_resolved` | boolean | yes | | true if resolved without a human (containment) |
| `sentiment` | text | yes | | `positive` \| `neutral` \| `negative` |
| `summary` | text | yes | | generated |
| `tags` | text[] | no | `'{}'` | staff/auto tags |
| `review_status` | text | no | `'none'` | `none` \| `good` \| `needs_improvement` — staff QA ([dashboard calls](../features/voice-agent.md#conversation-review)) |
| `metrics` | jsonb | no | `'{}'` | `{ turns, avgLatencyMs, p95LatencyMs, interruptions, toolCalls, toolErrors, silenceMs }` |
| `cost` | jsonb | no | `'{}'` | `{ audioInSeconds, audioOutSeconds, inputTokens, outputTokens, telephonySeconds, estimatedCostMinor, currency }` |

Indexes: `(organization_id, location_id, started_at DESC)`, `(organization_id, customer_id, started_at DESC)`,
`(organization_id, status) WHERE status <> 'ended'`.

## media_sessions

A real-time audio session in a conversation: a PSTN call leg, a WebRTC session, a
transferred leg, later a WhatsApp call. **[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `conversation_id` | uuid | no | | FK |
| `transport` | text | no | | `pstn` \| `webrtc` \| `whatsapp_call` \| `sip` |
| `role` | text | no | `'primary'` | `primary` (customer ↔ agent) \| `transfer` (bridge to human) \| `consult` (warm-transfer briefing) |
| `provider` | text | no | | `twilio` \| `openai` \| `azure_openai` … (transport owner) |
| `provider_session_id` | text | yes | | Twilio CallSid / provider realtime session id; UNIQUE per provider |
| `from_address` | text | yes | | |
| `to_address` | text | yes | | |
| `status` | text | no | `'initiated'` | `initiated` \| `ringing` \| `in_progress` \| `completed` \| `busy` \| `no_answer` \| `failed` \| `canceled` |
| `started_at` | timestamptz | yes | | |
| `answered_at` | timestamptz | yes | | |
| `ended_at` | timestamptz | yes | | |
| `duration_seconds` | integer | yes | | |
| `recording_enabled` | boolean | no | `false` | decision at start (location setting + consent) |
| `recording_file_id` | uuid | yes | | FK → `files` |
| `recording_duration_seconds` | integer | yes | | |
| `region` | text | yes | | media/provider region (latency analysis) |
| `error_code` | text | yes | | |

## messages

Every turn: customer and agent utterances (text or transcribed audio), staff messages
during takeover, system notices and tool calls. Partitioned by month on `created_at`.
**[base-append] [tenant]** PK `(id, created_at)`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `conversation_id` | uuid | no | | |
| `media_session_id` | uuid | yes | | for voice turns |
| `seq` | integer | no | | order within the conversation; UNIQUE `(conversation_id, seq, created_at)` |
| `role` | text | no | | `customer` \| `agent` \| `staff` \| `system` \| `tool` |
| `staff_user_id` | uuid | yes | | for `staff` |
| `content_type` | text | no | `'text'` | `text` \| `transcript` (from audio) \| `tool_call` \| `tool_result` \| `template` \| `attachment` \| `event` |
| `text` | text | yes | | |
| `payload` | jsonb | no | `'{}'` | tool name/args/result (redacted per tool), attachment refs, template params |
| `locale` | text | yes | | |
| `audio_offset_ms` | integer | yes | | position in the recording |
| `audio_duration_ms` | integer | yes | | |
| `confidence` | real | yes | | STT confidence when available |
| `channel_message_id` | text | yes | | provider id (WhatsApp/SMS) for delivery status |
| `delivery_status` | text | yes | | outbound text: `queued` \| `sent` \| `delivered` \| `read` \| `failed` |
| `latency_ms` | integer | yes | | agent turns: customer end-of-speech → first audio |
| `redacted_at` | timestamptz | yes | | privacy redaction applied |

## conversation_events

Machine trace of what happened (for debugging, analytics and QA), separate from the
human-readable transcript. Partitioned by month. **[base-append] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `conversation_id` | uuid | no | | |
| `type` | text | no | | `session_started` \| `location_resolved` \| `customer_identified` \| `identity_verified` \| `tool_called` \| `tool_succeeded` \| `tool_failed` \| `guardrail_triggered` \| `handoff_rule_matched` \| `language_switched` \| `provider_error` \| `latency_breach` \| `fallback_activated` \| `session_ended` |
| `data` | jsonb | no | `'{}'` | |
| `duration_ms` | integer | yes | | for tool calls |

## handoff_targets

Where humans can be reached ([FR-HND-003](../product/requirements.md#fr-hnd--handoff)).
**[base] [tenant] [soft] [ver]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `location_id` | uuid | yes | | null = organization-wide |
| `name` | text | no | | "Front desk", "Manager on duty" |
| `type` | text | no | | `phone` (PSTN transfer) \| `team_queue` (dashboard live takeover queue) \| `user` (specific user) |
| `phone_e164` | text | yes | | for `phone` |
| `user_id` | uuid | yes | | for `user` |
| `availability_schedule_id` | uuid | yes | | FK → `schedules` (`handoff_availability`); null = location opening hours |
| `channels` | text[] | no | | channels this target serves |
| `reasons` | text[] | no | `'{}'` | empty = all reasons; else only these reason codes (e.g. emergencies → manager) |
| `priority` | smallint | no | `0` | tried in order |
| `ring_timeout_seconds` | smallint | no | `25` | |
| `warm_transfer` | boolean | no | `true` | brief the human first |

## handoffs

**[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `conversation_id` | uuid | no | | |
| `location_id` | uuid | yes | | |
| `reason_code` | text | no | | `customer_request` \| `emergency` \| `repeated_failure` \| `low_confidence` \| `out_of_scope` \| `tool_failure` \| `system_failure` \| `negative_sentiment` \| `policy_rule` \| `vip` |
| `triggered_by` | text | no | | `rule` \| `agent` \| `customer` \| `system` |
| `mode` | text | no | | `warm_transfer` \| `cold_transfer` \| `live_takeover` \| `callback` \| `channel_switch` \| `message` |
| `status` | text | no | `'requested'` | `requested` \| `ringing` \| `connected` \| `completed` \| `no_answer` \| `failed` \| `fell_back_to_callback` \| `canceled` |
| `handoff_target_id` | uuid | yes | | |
| `attempts` | jsonb | no | `'[]'` | `[{ targetId, startedAt, result }]` |
| `assigned_user_id` | uuid | yes | | who took it |
| `packet` | jsonb | no | | context packet ([handoff §packet](../features/handoff.md#context-packet)) |
| `task_id` | uuid | yes | | FK → `tasks` when it became a callback |
| `requested_at` | timestamptz | no | `now()` | |
| `connected_at` | timestamptz | yes | | |
| `resolved_at` | timestamptz | yes | | |
| `failure_reason` | text | yes | | |

Index: `(organization_id, location_id, status, requested_at)`.

## tasks

Staff follow-ups: callbacks from handoffs, manual follow-ups, review items.
**[base] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `location_id` | uuid | yes | | |
| `type` | text | no | | `callback` \| `follow_up` \| `review_conversation` \| `payment_follow_up` \| `other` |
| `source` | text | no | | `handoff` \| `system` \| `manual` |
| `title` | text | no | | |
| `description` | text | yes | | |
| `priority` | text | no | `'normal'` | `low` \| `normal` \| `high` \| `urgent` |
| `status` | text | no | `'open'` | `open` \| `in_progress` \| `done` \| `canceled` |
| `due_at` | timestamptz | yes | | promised callback time |
| `assigned_user_id` | uuid | yes | | |
| `customer_id` | uuid | yes | | |
| `conversation_id` | uuid | yes | | |
| `related_type` | text | yes | | `booking` \| `order` |
| `related_id` | uuid | yes | | |
| `contact_phone_e164` | text | yes | | number to call back |
| `completed_at` | timestamptz | yes | | |
| `completed_by_user_id` | uuid | yes | | |
| `resolution_note` | text | yes | | |
| `created_by_type` | text | no | | **[actor]** |
| `created_by_id` | uuid | yes | | |

Indexes: `(organization_id, location_id, status, due_at)`, `(organization_id, assigned_user_id, status)`.
