import type {
  SessionEntry,
  SessionError,
  SessionId,
} from "./sessions.schemas.ts";
import type { Effect } from "effect";
import { Schema } from "effect";

export const SegmentInfo = Schema.Struct({
  index: Schema.Number,
  segmentRef: Schema.String,
  sizeBytes: Schema.Number,
  modelId: Schema.String,
  timestamp: Schema.String,
  turnCount: Schema.Number,
  hasCompaction: Schema.Boolean,
  pastMessageCount: Schema.Number,
});
export type SegmentInfo = typeof SegmentInfo.Type;

export interface ScanSegmentResult {
  readonly entries: SessionEntry[];
  readonly segmentCount: number;
  readonly segmentIndex: number;
}

export interface ScanSegmentOptions {
  readonly segmentIndex?: number;
  readonly since?: string;
  readonly until?: string;
  readonly limit?: number;
  readonly order?: "asc" | "desc";
}

export interface SegmentsService {
  readonly list: (
    sessionId: SessionId,
  ) => Effect.Effect<SegmentInfo[], SessionError>;

  readonly read: (
    sessionId: SessionId,
    segmentIndex: number,
  ) => Effect.Effect<SessionEntry[], SessionError>;

  readonly readActive: (
    sessionId: SessionId,
  ) => Effect.Effect<SessionEntry[], SessionError>;

  readonly scan: (
    sessionId: SessionId,
    options: ScanSegmentOptions,
  ) => Effect.Effect<ScanSegmentResult, SessionError>;
}
