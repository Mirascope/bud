import { SessionsLocalStorage } from "../../../spiders/sessions.local-storage.ts";
import { Agent } from "./agent.ts";
import { Compaction } from "./compaction.ts";
import { System } from "./system.ts";
import {
  Computer,
  runComputerCli,
  type ComputerService,
  type DirectoryEntry,
  type FileContent,
  type FileInfo,
  type TerminalSession,
} from "@bud/computer";
import * as LLM from "@bud/llm";
import { InMemory } from "@bud/object-storage";
import { Sessions } from "@bud/sessions";
import { expect, it } from "@bud/testing";
import { Tools } from "@bud/tools";
import { Effect, Layer, Schema, Stream } from "effect";

function makeResponse(
  args: LLM.ProviderCallArgs,
  content: readonly LLM.AssistantContentPart[],
  finishReason: LLM.FinishReason = "stop",
): LLM.Response {
  return new LLM.Response({
    content,
    finishReason,
    providerId: "mock",
    modelId: args.modelId,
    providerModelName: "mock-model",
    inputMessages: args.messages,
    tools: [],
    toolSchemas: args.tools ?? [],
  });
}

function makeSessionsLayer() {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
  return SessionsLocalStorage({
    namespace: "bud/agent-test",
    now,
  }).pipe(Layer.provide(InMemory.layer({ now })));
}

function makeModelLayer(provider: LLM.ProviderService) {
  return LLM.Model.layerWithDefaultPricing({ modelId: "mock/model" }).pipe(
    Layer.provide(LLM.ProviderRegistry.layer([{ scopes: "mock/", provider }])),
  );
}

function makeLayer(provider: LLM.ProviderService) {
  return Layer.mergeAll(
    makeSessionsLayer(),
    makeModelLayer(provider),
    LLM.ModelInfoDefault,
    System.fromPrompt("You are Bud."),
    Tools.fromArray(),
    Compaction.default(),
  );
}

function decode(content: FileContent): string {
  return content.encoding === "base64" ? atob(content.data) : content.data;
}

function makeInfo(path: string, content: string, updatedAt: string): FileInfo {
  return {
    path,
    kind: "file",
    size: new TextEncoder().encode(content).byteLength,
    updatedAt,
  };
}

function makeComputerLayer() {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
  const files = new Map<string, { content: string; updatedAt: string }>();
  const terminals = new Map<
    string,
    { session: TerminalSession; input: string }
  >();

  const service: ComputerService = {
    list: (path = ".") =>
      Effect.sync(() => {
        const prefix = path === "." ? "" : `${path.replace(/\/$/, "")}/`;
        const entries: DirectoryEntry[] = [];
        for (const [filePath, file] of files) {
          if (!filePath.startsWith(prefix)) continue;
          entries.push({
            path: filePath,
            name: filePath.slice(prefix.length),
            kind: "file",
            size: new TextEncoder().encode(file.content).byteLength,
            updatedAt: file.updatedAt,
          });
        }
        return entries;
      }),
    stat: (path) =>
      Effect.sync(() => {
        const file = files.get(path);
        return file ? makeInfo(path, file.content, file.updatedAt) : null;
      }),
    read: (path, options = {}) =>
      Effect.sync(() => {
        const file = files.get(path);
        if (!file) throw new Error("File not found");
        const data =
          options.encoding === "base64" ? btoa(file.content) : file.content;
        return {
          path,
          content: { data, encoding: options.encoding ?? "utf8" },
          size: new TextEncoder().encode(file.content).byteLength,
          updatedAt: file.updatedAt,
        };
      }),
    write: ({ path, content }) =>
      Effect.sync(() => {
        const decoded = decode(content);
        const updatedAt = now();
        files.set(path, { content: decoded, updatedAt });
        return makeInfo(path, decoded, updatedAt);
      }),
    edit: ({ path, edits }) =>
      Effect.sync(() => {
        const file = files.get(path);
        if (!file) throw new Error("File not found");
        let content = file.content;
        let applied = 0;
        for (const edit of edits) {
          content = edit.replaceAll
            ? content.split(edit.oldText).join(edit.newText)
            : content.replace(edit.oldText, edit.newText);
          applied++;
        }
        const updatedAt = now();
        files.set(path, { content, updatedAt });
        return {
          path,
          applied,
          content: { data: content, encoding: "utf8" as const },
          size: new TextEncoder().encode(content).byteLength,
          updatedAt,
        };
      }),
    remove: (path) =>
      Effect.sync(() => {
        files.delete(path);
      }),
    startTerminal: (options = {}) =>
      Effect.sync(() => {
        const id = `terminal-${terminals.size + 1}`;
        const session: TerminalSession = {
          id,
          shell: options.shell ?? "bash",
          cwd: options.cwd ?? ".",
          status: "running",
          startedAt: now(),
        };
        terminals.set(id, { session, input: "" });
        return session;
      }),
    writeTerminal: (terminalId, input) =>
      Effect.sync(() => {
        const terminal = terminals.get(terminalId);
        if (!terminal) throw new Error("Terminal not found");
        terminal.input += input;
      }),
    readTerminal: (terminalId) =>
      Effect.sync(() => {
        const terminal = terminals.get(terminalId);
        if (!terminal) throw new Error("Terminal not found");
        return {
          terminalId,
          output: `ran: ${terminal.input.trim()}`,
          status: terminal.session.status,
          exitCode: 0,
        };
      }),
    killTerminal: (terminalId) =>
      Effect.sync(() => {
        const terminal = terminals.get(terminalId);
        if (!terminal) return;
        terminal.session = { ...terminal.session, status: "killed" };
      }),
  };

  return Layer.succeed(Computer, service);
}

const computerTool = LLM.defineTool({
  name: "computer",
  description: "Run workspace file operations and terminal commands.",
  schema: Schema.Struct({
    command: Schema.String,
  }),
  tool: ({ command }) =>
    runComputerCli(command).pipe(
      Effect.map((output) => LLM.toolResult(output)),
    ),
});

it.effect("runs a prompt through sessions and hydrates stored media", () => {
  let observedMessages: readonly LLM.Message[] = [];

  const provider: LLM.ProviderService = {
    id: "mock",
    call: (args) =>
      Effect.sync(() => {
        observedMessages = args.messages;
        return makeResponse(args, [{ type: "text", text: "I can see it." }]);
      }),
    stream: () => Stream.empty,
  };

  return Effect.gen(function* () {
    const sessions = yield* Sessions;
    const sessionId = "bud:agent-e2e";
    yield* sessions.create({ sessionId, modelId: "mock/model" });

    const agent = Agent.make({ systemPrompt: "You are Bud." });
    const response = yield* agent.prompt(
      sessionId,
      LLM.user([
        {
          type: "image",
          source: {
            type: "base64_image_source",
            data: "aGVsbG8=",
            mimeType: "image/png",
          },
        },
      ]),
    );

    expect(response.text).toBe("I can see it.");
    expect(observedMessages.map((message) => message.role)).toEqual([
      "system",
      "user",
    ]);
    const userMessage = observedMessages[1];
    expect(userMessage?.role).toBe("user");
    if (userMessage?.role === "user") {
      expect(userMessage.content[0]).toMatchObject({
        type: "image",
        source: {
          type: "base64_image_source",
          data: "aGVsbG8=",
          mimeType: "image/png",
        },
      });
    }

    const entries = yield* sessions.segments.readActive(sessionId);
    const storedUser = entries.find((entry) => entry.type === "user_turn");
    expect(storedUser?.type).toBe("user_turn");
    if (storedUser?.type === "user_turn") {
      expect(storedUser.message.content[0]).toMatchObject({
        type: "image",
        source: {
          type: "object_storage_image_source",
          mimeType: "image/png",
        },
      });
    }

    const turns = yield* sessions.turns(sessionId);
    expect(turns.map((turn) => turn.type)).toEqual([
      "user_turn",
      "assistant_turn",
    ]);
  }).pipe(Effect.provide(makeLayer(provider)));
});

it.effect("runs a tool loop and records the full exchange", () => {
  const add = LLM.defineTool({
    name: "add",
    description: "Add two numbers",
    schema: Schema.Struct({
      a: Schema.Number,
      b: Schema.Number,
    }),
    tool: ({ a, b }) => LLM.toolResult({ sum: a + b }),
  });

  let callCount = 0;
  const observedRoles: LLM.Message["role"][][] = [];

  const provider: LLM.ProviderService = {
    id: "mock",
    call: (args) =>
      Effect.sync(() => {
        callCount++;
        observedRoles.push(args.messages.map((message) => message.role));

        if (callCount === 1) {
          return makeResponse(
            args,
            [
              {
                type: "tool_call",
                id: "call_add",
                name: "add",
                args: JSON.stringify({ a: 2, b: 3 }),
              },
            ],
            "tool_use",
          );
        }

        const last = args.messages.at(-1);
        expect(last?.role).toBe("user");
        if (last?.role === "user") {
          expect(last.content[0]).toMatchObject({
            type: "tool_output",
            id: "call_add",
            name: "add",
            isError: false,
            result: '{"sum":5}',
          });
        }

        return makeResponse(args, [{ type: "text", text: "The sum is 5." }]);
      }),
    stream: () => Stream.empty,
  };

  return Effect.gen(function* () {
    const sessions = yield* Sessions;
    const sessionId = "bud:agent-tools";
    yield* sessions.create({ sessionId, modelId: "mock/model" });

    const agent = Agent.make({
      systemPrompt: "You are Bud.",
      tools: [add],
    });
    const response = yield* agent.prompt(sessionId, LLM.user("2 + 3?"));

    expect(response.text).toBe("The sum is 5.");
    expect(callCount).toBe(2);
    expect(observedRoles).toEqual([
      ["system", "user"],
      ["system", "user", "assistant", "user"],
    ]);

    const turns = yield* sessions.turns(sessionId);
    expect(turns.map((turn) => turn.type)).toEqual([
      "user_turn",
      "assistant_turn",
      "user_turn",
      "assistant_turn",
    ]);

    const messages = yield* sessions.messages(sessionId, {
      systemPrompt: "You are Bud.",
    });
    expect(messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "The sum is 5." }],
    });
  }).pipe(Effect.provide(makeLayer(provider)));
});

it.effect("runs the built-in computer tool through the agent", () => {
  let callCount = 0;

  const provider: LLM.ProviderService = {
    id: "mock",
    call: (args) =>
      Effect.sync(() => {
        callCount++;
        if (callCount === 1) {
          return makeResponse(
            args,
            [
              {
                type: "tool_call",
                id: "call_computer",
                name: "computer",
                args: JSON.stringify({
                  command:
                    "computer write notes.txt --content 'hello from computer'",
                }),
              },
            ],
            "tool_use",
          );
        }

        const last = args.messages.at(-1);
        expect(last?.role).toBe("user");
        if (last?.role === "user") {
          expect(last.content[0]).toMatchObject({
            type: "tool_output",
            id: "call_computer",
            name: "computer",
            isError: false,
          });
          const output = last.content[0];
          if (output?.type === "tool_output") {
            expect(JSON.parse(output.result)).toMatchObject({
              path: "notes.txt",
              kind: "file",
            });
          }
        }

        return makeResponse(args, [{ type: "text", text: "Done." }]);
      }),
    stream: () => Stream.empty,
  };

  return Effect.gen(function* () {
    const sessions = yield* Sessions;
    const computer = yield* Computer;
    const sessionId = "bud:agent-computer";
    yield* sessions.create({ sessionId, modelId: "mock/model" });

    const agent = Agent.make({
      systemPrompt: "You are Bud.",
      tools: [computerTool],
    });
    const response = yield* agent.prompt(sessionId, LLM.user("Write a note."));

    expect(response.text).toBe("Done.");
    const file = yield* computer.read("notes.txt");
    expect(file.content.data).toBe("hello from computer");

    const turns = yield* sessions.turns(sessionId);
    expect(turns.map((turn) => turn.type)).toEqual([
      "user_turn",
      "assistant_turn",
      "user_turn",
      "assistant_turn",
    ]);
  }).pipe(
    Effect.provide(Layer.merge(makeLayer(provider), makeComputerLayer())),
  );
});
