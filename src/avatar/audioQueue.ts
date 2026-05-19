import type { AvatarEngine } from "./engine";
import type { AudioPacket } from "./types";
import {
  buildVisemeTrack,
  resolveWordTimings,
  scaleWordTimings,
} from "./lipsync";

export class AudioQueue {
  private engine: AvatarEngine;
  private onSizeChange?: (size: number) => void;
  private onError?: (err: unknown) => void;

  private sessionStartMs: number | null = null;
  /** First chunk's Fish offset — rebased so the viewer starts playing immediately. */
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

  /** Release chunk_seq 0, 1, 2… as they become available (no blocking chain). */
  private releaseSequential(): void {
    while (this.pending.has(this.nextSeq)) {
      const packet = this.pending.get(this.nextSeq)!;
      this.pending.delete(this.nextSeq);
      this.nextSeq += 1;
      this.syncSize();
      this.schedulePacket(packet);
    }

    // If we missed early chunks (viewer joined late), skip the gap.
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
    if (packet.caption?.trim()) {
      this.engine.showCaption(packet.caption.trim());
    }

    const audioBuffer = await this.engine.decodeAudio(packet.audio);
    const audioMs = audioBuffer.duration * 1000;

    const plan = resolveWordTimings(
      packet,
      audioMs,
      packet.chunk_audio_offset_sec,
    );

    if (plan && plan.words.length > 0) {
      const scaled = scaleWordTimings(plan.wtimes, plan.wdurations, audioMs);
      const track = buildVisemeTrack({
        words: plan.words,
        wtimes: scaled.wtimes,
        wdurations: scaled.wdurations,
      });

      if (track.visemes.length > 0) {
        this.engine.enqueueDecodedAudio({
          audio: audioBuffer,
          durationMs: audioMs,
          lipTrack: track,
          captionPlan: {
            words: plan.words,
            wtimes: scaled.wtimes,
            wdurations: scaled.wdurations,
          },
        });
        return;
      }
    }

    this.engine.enqueueDecodedAudio({
      audio: audioBuffer,
      durationMs: audioMs,
    });
  }
}
