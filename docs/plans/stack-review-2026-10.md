> **Point-in-time reference** (2026-10-11), not a source of truth. Decisions taken from it are recorded in
> [ADR-0013](../adr/0013-nestjs-12-built-in-first.md) and [ADR-0014](../adr/0014-zod-contracts-openapi.md); re-check versions before relying on them.

# Attendra stack research (2026-10-11)

How this was researched: npm registry (`npm view … dist-tags/time/peerDependencies/engines`, plus `npm pack` to read shipped `.d.ts`/`.js`), and docs **source files** from GitHub via `raw.githubusercontent.com`. Local copies are in `scratchpad/docs/`.
Blocked: `api.github.com` (repo access not enabled), `api.npmjs.org` downloads (proxy 403), and all docs websites. **I could not get npm weekly download numbers**, so adoption below is judged by release activity and whether official docs mention a library, not by download counts.
Legend: **[V]** verified from a primary source. **[J]** my judgement or recommendation. **[U]** not verified.

---

## Decisions needed (these change an ADR or the stack)

| # | Decision | Recommended option | Why (short) |
|---|---|---|---|
| D1 | **NestJS 11 → 12** (ADR-0002) | **Upgrade to 12.1.x now**, before any modules exist. Keep our server packages as CommonJS for now; they load Nest's ESM-only packages through `require(esm)`. | 12 is GA (12.0.0 2026-08-27, 12.1.2 2026-09-30). npm `latest` now points at 12, and 11 is tagged `legacy`. Every official package we need already ships a 12-compatible release. 12 adds native Standard Schema (Zod) validation, response serialization and OpenAPI integration, plus `errorCode` on exceptions and Express graceful shutdown. Upgrading costs almost nothing while we have no modules. |
| D2 | **Replace ts-rest** (ADR-0006) | **Option A (recommended):** the Nest 12 native Standard Schema pipeline, plus a contract registry in `packages/contracts` (Zod 4 + route metadata), plus **zod-openapi** to produce the OpenAPI **3.1** document, plus a typed client generated from that document with **openapi-typescript + openapi-fetch** (and optionally openapi-react-query) in `packages/api-client`. **Option B (runner-up):** **oRPC** (`@orpc/contract` + `@orpc/nest` + `@orpc/openapi`). | ts-rest is effectively stalled. Stable 3.52.1 is from 2025-03-04, nothing has been published since 3.53.0-rc.1 (2025-06-02), it peers `zod ^3.22.3`, and `@ts-rest/nest` peers Nest `^9‖^10‖^11`. Its OpenAPI generator depends on `@anatine/zod-openapi` and `openapi3-ts` v2 (Zod 3, OAS 3.0). It cannot meet "Zod 4 + Nest 12 + OAS 3.1". Option A keeps full control of RFC 9457 errors, headers (`Idempotency-Key`, `If-Match`/`ETag`), guards and interceptors. Option B gives a ts-rest-like DX but brings its own error envelope, is ESM-only, and has a 2.0 major in beta. |
| D3 | **Drizzle 0.45 vs 1.0-rc** (ADR-0003) | **Stay on 0.45.4 / drizzle-kit 0.31.11** (the `latest` tags). Avoid the v1 relational-query API so the move to 1.0 at GA is mechanical. Write exclusion constraints in custom SQL migrations. | 1.0 is still RC (`rc` = 1.0.0-rc.4, 2026-06-27; preview builds of rc.5 appeared in Sept). `latest` is 0.45.4 (2026-10-08). The 1.0 upgrade changes the migration folder layout (`drizzle-kit up`) and requires relations v2. |
| D4 | **Redis client** (ADR-0008 / BACKEND §2 say ioredis) | **Keep ioredis, pinned to 5.11.x for now.** Move to 6.x after an integration-test spike; if you move, set `protocol: 2` until BullMQ and the Socket.IO adapter are verified on RESP3. | ioredis 6.0.0 (2026-07-31) defaults to RESP3 and requires Node 20+. The ioredis README now says it is maintained "on a best-effort basis" and **recommends node-redis for new projects**. However, the Socket.IO docs warn that node-redis has problems restoring subscriptions after reconnect and suggest ioredis. ioredis is still the BullMQ default. |
| D5 | **BullMQ 5 → 6** (ADR-0008) | **Use BullMQ 6.3.x** (with `@nestjs/bullmq` 12.0.0). Use Job Schedulers only. Install `ioredis` explicitly. | 6.0.0 shipped 2026-07-30. It removes the legacy repeatable-job APIs and `debounce`, and makes ioredis an optional peer. There is nothing to migrate because we have no jobs yet. Its new PostgreSQL backend is interesting, but **do not adopt it now**: Redis is "the most battle-tested option" per its own docs. |
| D6 | **TypeScript 6 vs 7** (no ADR, toolchain) | **Stay on TS 6.0.3** for compile and lint. You can optionally add TS 7 (`tsgo`) as a fast `--noEmit` check later. Fix all TS 6 deprecations now. | `typescript@latest` is **7.0.2** (2026-07-08), the native port. It ships only `unstable/*` JS APIs. typescript-eslint 8.71.1 peers `typescript >=4.8.4 <6.1.0`, so type-aware lint cannot run on TS 7. |
| D7 | **Node engine range** (root `package.json` says `>=22.12.0 <23`) | **Raise to `>=22.22.3 <23`** now, or better, plan **Node 24 LTS** (`^24.15`). | tsdown 0.23 requires Node `^22.18‖^24.11‖>=26`. `@nestjs/schematics` 12 (the CLI generators and `nest upgrade`) requires `^22.22.3‖^24.15‖>=26`. Node 22 entered maintenance on 2025-10-21 and reaches end of life on 2027-04-30. Node 24 is LTS until 2028-04-30. Local Node is 22.22.0, which already fails the schematics floor. |
| D8 | **CSRF library** | **No library.** Implement the session-bound synchronizer token that BACKEND §6.3 already specifies, plus an Origin / `Sec-Fetch-Site` check. | csrf-csrf 4.0.3 implements double-submit cookies, which is a different pattern from our design. Its last publish was 2025-05-27. |

ADR changes to record if you accept: ADR-0002 (Nest 12, Node floor), ADR-0006 (ts-rest replacement), ADR-0008 (BullMQ 6, ioredis version and protocol). BACKEND.md §2 and §5.10 would also need updating.

---

## 1. NestJS

**Latest:** `@nestjs/core|common|platform-express|websockets|platform-socket.io|testing` **12.1.2 (2026-09-30)** [V]. Release history: 12.0.0 on 2026-08-27; 11.2.7 tagged `legacy` on 2026-09-30, so 11 still gets patches. The packages are `type: module`, and `@nestjs/core` declares `engines.node >=20` [V]. `@nestjs/platform-express` 12 depends on **express 5.2.1** and path-to-regexp 8.4.2 [V].

**Sources read:**
- https://raw.githubusercontent.com/nestjs/docs.nestjs.com/master/content/migration.md (11→12 guide, read in full)
- …/content/application/validation.md, …/content/pipes.md, …/content/openapi/introduction.md, …/content/openapi/operations.md, …/content/exception-filters.md, …/content/recipes/async-local-storage.md, …/content/observability/overview.md
- The `@nestjs/swagger@12.0.2` package itself (dist inspected)

**What changed in 12** [V, migration guide]:
- **ESM-only packages.** A CommonJS app keeps working through `require(esm)`, which needs Node ≥20.19 or ≥22.12. Migrating your own app to ESM is optional, and `nest upgrade` leaves your module format alone. Jest can load v12 only on Node ≥24.9; Vitest is now the default for ESM projects.
- `nest upgrade` command; the CLI's TypeScript default moves to 6. Schematics require Node `^22.22.3‖^24.15‖>=26`.
- **Standard Schema support:** a `schema` option on `@Body/@Query/@Param/@RawBody` (and `@MessageBody`, `@Payload`), the built-in **`StandardSchemaValidationPipe`**, and **`StandardSchemaSerializerInterceptor`** with `@SerializeOptions({ schema })`. The pipe passes the schema **output** to the handler, so coercion and defaults apply. `z.strictObject` rejects unknown keys.
- `@nestjs/config`: `validationSchema` now takes any Standard Schema (Zod is recommended). Joi needs v18 and options under `validationOptions.libraryOptions`.
- `@nestjs/terminus`: the legacy `HealthIndicator`/`HealthCheckError` are removed. Use `HealthIndicatorService.check(key).up()/down()/attempt().withTimeout()`.
- Lifecycle hooks are now called by hierarchy level, so the order can change. `@Optional()` is no longer inherited by subclasses.
- **Opt-in route conflict diagnostics:** `routeConflictPolicy: { duplicate: 'error', shadow: 'warn' }` and `routeResolutionStrategy: 'specificity'`.
- **`errorCode`** in `HttpExceptionOptions`, serialized into the body.
- `ConsoleLogger` structured params (irrelevant to us because we use pino).
- **Express adapter drains in-flight requests on shutdown.** HTTP adapter error mapping was reworked.
- Request-scoped WebSocket gateways; `handleDisconnect` receives the reason. Microservices get a pre-request hook.
- `@nestjs/observe` is a first-party APM SDK attached through the `instrument` option. It is commercial SaaS (free tier). **Not needed**: we use OpenTelemetry.

**OpenAPI caveat** [V, from the swagger 12.0.2 dist]: `SwaggerModule` emits `openapi: '3.0.0'` by default, and its Standard Schema converter calls `~standard.jsonSchema` with `target: 'openapi-3.0'`. `@ApiResponse({ standardSchema })` is supported. To get **OAS 3.1** you would have to supply a `standardSchemaConverter` and override the version. That is fragile, which is why Option A generates the 3.1 document outside `@nestjs/swagger`.

**Official and companion package compatibility** (peerDependencies) [V]:

| Package | Latest | Nest 12? |
|---|---|---|
| @nestjs/config | 12.0.1 | ✅ `^11‖^12` |
| @nestjs/swagger | 12.0.2 (2026-09-23) | ✅ `^12` (peers TS `^5.5‖^6`) |
| @nestjs/throttler | 6.7.1 (2026-09-24) | ✅ up to `^12` |
| @nestjs/bullmq | 12.0.0 (2026-08-27) | ✅ `^10‖^11‖^12`, bullmq `^3…^6` |
| @nestjs/terminus | 12.1.0 | ✅ |
| @nestjs/websockets, platform-socket.io | 12.1.2 | ✅ |
| @nestjs/cqrs | 12.1.0 | ✅ (12 only) |
| @nestjs/event-emitter / schedule | 12.0.1 / 12.0.2 | ✅ |
| @nestjs/cli | 12.0.8 | ✅ |
| nestjs-cls | 7.0.1 (2026-09-24) | ✅ `>=10 <13`, Node ≥22 |
| @nestjs-cls/transactional + adapter-drizzle-orm | 4.0.1 / 2.0.1 | ✅ (drizzle `^0‖>=1.0.0-rc.1`) |
| nestjs-pino | 5.3.1 (2026-10-02) | ✅ `^11.0.8‖^12.0.2`, pino `^10`, pino-http `^11` |
| **@ts-rest/nest** | 3.52.1 (2025-03) | ❌ `^9‖^10‖^11` |
| **nestjs-zod** | 5.5.0 (2026-07-25) | ❌ `^10‖^11`, swagger `≤^11` |

**Recommendations** [J]:
- Upgrade to 12.1.x across the board (D1).
- Keep `apps/api`, `apps/worker` and `packages/server` on CommonJS (`module: Node16`) for now. Converting to ESM is a separate, optional step; if you do it, also add the OpenTelemetry loader hook (§8).
- Use `StandardSchemaValidationPipe` globally.
- Write our own `ProblemDetailsFilter` that maps our `AppError` and the pipe's errors to RFC 9457. Nest's default validation body is `{statusCode, error, message[]}`, so we need our own formatting; filter on `BadRequestException` from the pipe, or use a custom pipe subclass [U: exact error class not checked].
- Enable `routeConflictPolicy` with `duplicate: 'error'` and `shadow: 'error'` in dev and test.
- Use `nestjs-cls` (which Nest's docs point to) for RequestContext. `@nestjs-cls/transactional` with the Drizzle adapter is optional; we already plan `db.tenantTx()`.
- Use Terminus 12 indicators in the new style.
- Use `enableShutdownHooks()` and rely on the new Express draining.
- URI versioning (`/v1`) is unchanged in our design [U: did not re-read the versioning chapter].

---

## 2. Contracts layer (ts-rest replacement)

**Current status** [V]:
- `@ts-rest/core|nest|open-api` `latest` = 3.52.1 (2025-03-04). The most recent publish is 3.53.0-rc.1 (2025-06-02). Peers: `zod ^3.22.3`; nest `^9‖^10‖^11`. open-api depends on `@anatine/zod-openapi` and `openapi3-ts ^2`. The repo's main-branch `libs/ts-rest/nest/package.json` still peers Nest ≤11.
- **Verdict: not viable for Zod 4 + Nest 12 + OAS 3.1.**

**Alternatives checked** (versions and dates from npm) [V]:

| Option | Version (date) | Zod 4 | Nest 12 | OAS | Notes |
|---|---|---|---|---|---|
| Nest 12 native (`schema` + `StandardSchemaValidationPipe` + `@ApiResponse({standardSchema})`) | 12.1.2 | ✅ (Zod ≥4.2 has `~standard.jsonSchema`) | ✅ | 3.0 via @nestjs/swagger | Official and long-term. It provides no typed client of its own, so the client has to be generated. |
| **zod-openapi** | 6.0.2 (2026-08-31) | ✅ peer `^4`, uses native `.meta()` | n/a | **3.1.0** `createDocument` | Named in Nest's own OpenAPI docs as the Zod converter. Node ≥22.14. |
| @asteasolutions/zod-to-openapi | 9.1.0 (2026-07-19) | ✅ peer `^4` | n/a | 3.0/3.1 [U] | Registry-based alternative. |
| Zod native `z.toJSONSchema` | 4.6.6 | ✅ | n/a | JSON Schema 2020-12 (= OAS 3.1 dialect) / `openapi-3.0` | A building block, not a full document generator. |
| **oRPC** `@orpc/contract,server,openapi,nest,zod` | 1.15.5 (2026-10-07); 2.0.0-beta.43 (2026-10-09) | ✅ (`@orpc/zod/zod4`) | ✅ peer `>=11` (2.0 beta: `>=11.1.27`), Express `>=5` | **3.1.1** | ESM-only. `@Implement(contract.x)` with typed handlers. Typed client via `OpenAPILink` plus `@orpc/tanstack-query`. Errors use the ORPCError envelope `{code,status,message,data}`; `RethrowHandlerPlugin` can pass non-ORPC errors to Nest filters. Docs recommend `bodyParser: false`. `inputStructure: 'detailed'` handles params/query/headers/body, `outputStructure: 'detailed'` handles status/headers. |
| nestjs-zod | 5.5.0 | ✅ | ❌ (≤11) | via swagger ≤11 | Made redundant by Nest 12's native support. |
| openapi-typescript + openapi-fetch | 7.13.0 / 0.17.0 (2026-02) | n/a | n/a | 3.0/3.1 | Types-only codegen plus a tiny fetch client. openapi-react-query 0.5.4. |
| @hey-api/openapi-ts | 0.99.0 (2026-06-22) | n/a | n/a | 3.0/3.1 | Still 0.x; a fuller SDK generator. |

**Recommendation: Option A** [J]
1. `packages/contracts`: Zod 4 schemas, each reusable one given `.meta({ id })`, plus a typed route registry. For example: `defineRoute({ method, path, params, query, headers, body, responses: {201: X, 409: Problem}, errorCodes, idempotent, versioned })`. Small and in-house.
2. Server: a `@ContractRoute(route)` decorator that composes `@Post(path)`, `@HttpCode`, `@ApiResponse` and `schema` metadata on params. Add a contract-conformance e2e test asserting that every registered route is mounted, using Nest's `DiscoveryService` or the route table, and that no route exists outside the registry.
3. OpenAPI: build the 3.1 document from the registry with `zod-openapi` `createDocument`. It is independent of `@nestjs/swagger`; use swagger only as an optional UI. Publish per audience as BACKEND §5.10 says.
4. Client: `openapi-typescript` generates `paths` types from the spec into `packages/api-client`, wrapped with `openapi-fetch` and TanStack Query. Add a CI drift check, regenerate and `git diff --exit-code`. Frontend forms import the same Zod schemas from contracts.

Why A over B:
- A meets the non-negotiables (RFC 9457 `problem+json` with stable `code`, ETag/If-Match, Idempotency-Key, guards and CSRF) with plain Nest primitives.
- A relies only on official Nest features plus two widely used, single-purpose libraries.
- oRPC's Nest support is one integration among many, it has its own error and serialization model, and a 2.0 major is imminent.

**Choose B** if a codegen-free typed client and compile-time "controller implements contract" matter more than owning the error and serialization format. Before committing, spike one endpoint covering problem+json, `If-Match`, `Idempotency-Key` and cookie+CSRF.

Sources:
- https://raw.githubusercontent.com/ts-rest/ts-rest/main/libs/ts-rest/core/CHANGELOG.md
- …/libs/ts-rest/nest/package.json
- https://raw.githubusercontent.com/middleapi/orpc/1.x/apps/content/docs/openapi/{integrations/implement-contract-in-nest,openapi-specification,input-output-structure,error-handling}.md
- the npm README of `@orpc/nest`
- `npm view zod-openapi readme`, `npm view openapi-fetch readme`
- Nest `openapi/introduction.md` (Standard Schema section)

---

## 3. Zod 4

**Latest:** 4.6.6 (published 2026-10-11, today). 4.0.0 shipped 2025-07-09 [V].

**Sources:**
- https://raw.githubusercontent.com/colinhacks/zod/main/packages/docs/content/{json-schema,metadata,codecs,error-customization,api,library-authors}.mdx
- the scratch-dir copies of changelog.mdx and error-formatting.mdx

**Findings** [V]:
- **`z.toJSONSchema(schema, { io: 'input'|'output', target: 'draft-2020-12'(default)|'draft-07'|'draft-04'|'openapi-3.0', unrepresentable: 'throw'|'any', cycles, reused: 'ref'|'inline', override, metadata })`**. Passing a registry, e.g. `z.toJSONSchema(z.globalRegistry)`, produces a set of interlinked schemas keyed by `id`. `z.fromJSONSchema` is experimental.
- **Metadata:** `.meta({ id, title, description, examples, … })` writes to `z.globalRegistry`. `z.registry<Meta>()` creates custom typed registries. `.describe()` still works, but `.meta()` is preferred. Use `.meta({ id })` for every component schema; it drives `$ref` in zod-openapi and toJSONSchema.
- **Codecs (4.1+):** `z.codec(in, out, { decode, encode })` with `.decode()`/`.encode()`. Built-ins documented: `isoDatetimeToDate`, `epochMillisToDate`, `stringToInt`, `json(schema)`, `base64ToBytes`, and more. Useful for "wire ISO string ↔ Date" in contracts. Keep JSON over the wire as ISO strings; decode at the edge.
- **Formats:** `z.uuid({ version: 'v7' })` / `z.uuidv7()` (RFC 9562 variant bits enforced), `z.iso.datetime({ offset, local, precision })` (no offsets by default, which suits UTC timestamps), `z.iso.date()`, `z.iso.time()`, `z.iso.duration()`, `z.email()`, top-level string formats.
- **Errors:** a unified `error` param (`message` deprecated; `invalid_type_error`/`required_error`/`errorMap` dropped). Per-parse and global (`z.config`) customization, locales, `z.treeifyError`/`z.prettifyError`/`z.flattenError`; `.format()`/`.flatten()` deprecated.
- **Standard Schema:** implemented. Nest docs state that Zod ≥4.2 also implements the Standard JSON Schema extension (`~standard.jsonSchema`).

**Recommendation** [J]: **Keep 4.6.x.** Conventions to adopt:
- `z.strictObject` for request bodies, so unknown keys are rejected.
- `z.uuidv7()` for IDs.
- `z.iso.datetime()` for timestamps.
- `.meta({ id })` on shared components.
- Map Zod issues to problem+json `errors[]` with `z.treeifyError` or the raw issues.
- Do not use `z.date()` in wire schemas (it is unrepresentable in JSON Schema); use codecs instead.

---

## 4. Drizzle ORM / drizzle-kit

**Latest stable:** drizzle-orm **0.45.4 (2026-10-08)**, drizzle-kit **0.31.11 (2026-09-21)**. **1.0:** `beta` tag = 1.0.0-beta.22 (2026-04-16), `rc` = **1.0.0-rc.4 (2026-06-27)**, with preview builds of `rc.5-*` (2026-09-09). **No 1.0 GA** [V].

**Sources:**
- https://raw.githubusercontent.com/drizzle-team/drizzle-orm-docs/main/src/content/docs/upgrade-v1.mdx
- …/relations.mdx
- the `drizzle-orm@0.45.4` and `@1.0.0-rc.4` tarballs (`.d.ts` inspected)
- `drizzle-kit generate --help` (local 0.31.11)
- The RLS doc page source was not at the path I tried. A search summary of orm.drizzle.team/docs/rls says `.enableRLS()` is deprecated in v1 in favour of `pgTable.withRLS()`. I confirmed that in the rc.4 typings.

**Findings:**
- **RLS** [V]: 0.45 has `pg-core/policies` (`pgPolicy`), `pg-core/roles` (`pgRole`) and `table.enableRLS()`. 1.0-rc marks `enableRLS` `@deprecated use pgTable.withRLS()`. Neither version models **FORCE ROW LEVEL SECURITY**, as far as I saw in the typings [U]. Put `ALTER TABLE … FORCE ROW LEVEL SECURITY` in SQL migrations.
- **Exclusion constraints** [V]: no `exclude` builder in either version's pg-core typings. Use **`drizzle-kit generate --custom`** (empty migration for hand-written SQL), which exists in 0.31.11. This matches our "reviewed SQL migrations" rule.
- **Checks, indexes, uuid** [V]: `check()` and indexes exist. `uuid().defaultRandom()` is v4 (`gen_random_uuid()`), so generate UUIDv7 in the app with `$defaultFn`, per our rules.
- **Relations v2** [V]: `defineRelations` exists only in 1.0 (rc4 `relations.d.ts`). Upgrading needs `drizzle-kit up` (new migration folder layout with no `journal.json`, DDL snapshots, commutativity checks) and the RQB v1→v2 migration.
- 1.0-rc bundles `drizzle-orm/zod` (and valibot/arktype/effect). For 0.45 the equivalent is `drizzle-zod` 0.8.3 (peer zod `^3.25‖^4`).
- **Drivers:** both `node-postgres` and `postgres-js` are supported. **Keep `pg` 8.23.1** [J]: it is already in the repo, the OpenTelemetry `instrumentation-pg` supports `>=8.0.3 <9` [V], BullMQ's optional Postgres backend uses `pg` [V], and `SET LOCAL`/`set_config` inside `tenantTx` works fine with it.

**Recommendation** [J]: **Keep 0.45.4 / 0.31.11** (D3).
- Use the core query builder (select/join), not `db.query` with v1 `relations()`.
- Hand-write RLS FORCE, policies and exclusion constraints in custom migrations, optionally declaring `pgPolicy` for documentation and diffing.
- Do not use drizzle-zod for API contracts. API shapes belong in `packages/contracts`, not in table shapes.
- Revisit when 1.0 GA ships.

---

## 5. Vitest 5

**Latest:** 5.0.3 (2026-09-30). 5.0.0 shipped 2026-09-03; the last 4.x is 4.1.11 [V].

**Sources:**
- https://raw.githubusercontent.com/vitest-dev/vitest/main/docs/guide/migration/index.md
- …/docs/blog/vitest-5.md
- …/docs/guide/projects.md
- …/docs/guide/coverage.md

**Changes relevant to us** [V]:
- **Inline `test.projects` now inherit the root config by default** (`extends: true`). Arrays such as `setupFiles` are merged, not replaced. Inline projects share one Vite server (`sharedViteServer`, default on). Referenced config files may define nested projects.
- **`clearMocks` is enabled by default.**
- Hoisted `vi.mock` calls must be at module top level. Unawaited async assertions fail the test. `expect.poll` fails on timeout. `toThrow('')` matches any error.
- `test.sequential`/`describe.sequential` are removed.
- Coverage `include`/`exclude` are now matched relative to the project root (no `contains`), and glob thresholds don't inherit `perFile`.
- Config files are no longer looked up from parent directories.
- Reports and artifacts go to `.vitest/`; json and junit reporters write files by default.
- Removed entry points: `vitest/coverage`, `vitest/reporters`, `vitest/environments`, `vitest/snapshot`, `vitest/runners`, `vitest/suite`.
- Worker IDs are 1-based. Fake timers mock `Temporal`.

**Recommendation** [J]: **Keep 5.0.x.** Our `vitest.config.ts` works as is:
- The root has no plugins or setupFiles, so inheritance is harmless. You could move `swcPlugin` to the root once, since it is now inherited.
- Add `.vitest/` to `.gitignore`.
- Make sure no test relies on mocks persisting between tests (`clearMocks`).
- Keep `unplugin-swc`, which is still needed for `emitDecoratorMetadata`.

---

## 6. ESLint 10 + typescript-eslint + TypeScript 6/7

**Latest:** eslint **10.12.0** (2026-10-02; 10.0.0 was 2026-02-06; 9.x is `maintenance` 9.39.5). typescript-eslint **8.71.1** (2026-10-05). typescript `latest` **7.0.2** (2026-07-08), with 6.0.3 (2026-04-16) the last 6.x [V].

**Sources:**
- https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/main/docs/users/Dependency_Versions.mdx
- https://raw.githubusercontent.com/microsoft/TypeScript-Website/v2/packages/documentation/copy/en/release-notes/TypeScript%206.0.md
- npm metadata of `typescript@7.0.2`

**Findings** [V]:
- typescript-eslint 8.71.1 peers `eslint ^8.57‖^9‖^10` and **`typescript >=4.8.4 <6.1.0`**. Its policy is to support stable TypeScript versions only after a tracking issue closes.
- `typescript@7.0.2` is the native build (per-platform binary dependencies, about 2.5 MB of JS). Its exports are only `./unstable/{ast,sync,async,fs,proto}`; there is no classic compiler API. **typescript-eslint therefore does not support TS 7.**
- TS 6.0 deprecations, which become errors in 7.0 (`ignoreDeprecations: "6.0"` only silences them):
  - `baseUrl`
  - `moduleResolution node`/`node10` and `classic`
  - `target es5`, `downlevelIteration`
  - `module amd|umd|systemjs`
  - `esModuleInterop false` / `allowSyntheticDefaultImports false`
  - `alwaysStrict false`
  - `outFile`
  - `module` keyword namespaces
  - `asserts` on imports
  - `no-default-lib`
- TS 6.0 new defaults:
  - `strict: true`
  - `module: esnext`
  - floating `target` (es2025)
  - **`types: []`** (set `"types": ["node"]` explicitly)
  - **`rootDir: "."`**
  - `noUncheckedSideEffectImports: true`
  - passing CLI files when a tsconfig exists is an error
- TS 6 adds `#/` subpath imports, the `es2025` lib, and Temporal types.

**Recommendation** [J]: **Stay on TS 6.0.3, ESLint 10.12, typescript-eslint 8.71** (D6). Our tsconfigs already use `Node16`/`Bundler`, explicit `types`, explicit `rootDir`, and no `baseUrl`. Keep it that way:
- Use package `exports`/`imports` (`#/…`) instead of `paths`/`baseUrl`.
- `@nestjs/swagger` 12 peers TS `^5.5‖^6`, which is another reason to stay on 6.
- Optionally run `tsgo --noEmit` in CI for speed once you are curious [U: not tested against decorators / `emitDecoratorMetadata`].

---

## 7. BullMQ + Redis client

**Latest:** bullmq **6.3.12 (2026-10-09)**; 6.0.0 shipped 2026-07-30; last v5 is 5.81.5 (2026-09-10). ioredis **6.0.0 (2026-07-31)**; last 5.x is 5.11.1 (2026-06-04). node-redis (`redis`) **6.3.0 (2026-09-30)**. `@nestjs/bullmq` **12.0.0** [V].

**Sources:**
- https://raw.githubusercontent.com/taskforcesh/bullmq/master/docs/gitbook/{changelog,guide/migrations/migrate-from-v5-to-v6,guide/connections,guide/postgresql}.md
- https://raw.githubusercontent.com/redis/ioredis/main/{CHANGELOG,README}.md
- the `@nestjs/bullmq@12.0.0` tarball

**Findings** [V]:
- **BullMQ 6** introduces the `IQueueBackend` abstraction with Redis (default) and **PostgreSQL** backends; the PostgreSQL backend needs PG ≥13 and the `pg` package.
- BullMQ 6 removals and changes:
  - Legacy repeatable APIs removed; use `upsertJobScheduler`/`getJobSchedulers`/`removeJobScheduler`, with `tz: 'UTC'` instead of `utc`.
  - `debounce` removed; use deduplication.
  - `Queue#client`/`Worker#blockingClient` removed (use `getBackend()`).
  - `resume()` is async.
  - `Job#discard()` removed (use `UnrecoverableError`).
  - Flow jobs without `jobId` get UUIDs.
  - The `paused` state is folded into waiting.
  - Telemetry interface changes (`bullmq-otel` 2.0.1).
  - **ioredis is now an optional peer and must be installed explicitly.** The node-redis adapter (`createNodeRedisClient`, redis ≥5) and a Bun adapter also exist.
- `@nestjs/bullmq` 12 keeps the same `connection`/`sharedConnection` options.
- **ioredis 6:** RESP3 by default (`protocol: 2` restores v5 behaviour), Node ≥20, TracingChannel support (since 5.11). The README says it is "a stable project … maintenance best-effort … For new projects, node-redis is the recommended client library."

**Recommendation** [J] (D4 + D5):
- Use **bullmq 6.3.x + @nestjs/bullmq 12 + ioredis 5.11.x**, with an explicit dependency and `maxRetriesPerRequest: null` on worker connections.
- Use Job Schedulers only.
- Evaluate ioredis 6 or node-redis later with an integration spike covering BullMQ workers, the Socket.IO adapter, sessions and rate limiting.
- Do not adopt BullMQ's Postgres backend yet. The outbox stays in Postgres, and the relay pushes to Redis-backed BullMQ as designed.

---

## 8. Logging and observability

**Latest:**
- pino **10.4.0** (2026-10-02; 10.0.0 was 2025-10-03); pino-http **11.0.0** (2025-10-04); nestjs-pino **5.3.1** (2026-10-02, peers pino `^10`, pino-http `^11`, Nest `^11.0.8‖^12.0.2`, Node ≥22.12) [V].
- OpenTelemetry JS: stable packages **2.12.0** (`core`, `sdk-trace-node`, `resources`, `sdk-metrics`); experimental **0.223.0** (`sdk-node`, OTLP exporters, `instrumentation`); `auto-instrumentations-node` **0.81.0**; `api` **1.9.1**; `semantic-conventions` 1.43.0. All published 2026-10-06 except semconv [V].

**Sources:**
- `npm view nestjs-pino readme`
- https://raw.githubusercontent.com/open-telemetry/opentelemetry-js/main/doc/esm-support.md
- the instrumentation READMEs (npm)

**Findings** [V]:
- `auto-instrumentations-node` includes http, express, **nestjs-core** (`@nestjs/core >=4 <13`), **pg** (`>=8.0.3 <9`), **ioredis** (`>=2 <7`), redis, **pino** (`>=5.14 <11`, which does log correlation and log sending), **socket.io** (`>=2 <5`), undici, openai, runtime-node and more.
- The nestjs-core README: "NestJS 12 is published as ESM. CommonJS applications that `require('@nestjs/core')` are instrumented without further setup. ESM applications need the loader hook."
- ESM setup: `node --experimental-loader=@opentelemetry/instrumentation/hook.mjs --import ./telemetry.js`. For CJS: `--require ./telemetry.js`.
- BullMQ tracing uses the separate `bullmq-otel` 2.0.1 (BullMQ 6 telemetry interface).
- nestjs-pino 5.3: `LoggerModule.forRoot({ pinoHttp: {…redact, genReqId, customProps}, assignResponse, forRoutes, exclude })`, `bufferLogs: true`, `PinoLogger.assign()`, `LoggerErrorInterceptor`. A new `microservice: true` option uses Nest 12 pre-request hooks; this is the reason for the ≥12.0.2 floor.

**Recommendation** [J]: **Keep pino 10 + pino-http 11 + nestjs-pino 5.3.**
- Put request context in nestjs-cls and add it through pino `mixin`/`customProps`.
- Use the BACKEND §8 redact list.
- Initialise the OTel `NodeSDK` (sdk-node 0.223 / core 2.12) in a preload file: `--require` while the apps are CJS, or the loader hook plus `--import` if we go ESM.
- Use `getNodeAutoInstrumentations()` with `fs`/`dns`/`net` disabled, the OTLP proto exporters and `bullmq-otel`.
- Skip `@nestjs/observe` (vendor SaaS).

---

## 9. Auth helpers

**Latest** [V]:
- argon2 (node-argon2) **0.45.1** (2026-07-21): N-API addon with prebuilt binaries, falls back to node-gyp, defaults Argon2id m=65536,t=3,p=4.
- @node-rs/argon2 **2.2.2** (2026-10-06): napi-rs, no install scripts, defaults Argon2id m=19456,t=2,p=1.
- otplib **13.5.0** (2026-08-21): v13 is a complete rewrite; TS-first, async-first, functional `generate/verify/generateURI`; `verify` returns a `VerifyResult`; default crypto from audited `@noble/hashes` + `@scure/base`; enforces a 16-byte minimum secret.
- otpauth **9.5.2** (2026-09-03).
- csrf-csrf **4.0.3** (2025-05-27; double-submit cookie, needs cookie-parser).
- cookie-parser 1.4.7; express 5.3.0 is `latest` (Nest 12 pins 5.2.1).

**Sources:** the npm READMEs of each package (`scratchpad/docs/readme-*.md`).

**Recommendation** [J]:
- **Passwords:** `@node-rs/argon2`. It has no native build step, prebuilt binaries cover Linux and musl, and it is actively published. Set the parameters explicitly (for example OWASP m=19456 KiB, t=2, p=1, or higher after benchmarking) and store the PHC string. `argon2` is an equally valid choice; the decision mainly affects install and Docker. Hash OTPs and tokens with SHA-256 or HMAC, not Argon2.
- **TOTP:** `otplib` v13, using the functional API plus a replay guard (store the last used time-step per factor). otpauth is a fine alternative.
- **CSRF:** no library (D8). Our synchronizer token lives in the Redis session; compare it with `crypto.timingSafeEqual`. Also reject state-changing requests whose `Origin`/`Sec-Fetch-Site` is cross-site [J: standard practice, not verified from a primary source here].
- **Cookies:** `cookie-parser` (works with Express 5) or read `req.headers.cookie` with the `cookie` package. Use the `__Host-` prefix, `Secure`, `HttpOnly` and `SameSite=Lax`. Express 5 `res.cookie` is unchanged [U: did not read the Express 5 migration guide].

---

## 10. Socket.IO

**Latest** [V]:
- socket.io **4.8.4** (2026-09-25).
- `@socket.io/redis-adapter` **8.3.0** (2024-03-13, unchanged since).
- `@socket.io/redis-streams-adapter` **0.3.1** (2026-03-12).
- `@nestjs/platform-socket.io` 12.1.2.

**Sources:** https://raw.githubusercontent.com/socketio/socket.io-website/main/docs/categories/05-Adapters/{adapter-redis,adapter-redis-streams,adapter}.md

**Findings** [V]:
- Redis (pub/sub) adapter: "For new developments, we recommend using the **sharded adapter**" (`createShardedAdapter`, Redis ≥7, `ioredis ≥5.9` with `shardedSubscribers: true` in cluster mode). It warns about node-redis subscription restore problems and does **not** support connection state recovery.
- Streams adapter: survives temporary Redis disconnections without losing packets, **supports connection state recovery**, works with ioredis and Valkey, and has `maxLen`/`streamCount` options.

**Recommendation** [J]: Use **socket.io 4.8.x** with **`@socket.io/redis-streams-adapter`** for the `/business` namespace. Our fan-out is the realtime BullMQ consumer emitting to rooms, so delivery after a Redis blip matters, and connection state recovery is useful for dashboards. Alternative: the sharded pub/sub adapter. Use ioredis clients (with `protocol: 2` if on ioredis 6 [U]). Use a custom Nest `IoAdapter` that installs the adapter.

---

## 11. Turborepo 2.11 and tsdown 0.23

**Latest** [V]:
- turbo **2.11.7** (2026-10-02).
- tsdown **0.23.1** (2026-10-10): peers TS `^5‖^6‖^7`, **Node `^22.18‖^24.11‖>=26`**, ESM.

**Sources:**
- the `@turbo/types@2.11.7` `schemas/schema.json` (read directly; no blog post found)
- https://raw.githubusercontent.com/rolldown/tsdown/main/docs/{guide/index,options/dts,guide/migrate-from-tsup}.md
- the WebSearch summary of releases.sh, a secondary source [U]

**Findings** [V, schema]:
- `agentGuidance`: "Controls whether turbo maintains a root `AGENTS.md` block for AI agents. Defaults to `true`." Our `false` setting is valid.
- `futureFlags` worth knowing about:
  - `affectedUsingTaskInputs`, `filterUsingTasks`, `watchUsingTaskInputs`: task-level input-based `--affected`, filter and watch.
  - `globalConfiguration`: moves global keys under `global`.
  - `pruneIncludesGlobalFiles`.
  - `longerSignatureKey`: 32-byte remote cache HMAC.
  - `experimentalObservability`: OTel export of run summaries.
  - experimental Cargo, uv and Go workspaces.
- The secondary source also mentions `turbo prune --production` in 2.11 [U].
- tsdown dts: enabled automatically when `types` exists. With `isolatedDeclarations` it uses oxc, which is very fast; otherwise it falls back to `tsc`.

**Recommendation** [J]:
- **Keep turbo 2.11.x.** Consider `futureFlags.affectedUsingTaskInputs` for CI `--affected`.
- **Keep tsdown 0.23** for contracts and utils, and raise the Node engine (D7).
- Do **not** enable `isolatedDeclarations` in `packages/contracts`: Zod-inferred exports would need explicit annotations everywhere.
- Consider dropping the `cjs` format from contracts once all consumers are ESM or on `require(esm)` [J].

---

## Not verified / gaps
- npm weekly download counts: the API was blocked (403).
- The GitHub releases API was blocked.
- Nest 12 versioning, discovery and durable-provider chapters were not re-read. I assumed no changes because the migration guide lists none.
- The exact error class and shape `StandardSchemaValidationPipe` throws (only the default response body was documented).
- Whether BullMQ 6 and the Socket.IO adapters are fully tested on ioredis 6 with RESP3.
- The Drizzle RLS doc page source; RLS findings come from the typings plus a search summary of the docs page.
- Turborepo 2.11 release notes, beyond the official JSON schema.
