import type { AvatarEngine } from "./engine";
import type { AudioPacket } from "./types";
import {
  resolveWordTimings,
  scaleWordTimings,
} from "./lipsync";

const LIP_DEBUG =
  import.meta.env.DEV || import.meta.env.VITE_LIPSYNC_DEBUG === "1";

function lipDebug(message: string, details?: unknown): void {
  if (!LIP_DEBUG) return;
  if (details === undefined) {
    console.log(`[lipdebug][queue] ${message}`);
    return;
  }
  console.log(`[lipdebug][queue] ${message}`, details);
}

export class AudioQueue {
  private engine: AvatarEngine;
  private onSizeChange?: (size: number) => void;
  private onError?: (err: unknown) => void;

  private sessionStartMs: number | null = null;
  private timelineBaseOffsetSec = 0;
  private nextSeq = 0;
  private pending = new Map<number, AudioPacket>();
  private autoSeq = 0;
  private scheduled = 0;
  private firstChunkScheduled = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    engine: AvatarEngine,
    onSizeChange?: (size: number) => void,
    onError?: (err: unknown) => void,
  ) {
    this.engine = engine;
    this.onSizeChange = onSizeChange;
    this.onError = onError;
  }

  getSize(): number {
    return this.pending.size + this.scheduled;
  }

  ensureSession(): void {
    if (this.sessionStartMs !== null) return;
    this.sessionStartMs = performance.now();
    this.timelineBaseOffsetSec = 0;
    this.nextSeq = 0;
    this.pending.clear();
    this.autoSeq = 0;
  }

  onSessionOpen(): void {
    this.clearTimers();
    this.sessionStartMs = performance.now();
    this.timelineBaseOffsetSec = 0;
    this.nextSeq = 0;
    this.pending.clear();
    this.autoSeq = 0;
    this.scheduled = 0;
    this.firstChunkScheduled = false;
    this.syncSize();
  }

  onSessionClose(): void {
    this.clearTimers();
    this.sessionStartMs = null;
    this.pending.clear();
    this.nextSeq = 0;
    this.scheduled = 0;
    this.firstChunkScheduled = false;
    this.syncSize();
  }

  enqueue(packet: AudioPacket): Promise<void> {
    this.ensureSession();

    const seq =
      typeof packet.chunk_seq === "number"
        ? packet.chunk_seq
        : this.autoSeq++;

    this.pending.set(seq, packet);
    this.syncSize();
    this.releaseSequential();

    return Promise.resolve();
  }

  clear(): void {
    this.clearTimers();
    this.pending.clear();
    this.nextSeq = 0;
    this.scheduled = 0;
    this.syncSize();
  }

  private clearTimers(): void {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }

  private syncSize(): void {
    this.onSizeChange?.(this.pending.size + this.scheduled);
  }

  private releaseSequential(): void {
    while (this.pending.has(this.nextSeq)) {
      const packet = this.pending.get(this.nextSeq)!;
      this.pending.delete(this.nextSeq);
      this.nextSeq += 1;
      this.syncSize();
      this.schedulePacket(packet);
    }

    if (this.pending.size > 0) {
      const minKey = Math.min(...this.pending.keys());
      if (minKey > this.nextSeq) {
        this.nextSeq = minKey;
        this.releaseSequential();
      }
    }
  }

  private schedulePacket(packet: AudioPacket): void {
    if (this.sessionStartMs === null) this.ensureSession();

    const fishOffset = packet.chunk_audio_offset_sec ?? 0;
    if (!this.firstChunkScheduled) {
      this.firstChunkScheduled = true;
      this.timelineBaseOffsetSec = fishOffset;
    }
    const relativeSec = Math.max(0, fishOffset - this.timelineBaseOffsetSec);
    const playAt = this.sessionStartMs! + relativeSec * 1000;
    const delay = Math.max(0, playAt - performance.now());

    this.scheduled += 1;
    this.syncSize();

    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.scheduled = Math.max(0, this.scheduled - 1);
      this.syncSize();
      void this.process(packet).catch((err) => this.onError?.(err));
    }, delay);

    this.timers.add(timer);
  }

  private async process(packet: AudioPacket): Promise<void> {
    lipDebug("process: packet received", {
      seq: packet.chunk_seq ?? null,
      offsetSec: packet.chunk_audio_offset_sec ?? null,
      captionChars: packet.caption?.length ?? 0,
      words: packet.words?.length ?? 0,
      wtimes: packet.wtimes?.length ?? 0,
      wdurations: packet.wdurations?.length ?? 0,
      alignSegments: packet.alignment?.segments?.length ?? 0,
      bytes: packet.audio.byteLength,
    });

    const audioBuffer = await this.engine.decodeAudio(packet.audio);
    const audioMs = audioBuffer.duration * 1000;

    const plan = resolveWordTimings(
      packet,
      audioMs,
      packet.chunk_audio_offset_sec,
    );
    if (plan && plan.words.length > 0) {
      const scaled = scaleWordTimings(
        plan.wtimes,
        plan.wdurations,
        audioMs,
      );
      const sample = Math.min(3, plan.words.length);
      const timelineEnd =
        scaled.wtimes[scaled.wtimes.length - 1]! +
        scaled.wdurations[scaled.wdurations.length - 1]!;
      lipDebug("process: word plan resolved", {
        source: packet.words?.length
          ? "direct"
          : packet.alignment?.segments?.length
            ? "alignment"
            : "caption-estimate",
        audioMs,
        words: plan.words.length,
        firstWords: plan.words.slice(0, sample),
        firstWTimesRaw: plan.wtimes.slice(0, sample),
        firstWDurationsRaw: plan.wdurations.slice(0, sample),
        firstWTimesScaled: scaled.wtimes.slice(0, sample),
        firstWDurationsScaled: scaled.wdurations.slice(0, sample),
        timelineEndScaledMs: timelineEnd,
      });
      this.engine.enqueueDecodedAudio({
        audio: audioBuffer,
        durationMs: audioMs,
        wordPlan: {
          words: plan.words,
          wtimes: scaled.wtimes,
          wdurations: scaled.wdurations,
        },
      });
      return;
    }

    lipDebug("process: no word plan, audio-only fallback", {
      audioMs,
      hasCaption: Boolean(packet.caption?.trim()),
    });
    if (packet.caption?.trim()) {
      this.engine.showCaption(packet.caption.trim());
    }

    this.engine.enqueueDecodedAudio({
      audio: audioBuffer,
      durationMs: audioMs,
    });
  }
}
