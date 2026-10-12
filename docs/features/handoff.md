# Handoff

## Purpose

Move a conversation from the agent to a human — or to a guaranteed follow-up — whenever
the customer asks, the situation requires it, or the agent is not succeeding, with full
context so the customer never repeats themselves.

## Scope

- **In:** triggers (rules + agent), handoff targets with availability, warm/cold phone
  transfer (Phase 2), callback tasks (Phase 2), channel switch (send a link), live
  takeover for widget/app (Phase 3), handoff queue, metrics.
- **Out:** full contact-center features (ACD, IVR trees, agent seats) — integrate with
  existing phone systems via transfer to their number instead.

## Business rules

1. **Hard triggers (code, cannot be overridden by the model)** ([FR-HND-002](../product/requirements.md#fr-hnd--handoff)):
   - customer explicitly asks for a human (multilingual intent + keyword list incl.
     agent-configured `handoff.keywords`);
   - emergency phrases → the agent first gives the configured safety instruction (e.g.
     "please hang up and call emergency services") then hands off with reason `emergency`;
   - `maxFailedTurns` consecutive turns without progress (no understanding, repeated
     question, tool errors);
   - low STT confidence on critical fields after 2 retries (name, phone, date);
   - tool or system failure on a committing action;
   - sentiment classifier reports negative above threshold for 2 consecutive turns;
   - blocked customer profile; business rules (`reasons` routing to specific targets).
2. **Soft triggers (model):** the agent may call `transfer_to_human(reason)` for
   out-of-scope requests (complaints, refunds, custom quotes, medical/legal questions).
3. **Escalation ladder** for failures (not for explicit requests or emergencies): rephrase
   → offer channel switch (text a link) → offer human.
4. **Target selection:** active targets for the location (then organization) whose
   `channels` include the conversation channel, whose `reasons` match (or empty), and
   whose availability schedule is open now — ordered by `priority`.
5. **Phone:** `warm_transfer` = dial target, play the spoken brief from the context
   packet, then bridge; if not answered within `ring_timeout_seconds`, try the next
   target; if none answer → callback. `cold_transfer` = redirect immediately.
6. **Widget/app:** if a `team_queue` target is open and a staff member with
   `conversations.takeover` is online → `live_takeover` (staff types/speaks in the same
   conversation); else callback/message.
7. **Callback:** creates a `tasks` row (`type = callback`, `due_at` from the next open
   window or business setting), alerts staff, and the agent tells the customer exactly
   what happens next ("Someone from the Downtown clinic will call you back by 10 am
   tomorrow on this number").
8. The agent is honest during handoff: never pretends to be human; says it is connecting
   them; never leaves silence > 3 s without a holding phrase.
9. Every handoff ends in a terminal status, and every callback task must be completed or
   cancelled with a note — overdue tasks escalate to managers.

## Context packet

Stored in `handoffs.packet`, shown to staff and spoken (briefly) on warm transfer:

```jsonc
{
  "customer": { "name": "Sam Lee", "phone": "+1…", "profileId": "…", "assurance": "caller_id",
                "upcoming": [{ "referenceCode": "BK-7F3K2Q", "startsAt": "…" }] },
  "reason": "customer_request",
  "summary": "Wants to move Thursday's root canal to next week; upset about a billing issue.",
  "intent": "reschedule",
  "collected": { "preferredDates": ["next Mon", "next Tue"], "serviceId": "…" },
  "state": { "heldBookingId": null, "draftOrderId": null },
  "sentiment": "negative",
  "language": "en",
  "links": { "conversation": "/o/…/conversations/…", "transcript": "…" }
}
```

## Flows

```
trigger → HandoffService.request(conversation, reason, mode?)
  → choose targets → handoff row (requested) → handoff.requested event (realtime alert)
  → phone: telephony adapter warm/cold transfer → status ringing → connected | no_answer
  → widget/app: queue → staff accepts → with_human → staff ends → completed
  → no target / no answer → task (callback) → fell_back_to_callback → customer told
```

## Data

[`handoff_targets`](../data-model/10-channels-and-conversations.md#handoff_targets),
[`handoffs`](../data-model/10-channels-and-conversations.md#handoffs),
[`tasks`](../data-model/10-channels-and-conversations.md#tasks),
[`conversations`](../data-model/10-channels-and-conversations.md#conversations).

## API

| Method | Path | Permission |
|---|---|---|
| GET · POST · PATCH · DELETE | `/orgs/{orgId}/handoff-targets[/{id}]` | `channels.manage` |
| GET | `{L}/handoffs?status=&reason=&from=` | `conversations.read` |
| GET | `{L}/handoffs/{id}` | `conversations.read` |
| POST | `{L}/handoffs/{id}/accept` · `/complete` | `conversations.takeover` / `handoffs.manage` |
| POST | `{L}/conversations/{id}/messages` (staff message during takeover) | `conversations.takeover` |
| GET | `{L}/tasks?status=&type=&assignedTo=` | `tasks.manage` |
| POST · PATCH | `{L}/tasks[/{id}]` | `tasks.manage` |
| POST | `{L}/tasks/{id}/complete` | `tasks.manage` |

## Events and jobs

Emits `handoff.requested/connected/failed/resolved`, `task.created/assigned/completed`.
Jobs: `tasks/overdue-escalation` (every 15 min).

## Permissions

`conversations.takeover`, `handoffs.manage`, `tasks.manage`, `channels.manage` (targets).

## Edge cases

| Case | Handling |
|---|---|
| Transfer target answers by voicemail | Warm transfer requires the human to press a key (or say "yes") to accept; voicemail never bridges |
| Call drops during transfer | Handoff `failed`; automatic callback task with high priority |
| After hours, emergency | Safety instruction first; emergency target (e.g. on-call number) if configured with 24/7 schedule; else callback + staff alert |
| Too many handoffs | Analytics shows reasons; owners alerted when rate > threshold (agent likely misconfigured) |

## Requirements covered

FR-HND-001 … FR-HND-007, NFR-AVAIL-002.
