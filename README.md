# Bud

Bud is a service-layer foundation for building AI agents that can live anywhere.

Most agent frameworks begin with a loop and then make everything else fit around
it: model calls, tools, memory, files, scheduling, identity, persistence, UI. Bud
starts one layer lower. It defines the core services an agent needs, composes
them with Effect, and leaves the live implementation up to the environment you
want to run in.

That means Bud can become a browser-native assistant, a Mac mini agent, a local
CLI, a background process, or a product agent with its own memory, storage,
model routing, tools, and runtime. Bud is the base from which you grow your own
persistent AI agent.

At Mirascope, that shape is what lets us build [DURAMATA](https://duramata.com)
Sprites: custom agents with their own identity, tools, persistent runtime,
sessions, computer access, journal, and scheduled work. This repository is the
open core of that idea.

## Why Bud

Bud is for people who want agents as infrastructure, not just prompts with a
chat box.

- **Bring your own implementations.** Every important capability is a service
  interface. Swap IndexedDB for object storage, WebContainers for a local shell,
  hosted LLMs for local WebLLM, or a simple in-memory test double for all of it.
- **Compose with Effect.** Services are provided as layers, so your app decides
  exactly which runtime, providers, tools, storage, and schedulers exist.
- **Keep the agent loop portable.** The agent does not need to know whether it is
  running in a browser, a Mac mini process, a local service, or a CLI.
- **Model tools as first-class services.** Computer, Identity, Journal, and Cron
  expose CLI-shaped tool surfaces, so the same capabilities can be used by an
  agent, tests, or humans.
- **Grow beyond Bud.** Bud is intentionally a base layer. Your product can build
  its own domain-specific agent on top without forking the core abstractions.

## Architecture

The top-level `Bud` service composes smaller service contracts:

```txt
Bud
├─ Agent       agent loop, tools, system prompt, compaction
├─ LLM         model/provider interfaces, streaming responses, pricing/model info
├─ Sessions    session and segment persistence contracts
├─ Tools       tool registry and in-process CLI execution helpers
├─ Computer    read/write/edit/list/bash/terminal workspace interface
├─ Identity    agent identity surface
├─ Journal     durable notes/events surface
├─ Cron        scheduled trigger surface
├─ Gateway     queue/process boundary for running agent work
└─ Storage     object storage abstractions used by implementations
```

The `packages/*` directories are mostly implementation-agnostic contracts and
helpers. Live browser-oriented implementations currently live in `spiders/` and
the demo.

## Service Packages

- `packages/llm` - messages, content parts, streaming responses, providers,
  pricing, model info, WebLLM/OpenAI/Anthropic/Google support.
- `packages/agent` - the model/tool loop, streaming agent events, compaction,
  system prompt service, and tool execution.
- `packages/sessions` - session, segment, exchange, and compaction data
  contracts.
- `packages/tools` - the `Tools` service and helpers for running Effect CLIs
  in-process.
- `packages/computer` - workspace file operations and terminal abstractions,
  plus the `computer` CLI/tool.
- `packages/identity`, `packages/journal`, `packages/cron` - service contracts
  and CLI/tool surfaces for agent-level domain capabilities.
- `packages/gateway` - the gateway contract for queueing and running work.
- `packages/object-storage` - platform-neutral object storage interfaces and
  browser storage helpers.
- `packages/testing` - test utilities, including HTTP recording support for
  provider tests.

## Customize Bud

Bud is meant to become your agent. Start with the core service shape, then give
it a name, identity, tools, storage, model routing, and runtime that fit the
thing you want to grow.

```ts
import { Bud } from "@mirascope/bud";
import { Layer } from "effect";

const Acorn = Bud.layer({
  systemPrompt: "You are Acorn, a careful project assistant.",
  modelId: "anthropic/claude-haiku-4-5",
}).pipe(
  Layer.provide(AcornComputer),
  Layer.provide(AcornSessions),
  Layer.provide(AcornGateway),
  Layer.provide(AcornIdentity),
  Layer.provide(AcornJournal),
  Layer.provide(AcornCron),
  Layer.provide(AcornModel),
  Layer.provide(AcornModelInfo),
);
```

Those layers are where Acorn becomes real. They decide where it runs, where it
remembers, which tools it can use, and which models it can call:

- Browser app: IndexedDB, WebLLM, WebContainers.
- Local machine: filesystem storage, a long-running process, hosted model APIs,
  and a real shell.
- Mac mini agent: always-on local services, persistent sessions, scheduled work,
  and custom tools.
- CLI: in-process services for focused local workflows.
- Test suite: in-memory sessions, fake model provider, fake computer.

Bud does not force one runtime. It gives each runtime the same shape.

## Spiders Demo

The demo is a browser-native Bud implementation. We call this shape a **Spider**:
an agent process that runs on the web.

The React UI is intentionally thin. It composes the same Bud service layers
in-process, backed by browser storage, local model support, and server-side
provider proxies for hosted models.

Run it:

```sh
bun install
cd demo
bun run dev
```

Then open:

```txt
http://localhost:4322
```

Cloud providers are enabled server-side with environment variables in
`demo/.env`:

```sh
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=
```

See `demo/.env.example` for the expected names.

The browser demo can also prepare local WebLLM models when the browser supports
WebGPU and cross-origin isolation. Some embedded browsers do not provide the
right isolation guarantees; Chrome or Chrome Canary is the best target for local
model experiments.

## Development

Useful commands:

```sh
bun run check
bun run test
cd demo && bun run build
```

The codebase is still early and evolving quickly. The important invariant is the
architecture: service contracts stay portable, live implementations stay
replaceable, and Bud remains the composition point.

## License

Bud is released under the MIT License. See [LICENSE](./LICENSE).
