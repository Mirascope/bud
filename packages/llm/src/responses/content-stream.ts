import type { ProviderError } from "../providers/provider.schemas.ts";
import type { Stream } from "effect";

/** A sub-stream of text deltas for a single text content block. */
export class TextContentStream {
  readonly type = "text" as const;
  partialText: string = "";
  readonly deltas: Stream.Stream<string, ProviderError>;

  constructor(deltas: Stream.Stream<string, ProviderError>) {
    this.deltas = deltas;
  }
}

/** A sub-stream of thought deltas for a single thought content block. */
export class ThoughtContentStream {
  readonly type = "thought" as const;
  partialThought: string = "";
  readonly deltas: Stream.Stream<string, ProviderError>;

  constructor(deltas: Stream.Stream<string, ProviderError>) {
    this.deltas = deltas;
  }
}

/** A sub-stream of argument deltas for a single tool call content block. */
export class ToolCallContentStream {
  readonly type = "tool_call" as const;
  readonly id: string;
  readonly name: string;
  partialArgs: string = "";
  readonly deltas: Stream.Stream<string, ProviderError>;

  constructor(
    id: string,
    name: string,
    deltas: Stream.Stream<string, ProviderError>,
  ) {
    this.id = id;
    this.name = name;
    this.deltas = deltas;
  }
}

export type ContentStream =
  | TextContentStream
  | ThoughtContentStream
  | ToolCallContentStream;
