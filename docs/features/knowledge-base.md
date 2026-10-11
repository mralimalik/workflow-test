# Knowledge base

## Purpose

Give the agent accurate answers to business-specific questions (parking, insurance
accepted, preparation instructions, dress code) from content the business controls.

## Scope

- **In:** FAQ entries and free text (Phase 1), document uploads and website URLs
  (Phase 2), per-location sources, translations, ingestion pipeline, retrieval with
  citations, re-indexing.
- **Out:** live web browsing during calls; answering from general model knowledge about
  the business.

## Business rules

1. Sources can be organization-wide or location-specific; retrieval for a conversation
   includes org-wide + that location's sources, filtered by locale (falling back to the
   default locale).
2. Structured data always wins over knowledge: hours, prices, availability and policies
   come from tools, never from documents (documents may be outdated).
3. The agent answers from retrieved chunks only when similarity ≥ threshold; otherwise it
   says it doesn't know and offers a callback/handoff.
4. Uploaded documents: PDF, DOCX, TXT, MD up to 20 MB; URLs: same-domain crawl with page
   and depth limits; re-crawl on schedule (`refreshDays`).
5. Content changes re-embed only changed chunks (`content_hash`).
6. Sensitive content warning at upload (the business is told the agent may read any of it
   to callers).

## Flows

```
create/update source → knowledge_source.updated → knowledge-ingest:
  fetch (file/URL) → extract text → clean → chunk (~400 tokens, heading-aware, overlap)
  → embed with the embedding profile → upsert knowledge_chunks → status ready
conversation → search_knowledge(query) → hybrid search (vector + keyword) within
  org/location/locale → top-k chunks with titles/urls → model answers with them
```

## Data

[`knowledge_sources`](../data-model/11-agents-and-ai.md#knowledge_sources),
[`knowledge_entries`](../data-model/11-agents-and-ai.md#knowledge_entries),
[`knowledge_chunks`](../data-model/11-agents-and-ai.md#knowledge_chunks),
[`files`](../data-model/14-system.md#files).

## API

| Method | Path | Permission |
|---|---|---|
| GET · POST | `/orgs/{orgId}/knowledge-sources` | `agents.read` · `knowledge.manage` |
| GET · PATCH · DELETE | `/orgs/{orgId}/knowledge-sources/{id}` | `agents.read` · `knowledge.manage` |
| POST | `/orgs/{orgId}/knowledge-sources/{id}/reindex` | `knowledge.manage` |
| GET · POST · PATCH · DELETE | `/orgs/{orgId}/knowledge-sources/{id}/entries[/{entryId}]` | `knowledge.manage` |
| POST | `/orgs/{orgId}/files/uploads` | `knowledge.manage` (signed upload URL) |
| POST | `/orgs/{orgId}/knowledge/search` | `agents.read` (test what the agent would retrieve) |

## Events and jobs

Emits `knowledge_source.updated`. Jobs: `knowledge-ingest/fetch|chunk|embed`,
`knowledge-ingest/recrawl` (daily).

## Permissions

`knowledge.manage`, `agents.read`.

## Edge cases

| Case | Handling |
|---|---|
| Embedding profile changed by admin | Background re-embed per organization; old chunks served until new ones are ready |
| Conflicting info in two sources | Most recently updated source ranked higher; dashboard search shows both for cleanup |
| URL blocks crawlers | Source fails with a clear error; suggest pasting text |

## Requirements covered

FR-AGT-004, FR-AGT-005.
