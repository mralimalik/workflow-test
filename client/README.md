# Agent Studio — client

A visual builder for agentic workflows: drag out Start → Agent(s) → Router →
End nodes on a canvas, give each agent its own instructions/model/tools, wire
up branching, then test the whole thing in a real chat window against Azure
OpenAI. See the [repo root README](../README.md) for the big picture and the
[server README](../server/README.md) for what's next.

## Run it

```bash
npm install
npm run dev
```

Then open Settings and add your Azure OpenAI endpoint, API key, and
deployment name before using the Chat tester — everything else works
without any backend.

## Architecture

No backend exists yet, so this phase had to stand on its own: it's built so
that plugging in the real Express/Mongo/LangGraph.js server later touches as
few files as possible.

```
src/
  app/                    # composition root: providers, router, shell layout
  pages/                  # one file per route, each just lays out features
  features/                # UI + hooks for one user-facing capability
    workflow-builder/      #   the React Flow canvas, node inspector, palette
    tools/                  #   tool CRUD UI
    settings/               #   Azure OpenAI connection form
    chat-tester/            #   chat window, run trace, read-only graph preview
    workflow-runner/        #   the execution engine (no React in here)
  entities/                # domain types + state for each core concept
    workflow/               #   Workflow/Node/Edge types, the canvas zustand store, graph/validation helpers
    tool/                    #   Tool types
    chat/                     #   ChatMessage types + the chat zustand store
    run/                      #   execution-status zustand store (drives the "active node" glow)
    settings/                 #   AzureOpenAISettings type
  shared/
    api/                    # localStorage-backed repositories shaped like a REST client
    lib/                     # cn(), id generation, the Azure OpenAI fetch client
    ui/                       # shadcn-style primitives (button, dialog, select, ...)
```

**State management split on purpose:**
- **`@tanstack/react-query`** owns anything that's conceptually "server data" —
  the workflow document, the tools list, settings — fetched through a
  `shared/api/*Repository.ts` module. Today that module reads/writes
  `localStorage`; swapping it for real `fetch()` calls won't touch a single
  component.
- **`zustand`** owns client-only runtime state that React Query isn't a good
  fit for: the live node/edge graph while you're editing it
  (`entities/workflow/model/canvasStore.ts`), the chat transcript
  (`entities/chat/model/chatStore.ts`), and the in-flight run's status per
  node (`entities/run/model/runStore.ts`, which is what makes the active node
  glow on the canvas during a chat run).

## The workflow model

A workflow is one Start node, any number of Agent/Router nodes, and at least
one End node (`entities/workflow/model/types.ts`). Single workflow per user —
there's no workflow list, just one document the Builder page edits in place
and autosaves (debounced) via `useWorkflowSync`.

- **Agent** — a system prompt, a model config (Azure deployment override,
  temperature, top-p, max tokens), and a set of tools it's allowed to call.
  Always has exactly one outgoing edge.
- **Router** — either asks the model to pick a branch via forced
  function-calling (`mode: 'llm'`), or matches keywords against the latest
  user message with no LLM call at all (`mode: 'first-match'`). Every rule
  gets its own source handle on the node, plus an always-present `default`
  fallback handle.
- **End** — terminates the run.

## Tools: server-side vs. client-side

Every tool (`entities/tool/model/types.ts`) declares `executionType`:

- **`client`** — a JS function body stored on the tool, executed right in the
  browser via `features/workflow-runner/engine/clientToolRunner.ts` when the
  agent calls it (think: an API fetch the browser is positioned to make, or a
  UI state update). Its return value is sent back to the model so it can
  continue — the same pause/resume shape you'd want from a real backend.
- **`server`** — describes an action the (future) backend will perform. With
  no backend connected yet, the engine returns a clearly-labeled simulated
  result so you can still test the full flow shape.

## The execution engine

`features/workflow-runner/engine/graphExecutor.ts` is plain TypeScript, no
React or Zustand imports — it walks the graph from Start, and for each node
either runs an agent's tool-calling loop against Azure OpenAI or resolves a
router's branch, emitting callbacks (`onNodeEnter`, `onNodeExit`, `onMessage`,
`onToolCall`) along the way. `features/chat-tester/hooks/useChatRunner.ts` is
the only place those callbacks get wired into the zustand stores that drive
the UI — this separation is what would let the same engine shape get
reimplemented as an actual LangGraph.js `StateGraph` on the server without
the UI code changing.

## Azure OpenAI from the browser

`shared/lib/azureOpenAI/client.ts` calls the Azure Chat Completions REST API
directly with `fetch`. The API key lives only in this browser's
`localStorage`. If you see a network error testing the connection, your
Azure OpenAI resource likely needs CORS enabled for this origin (Azure Portal
→ your resource → Resource Management → CORS) — expected, since this is a
client-only phase; the real backend will proxy these calls instead.
