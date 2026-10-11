# ADR-0008 · Redis for cache, sessions and rate limits; BullMQ for jobs

**Status:** Accepted · 2026-10-11

## Context

We need low-latency session lookups, cache-aside for hot configuration (incoming call
routing, agent context), rate limiting, distributed locks, Socket.IO fan-out across
instances, and durable background jobs with delays (reminders, hold expiry), retries and
repeatable schedules.

## Decision

- **Redis 7** for cache, sessions, rate limits, locks and the Socket.IO adapter.
- **BullMQ** on Redis for queues, delayed and repeatable jobs.
- In production, **two Redis instances**: a cache instance (`allkeys-lru`, may evict) and
  a queue instance (`noeviction`, AOF persistence), so cache pressure can never evict jobs.
  Locally one instance with `noeviction` serves both (logical DBs 0/1).
- Domain events reach queues via the Postgres transactional outbox, so Redis is never the
  source of truth for business state.

## Alternatives considered

- **pg-boss (Postgres queue).** Fewer moving parts; rejected for throughput of
  high-frequency jobs and richer delayed/repeatable/rate-limited job features in BullMQ.
- **Cloud queues (SQS, Service Bus).** Ties us to a host early; can replace BullMQ behind
  the queue abstraction if needed.

## Consequences

- Cache catalogue and invalidation rules are explicit ([BACKEND.md §9](../../BACKEND.md#9-caching)).
- Losing the cache instance degrades performance only; losing the queue instance is
  recoverable from the outbox and sweepers.
