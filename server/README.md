# Server (planned)

Not built yet — this phase was client-only. This is the intended shape so the
handoff from the client's localStorage-backed repositories is a drop-in swap.

## Stack

- **Node + Express** — HTTP API
- **MongoDB** (via Mongoose) — persistence
- **LangGraph.js** (`@langchain/langgraph`) — actually runs the agent graph
  server-side, replacing `client/src/features/workflow-runner/engine/graphExecutor.ts`
- **Azure OpenAI** — same LLM backend the client already talks to directly;
  the server will hold the credentials instead of the browser

## Why the client already looks like this is coming

Every piece of client "server state" goes through a thin repository in
`client/src/shared/api/*Repository.ts` (`workflowRepository`, `toolRepository`,
`settingsRepository`). Each function is already `async` and returns the exact
shape the UI expects — right now the body reads/writes `localStorage`, but a
repository's job is to become a `fetch()` call to the endpoints below with no
change to any calling code (the `@tanstack/react-query` hooks in
`client/src/features/*/hooks/use*.ts` don't care where the data comes from).

## Planned endpoints

Workflows and tools are **per user** (one workflow per user, per the client's
model), so every route is scoped to the authenticated user once auth exists.

```
GET    /api/workflow              # the current user's single workflow
PUT    /api/workflow              # save it (autosaved by the client today)
POST   /api/workflow/reset        # replace with a fresh template

GET    /api/tools                 # list this user's tools
POST   /api/tools                 # create
PUT    /api/tools/:id             # update
DELETE /api/tools/:id             # delete

GET    /api/settings              # azure endpoint/deployment (never the raw key back to the client)
PUT    /api/settings

POST   /api/chat/run              # runs the workflow via LangGraph.js and
                                   # streams back node-enter/exit, messages,
                                   # and tool-call events (SSE or WS) — the
                                   # client's `graphExecutor.ts` callback shape
                                   # (`onNodeEnter`/`onNodeExit`/`onMessage`/
                                   # `onToolCall`) was designed to map directly
                                   # onto this stream
```

## Client tool calls stay client-side

The workflow model has two tool execution types (`entities/tool/model/types.ts`):

- **`server`** — the backend executes it (the Mongo document already carries a
  `serverActionNote` describing what it should do; today the client just
  simulates the result so flows are testable end to end).
- **`client`** — always runs in the browser (API calls the browser is
  positioned to make, UI state updates, anything needing the user's local
  context). When the server runs the graph, it must pause the LangGraph run
  on a `client` tool call, send the tool call down to the browser over the
  same stream, wait for the client to execute it and post the result back,
  then resume — the same pause/resume shape LangGraph's own
  `interrupt`/checkpoint support is built for.

## Suggested layout when this gets built

```
server/
  src/
    app.ts                # express app wiring
    server.ts              # entrypoint
    db/
      connection.ts
      models/
        Workflow.ts
        Tool.ts
        Settings.ts
        User.ts
    routes/
      workflow.routes.ts
      tools.routes.ts
      settings.routes.ts
      chat.routes.ts
    graph/
      buildLangGraph.ts    # translates the stored Workflow (nodes/edges) into
                            # an actual LangGraph StateGraph, mirroring
                            # client/src/features/workflow-runner/engine
      nodes/                # agent/router node runners
    middleware/
      auth.ts
  package.json
  tsconfig.json
```
