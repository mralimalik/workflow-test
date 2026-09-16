# Agent Studio

A learning project: a full-stack app for visually building agentic
workflows — single-agent or multi-agent, each agent with its own
instructions, model settings, and tools — plus a chat window to actually run
and test what you built.

```
client/   React + TypeScript app: the workflow builder, tools UI, settings, chat tester
server/   Not built yet — see server/README.md for the planned Express/Mongo/LangGraph.js shape
```

## Status

This pass built the **client only**, on purpose — no backend exists yet.
Everything that will eventually be "server data" (the workflow document, the
tools list, settings) goes through a small repository layer
(`client/src/shared/api/*Repository.ts`) that's already async and already
shaped like a REST client; it just reads/writes `localStorage` for now. The
chat tester calls Azure OpenAI directly from the browser (bring your own
endpoint/key/deployment in Settings) so the whole builder → test loop
actually works today, with no backend required.

See `client/README.md` for the architecture in detail, and `server/README.md`
for what the Express/MongoDB/LangGraph.js backend will look like and exactly
where it plugs in.

## Quick start

```bash
cd client
npm install
npm run dev
```

Open the app, go to **Settings** and add your Azure OpenAI endpoint, API
key, and deployment name, then build a workflow on the **Builder** page and
try it on the **Chat tester** page.

## What's here

- **Builder** — a React Flow canvas: drag out Start / Agent / Router / End
  nodes, wire them together, configure each agent's prompt/model/tools in a
  side panel. Autosaves. Live validation (unreachable nodes, missing
  connections, etc.).
- **Tools** — define functions agents can call. `client`-executed tools run
  a JS handler right in the browser (API calls, UI state updates — anything
  this browser is positioned to do) and hand the result back to the agent to
  resume. `server`-executed tools are a spec for the backend to fulfill
  later; today they return a clearly labeled simulated result.
- **Chat tester** — a real conversation against your workflow, with a
  read-only mini graph that highlights the active node live and a
  step-by-step run trace, so multi-agent handoffs and routing decisions are
  visible as they happen.
- **Settings** — your Azure OpenAI connection, with a one-click connection
  test.
