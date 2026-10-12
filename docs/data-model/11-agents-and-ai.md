# 11 · Agents, AI providers and knowledge

Provider configuration controlled by platform admins, the business-facing agent
configuration, and the knowledge base. Behaviour: [features/voice-agent.md](../features/voice-agent.md),
[features/knowledge-base.md](../features/knowledge-base.md),
[features/super-admin.md](../features/super-admin.md#providers-and-model-profiles).
Conventions: [README §1](README.md#1-conventions).

```
provider_credentials ──< ai_model_profiles ──< ai_profile_assignments   (platform → plan → org → location → endpoint)
                    └──< phone_numbers ([10](10-channels-and-conversations.md#phone_numbers))
agents ──< agent_versions ◄── conversations.agent_version_id
knowledge_sources ──< knowledge_entries
                  └──< knowledge_chunks (embeddings)
```

---

## provider_credentials

Credentials and non-secret configuration for any external provider: AI, telephony,
messaging, email. Platform-owned by default; organization-owned for BYOK
([glossary](../product/glossary.md)). Secrets are envelope-encrypted
([BACKEND §12](../../BACKEND.md#12-configuration-and-secrets)). **[base] [ver]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `owner_scope` | text | no | `'platform'` | `platform` \| `organization` |
| `organization_id` | uuid | yes | | required iff `owner_scope = 'organization'`; RLS for org-owned rows; platform rows readable only by platform-scope code paths |
| `kind` | text | no | | `ai` \| `telephony` \| `messaging` \| `email` \| `speech` |
| `provider` | text | no | | `openai` \| `azure_openai` \| `twilio` \| `telnyx` \| `meta_whatsapp` \| `smtp` \| `sendgrid` … |
| `name` | text | no | | "Azure EastUS prod", "OpenAI main" |
| `config` | jsonb | no | `'{}'` | non-secret, schema per provider: Azure `{ endpoint, apiVersion, region, resourceName }`; OpenAI `{ baseUrl, organization, project }`; Twilio `{ accountSid, region, edge }` |
| `secret_ciphertext` | bytea | no | | encrypted secret payload (`{ apiKey }`, `{ authToken }` …) |
| `data_key_ciphertext` | bytea | no | | per-record data key, wrapped by the master key |
| `master_key_id` | text | no | | which master key wrapped it (rotation) |
| `secret_fingerprint` | text | no | | last 4 chars + hash prefix, for display |
| `status` | text | no | `'active'` | `active` \| `disabled` \| `invalid` |
| `last_verified_at` | timestamptz | yes | | connectivity check |
| `last_error` | text | yes | | |
| `created_by_type` | text | no | | `platform_admin` \| `user` |
| `created_by_id` | uuid | yes | | |

## ai_model_profiles

A named, reusable AI configuration: which credential, which model/deployment, which
voice, which parameters ([FR-AGT-010](../product/requirements.md#fr-agt--agent)). **[base] [ver]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `owner_scope` | text | no | `'platform'` | `platform` \| `organization` (BYOK) |
| `organization_id` | uuid | yes | | |
| `name` | text | no | | "Realtime – Azure EastUS – voice alloy" |
| `modality` | text | no | | `realtime_voice` \| `text_chat` \| `summarization` \| `classification` \| `embedding` \| `transcription` |
| `provider_credential_id` | uuid | no | | FK → `provider_credentials` (kind `ai`) |
| `model` | text | no | | provider model name (OpenAI) or base model (Azure, informational) |
| `deployment` | text | yes | | Azure deployment name |
| `voice` | text | yes | | provider voice id for `realtime_voice` |
| `parameters` | jsonb | no | `'{}'` | schema per modality: `{ temperature, maxOutputTokens, turnDetection: { type, threshold, silenceMs, prefixPaddingMs }, inputTranscriptionModel, noiseReduction, speed }`; embeddings `{ dimensions }` |
| `capabilities` | jsonb | no | `'{}'` | `{ tools: true, serverControlChannel: true, languages: ["en","ur",...] }` used by resolution checks |
| `cost_rates` | jsonb | no | `'{}'` | our cost per unit for margin tracking `{ audioInPerMinute, audioOutPerMinute, inputPer1kTokens, ... , currency }` |
| `fallback_profile_id` | uuid | yes | | FK → `ai_model_profiles`: used if this one is unhealthy |
| `status` | text | no | `'active'` | `active` \| `disabled` |

## ai_profile_assignments

Which profile serves which scope, per modality ([FR-AGT-009](../product/requirements.md#fr-agt--agent)).
Resolution: the most specific active assignment wins —
`channel_endpoint → location → organization → plan → platform`. Global (platform-managed). **[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `scope_type` | text | no | | `platform` \| `plan` \| `organization` \| `location` \| `channel_endpoint` |
| `scope_id` | uuid | yes | | null for `platform` |
| `modality` | text | no | | |
| `model_profile_id` | uuid | no | | FK |
| `is_active` | boolean | no | `true` | |
| `rollout_percent` | smallint | no | `100` | gradual rollout / A-B between two assignments at the same scope (bucketed by conversation id) |
| `notes` | text | yes | | |
| `assigned_by_platform_admin_id` | uuid | yes | | |

UNIQUE `(scope_type, scope_id, modality, model_profile_id)`. A CHECK ensures the sum of
`rollout_percent` per `(scope_type, scope_id, modality)` among active rows is 100
(validated in service).

## agents

The business's agent configuration. One organization-level agent (`location_id` null) is
created automatically; locations may have their own that override it
([FR-AGT-001](../product/requirements.md#fr-agt--agent)). The editable draft lives here;
published snapshots live in `agent_versions`. **[base] [tenant] [soft] [ver]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `location_id` | uuid | yes | | null = organization default; UNIQUE `(organization_id, location_id)` with NULLS NOT DISTINCT |
| `name` | text | no | | the agent's spoken name: "Ava" |
| `status` | text | no | `'active'` | `active` \| `paused` |
| `draft` | jsonb | no | | full editable configuration (schema below) |
| `published_version_id` | uuid | yes | | FK → `agent_versions` |
| `has_unpublished_changes` | boolean | no | `false` | |

`draft` / `agent_versions.config` schema (Zod, `packages/contracts/agents`):

```jsonc
{
  "persona": { "tone": "friendly" | "professional" | "warm" | "concise", "formality": "casual" | "formal" },
  "greeting": { "default": "Thanks for calling {location.name}, this is {agent.name}…", "translations": {} },
  "languages": { "default": "en", "supported": ["en", "ur"], "autoSwitch": true },
  "customInstructions": "We never discuss competitor prices…",      // business-written, appended in a delimited section
  "capabilities": { "appointments": true, "reservations": false, "ordering": false, "inquiries": true },
  "tools": { "disabled": ["cancel_booking"] },                        // business may disable, never add
  "verification": { "requireOtpForChanges": true },
  "handoff": {
    "enabled": true,
    "keywords": ["manager", "complaint"],
    "maxFailedTurns": 3,
    "negativeSentimentThreshold": "high",
    "afterHours": "callback" | "message"
  },
  "callLimits": { "maxDurationMinutes": 15, "silenceTimeoutSeconds": 20 },
  "recording": { "disclosure": true },
  "knowledgeSourceIds": [],                                           // empty = all sources in scope
  "voice": { "overrideProfileVoice": null, "speed": 1.0 }             // within what the model profile allows
}
```

## agent_versions

Immutable published snapshots. Conversations reference the exact version they ran on.
**[base-append] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `agent_id` | uuid | no | | FK |
| `version` | integer | no | | UNIQUE `(agent_id, version)` |
| `config` | jsonb | no | | snapshot of `draft` at publish |
| `published_by_user_id` | uuid | yes | | |
| `change_note` | text | yes | | |

## knowledge_sources

Where knowledge comes from ([FR-AGT-005](../product/requirements.md#fr-agt--agent)).
**[base] [tenant] [soft] [ver]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `location_id` | uuid | yes | | null = all locations |
| `type` | text | no | | `faq` (structured Q&A entries) \| `text` (free text) \| `document` (uploaded file) \| `url` (crawled page/site) |
| `title` | text | no | | |
| `locale` | text | no | | language of the content |
| `file_id` | uuid | yes | | for `document` |
| `url` | text | yes | | for `url` |
| `crawl_config` | jsonb | no | `'{}'` | `{ maxPages, includePaths, excludePaths, refreshDays }` |
| `body` | text | yes | | for `text` |
| `status` | text | no | `'pending'` | `pending` \| `processing` \| `ready` \| `failed` |
| `error` | text | yes | | |
| `last_ingested_at` | timestamptz | yes | | |
| `content_hash` | text | yes | | skip re-embedding unchanged content |

## knowledge_entries

FAQ entries for `type = 'faq'`. **[base] [tenant] [soft] [i18n]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `knowledge_source_id` | uuid | no | | FK |
| `question` | text | no | | |
| `answer` | text | no | | |
| `alternate_questions` | text[] | no | `'{}'` | phrasings for retrieval |
| `sort_order` | integer | no | `0` | |

## knowledge_chunks

Retrieval units with embeddings, derived from sources/entries; rebuilt by the
`knowledge-ingest` queue. **[base-append] [tenant]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `knowledge_source_id` | uuid | no | | FK ON DELETE CASCADE |
| `knowledge_entry_id` | uuid | yes | | FK ON DELETE CASCADE |
| `location_id` | uuid | yes | | denormalized for filtering |
| `locale` | text | no | | |
| `content` | text | no | | |
| `token_count` | integer | no | | |
| `embedding` | vector | no | | dimension from the embedding profile used |
| `embedding_profile_id` | uuid | no | | FK → `ai_model_profiles`; re-embed on profile change |
| `metadata` | jsonb | no | `'{}'` | `{ title, url, page, heading }` |

Index: HNSW on `embedding` (`vector_cosine_ops`) per embedding dimension, filtered by
`(organization_id, location_id, locale)`.
