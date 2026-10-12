# Documentation

## Structure

```
docs/
├── product/        what and why
│   ├── prd.md              product requirements document
│   ├── requirements.md     numbered functional (FR-*) and non-functional (NFR-*) requirements
│   ├── roadmap.md          phases
│   └── glossary.md         shared vocabulary
├── data-model/     every table, every column — the single source of truth for persistence
├── features/       one document per feature: behaviour, rules, flows, endpoints, events, jobs
├── adr/            architecture decision records
└── plans/          implementation plans per phase: order, milestones, done-when checklists
```

Root-level technical documents: [ARCHITECTURE.md](../ARCHITECTURE.md),
[BACKEND.md](../BACKEND.md), [FRONTEND.md](../FRONTEND.md).

## Rules: one fact, one place

Each kind of information has exactly one home. Other documents **link** to it; they do
not restate it. If two documents disagree, the owner below wins and the other is a bug.

| Information | Owner |
|---|---|
| Vocabulary and definitions | [product/glossary.md](product/glossary.md) |
| Requirement statements (`FR-*`, `NFR-*`) | [product/requirements.md](product/requirements.md) |
| Phase scope | [product/roadmap.md](product/roadmap.md) |
| Tables, columns, constraints, indexes, enums | [data-model/](data-model/README.md) |
| Behaviour, business rules, flows, endpoint list, events, jobs | the feature doc in [features/](features/README.md) |
| API conventions (URLs, errors, pagination, idempotency, versioning) | [BACKEND.md §5](../BACKEND.md#5-api-conventions) |
| Cache keys, TTLs and invalidation | [BACKEND.md §9](../BACKEND.md#9-caching) |
| Queue names and job catalogue | [BACKEND.md §10](../BACKEND.md#10-background-jobs-and-events) |
| Domain event catalogue | [BACKEND.md §10](../BACKEND.md#10-background-jobs-and-events) |
| Permission catalogue | [features/organizations-and-access.md](features/organizations-and-access.md#permission-catalogue) |
| Why a technology or pattern was chosen | [adr/](adr/README.md) |

## Reference style

- Tables are written in `code`, e.g. `bookings`, and link to their data-model section the
  first time they appear in a document.
- Requirements are cited by ID, e.g. `FR-APT-004`.
- Endpoints are written as `METHOD /path`, relative to the API base (`/v1`).
- Events are written as `booking.confirmed`.

## Feature document template

Every feature document uses these sections, in this order (omit a section only if it is
truly empty):

1. **Purpose** — one paragraph.
2. **Scope** — in scope / out of scope / phase.
3. **Concepts** — feature-specific concepts (linking to the glossary for shared terms).
4. **Business rules** — numbered, testable.
5. **Flows** — step by step, with diagrams where helpful.
6. **Data** — links to the data-model tables it owns or uses.
7. **API** — endpoint table.
8. **Events and jobs** — emitted events, consumed events, background jobs.
9. **Permissions** — which permission keys gate what.
10. **Edge cases** — and how each is handled.
11. **Requirements covered** — `FR-*` IDs.
