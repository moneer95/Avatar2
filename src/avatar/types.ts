// Shared types used by the avatar engine, speech pipeline, and WebSocket
// transport. The packet shape is the single contract for the lip-sync rule.

export type AvatarStatus =
  | "idle"
  | "loading"
  | "ready"
  | "speaking"
  | "gesture"
  | "error";

// One audio packet from the sender. Per the spec:
//   - `audio` is always present (PCM Float32 mono or an encoded buffer).
//   - If `words`, `wtimes`, and `wdurations` are ALL present, the mouth moves.
//   - Otherwise the mouth stays neutral and the audio just plays.
export interface AlignmentSegment {
  text: string;
  start: number;
  end: number;
}

export interface AudioPacket {
  audio: ArrayBuffer;
  sampleRate?: number;
  mime?: string;
  words?: string[];
  wtimes?: number[];
  wdurations?: number[];
  /** Audiofish chunk index — playback order is 0, 1, 2, … */
  chunk_seq?: number;
  /** Seconds from session `open` when this chunk should start on the timeline */
  chunk_audio_offset_sec?: number;
  /** Full sentence caption for this chunk */
  caption?: string;
  /** Fish alignment — used to build word timings when wtimes are missing */
  alignment?: {
    segments?: AlignmentSegment[];
    audio_duration?: number;
  };
}

export interface AudioPacketMeta {
  hasTimings: boolean;
  durationMs: number;
}
