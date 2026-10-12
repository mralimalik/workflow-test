# ADR-0007 · Provider abstraction with admin-assigned model profiles

**Status:** Accepted · 2026-10-11

## Context

Platform admins must choose which AI provider, model, deployment, endpoint and voice
serve each plan, organization, location or channel, and change it without deployments.
We start with OpenAI Realtime and Azure OpenAI Realtime and Twilio, and expect to add
more providers (and BYOK) later. ElevenLabs Agents is not planned but must not be
precluded.

## Decision

- Narrow adapter interfaces in the `providers` module: `RealtimeVoiceProvider`,
  `TextModelProvider`, `EmbeddingProvider`, `TelephonyProvider`, `MessagingProvider`.
- Credentials in `provider_credentials` (envelope-encrypted), configurations in
  `ai_model_profiles`, and scope assignments in `ai_profile_assignments` with
  most-specific-wins resolution, rollout percentages and fallback profiles
  ([data model 11](../data-model/11-agents-and-ai.md)).
- The agent runtime owns instructions, tools, guardrails and handoff; providers only
  transport audio/text and execute model inference. Tool execution is always server-side.

## Alternatives considered

- **All-in-one voice agent platforms** (ElevenLabs Agents, Vapi, Retell). Fast to start,
  but business logic, tools and handoff would live in a vendor's config, provider choice
  per tenant would be limited, and per-minute margins are lower. A platform like
  ElevenLabs can still be integrated later as another `RealtimeVoiceProvider` (or as a
  full-agent adapter) without schema changes.
- **Hardcoding one provider.** Rejected: switching or mixing providers per tenant is a
  product requirement.

## Consequences

- Each new provider is an adapter + config schema, not a refactor.
- Every conversation records the profile used, enabling cost and quality comparison.
