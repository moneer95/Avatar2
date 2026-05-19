import { TalkingHead, type SpeakAudioPayload } from "talkinghead";
import { ASSETS, type ClipName } from "./assets";
import {
  buildVisemeTrack,
  resolveWordTimings,
  type VisemeTrack,
  type WordTimingPlan,
} from "./lipsync";
import { MorphDriver } from "./morphDriver";

// AvatarEngine wraps TalkingHead so the rest of the app sees a small, stable
// surface: load the avatar, switch clips, queue speech, tear down. It owns the
// "what is the avatar doing right now?" state machine in one place.

export type EngineMood =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "fear"
  | "disgust"
  | "love"
  | "sleep";

export interface EngineEvents {
  onSpeakStart?: () => void;
  onQueueDrain?: () => void;
  onError?: (err: unknown) => void;
  onSubtitle?: (word: string) => void;
}

export interface EngineInitOptions {
  mood?: EngineMood;
  cameraView?: "full" | "upper" | "head" | "mid";
  fps?: number;
  pixelRatio?: number;
}

interface QueueItem {
  audio: AudioBuffer;
  durationMs: number;
  lipTrack?: VisemeTrack;
  /** Word timings for Live Caption (not sent to TalkingHead). */
  captionPlan?: WordTimingPlan;
}


const DEFAULTS: Required<EngineInitOptions> = {
  mood: "neutral",
  cameraView: "upper",
  fps: 30,
  pixelRatio: Math.min(2, window.devicePixelRatio || 1),
};

export class AvatarEngine {
  private head: TalkingHead | null = null;
  private container: HTMLElement;
  private events: EngineEvents;
  private currentClip: ClipName | null = null;
  // Speech is tracked by a counter rather than booleans so that overlapping
  // enqueue/finish callbacks can never desync.
  private outstanding = 0;
  private destroyed = false;
  private audioCtx: AudioContext | null = null;
  private morphDriver = new MorphDriver();

  constructor(container: HTMLElement, events: EngineEvents = {}) {
    this.container = container;
    this.events = events;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async init(opts: EngineInitOptions = {}): Promise<void> {
    const o = { ...DEFAULTS, ...opts };
    // A prior instance may have been destroyed (React Strict Mode runs effects
    // twice in dev). Allow a fresh init on the same engine object.
    this.destroyed = false;

    this.head = new TalkingHead(this.container, {
      // No Google Cloud TTS URL — Make Speak uses the browser speech API instead
      // (see speakText). Do not set ttsEndpoint to null: TalkingHead stringifies
      // it and POSTs to "/null".
      ttsEndpoint: "",
      ttsTrimStart: 0,
      ttsTrimEnd: 0,
      lipsyncModules: [],
      lipsyncLang: "en",
      cameraView: o.cameraView,
      cameraRotateEnable: true,
      cameraPanEnable: false,
      cameraZoomEnable: true,
      avatarMood: o.mood,
      avatarMute: false,
      modelPixelRatio: o.pixelRatio,
      modelFPS: o.fps,
      dracoEnabled: true,
    });
    await this.head.showAvatar({
      url: ASSETS.avatarUrl,
      body: "M",
      avatarMood: o.mood,
      lipsyncLang: "en",
    });
    // Boot idle once the model is in. Skip if teardown already ran (Strict Mode
    // cleanup can finish before this async init does).
    if (!this.destroyed && this.head) {
      void this.playClip("idle", { loop: true });
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.morphDriver.stop();
    try {
      this.head?.stopSpeaking();
    } catch {
      /* noop */
    }
    try {
      this.head?.stop();
    } catch {
      /* noop */
    }
    if (this.audioCtx && this.audioCtx.state !== "closed") {
      void this.audioCtx.close().catch(() => undefined);
    }
    this.audioCtx = null;
    this.head = null;
  }

  // ---------------------------------------------------------------------------
  // Animation clips
  // ---------------------------------------------------------------------------

  async playClip(
    name: ClipName,
    opts: { loop?: boolean; durationMs?: number } = {},
  ): Promise<void> {
    if (this.destroyed || !this.head) return;
    const head = this.head;
    const url = ASSETS.clips[name];
    if (!url) throw new Error(`Unknown clip: ${name}`);

    this.currentClip = name;

    // TalkingHead.playAnimation crossfades automatically. Passing a numeric
    // duration in seconds caps the clip; omit for natural loops.
    const dur = opts.durationMs ? opts.durationMs / 1000 : undefined;
    await head.playAnimation(url, undefined, dur, 0, 1);

    // For one-shot clips (e.g. wave), schedule a return-to-idle once the clip
    // ends. TalkingHead itself doesn't fire a "clip ended" event publicly, so
    // we rely on the duration we asked for.
    if (!opts.loop && dur && name !== "idle") {
      window.setTimeout(() => {
        if (this.destroyed) return;
        if (this.currentClip !== name) return; // user switched away
        void this.playClip("idle", { loop: true });
      }, dur * 1000);
    }
  }

  getCurrentClip(): ClipName | null {
    return this.currentClip;
  }

  /** Show full sentence in the Live Caption panel. */
  showCaption(text: string): void {
    this.events.onSubtitle?.(text);
  }

  // Wave gesture — uses the wave clip if available, then blends back to idle.
  async wave(durationMs = 2600): Promise<void> {
    await this.playClip("wave", { durationMs });
  }

  // ---------------------------------------------------------------------------
  // Speech: browser TTS (Phase 1)
  // ---------------------------------------------------------------------------

  async speakText(text: string): Promise<void> {
    if (this.destroyed || !this.head) return;
    const head = this.head;
    const trimmed = text.trim();
    if (!trimmed) return;
    this.beginSpeech();
    try {
      const estimatedMs = Math.max(1200, trimmed.length * 50);
      const plan = resolveWordTimings({ caption: trimmed }, estimatedMs);

      if (plan) {
        const track = buildVisemeTrack(plan);
        const silent = await this.createSilentBuffer(estimatedMs / 1000);
        this.morphDriver.scheduleCaptions(plan, (word) =>
          this.events.onSubtitle?.(word),
        );
        this.speakAudioWithVisemes(head, silent, track, estimatedMs);
      }

      await this.browserSpeak(trimmed);
    } finally {
      this.endSpeech();
    }
  }

  /** Web Speech API — Phase 1 local TTS (no network). */
  private browserSpeak(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const synth = window.speechSynthesis;
      if (!synth) {
        reject(new Error("Speech synthesis is not available in this browser."));
        return;
      }
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "en-US";
      utter.onend = () => resolve();
      utter.onerror = (event) => {
        // "interrupted" fires when the user hits Stop — treat as a clean end.
        if (event.error === "interrupted") {
          resolve();
          return;
        }
        reject(new Error(event.error || "Speech synthesis failed"));
      };
      synth.speak(utter);
    });
  }

  // ---------------------------------------------------------------------------
  // Speech: word-timed audio packets (Phase 2)
  // ---------------------------------------------------------------------------

  // Enqueue a fully-decoded payload. The audio queue (see audioQueue.ts) calls
  // this; consumers should normally not call it directly.
  enqueueDecodedAudio(item: QueueItem): void {
    if (this.destroyed || !this.head) return;
    const head = this.head;

    this.beginSpeech();

    if (item.captionPlan?.words.length) {
      this.morphDriver.scheduleCaptions(item.captionPlan, (word) =>
        this.events.onSubtitle?.(word),
      );
    }

    if (item.lipTrack?.visemes.length) {
      this.speakAudioWithVisemes(
        head,
        item.audio,
        item.lipTrack,
        item.durationMs,
        () => this.endSpeech(),
      );
      return;
    }

    head.speakAudio(
      {
        audio: item.audio,
        ...this.thWordsGate(item.durationMs),
        markers: [() => this.endSpeech()],
        mtimes: [Math.max(0, item.durationMs - 10)],
      },
      { isRaw: true },
    );
  }

  /**
   * TalkingHead only runs visemes / markers inside `if (r.words)`.
   * It always reads `wtimes[i]` / `wdurations[i]` — they must exist.
   * A single space skips text lipsync when `visemes` are supplied.
   */
  private thWordsGate(
    durationMs: number,
  ): Pick<SpeakAudioPayload, "words" | "wtimes" | "wdurations"> {
    return {
      words: [" "],
      wtimes: [0],
      wdurations: [Math.max(1, durationMs)],
    };
  }

  /** Drive mouth via TalkingHead viseme animations (no lipsync module). */
  private speakAudioWithVisemes(
    head: TalkingHead,
    audio: AudioBuffer,
    track: VisemeTrack,
    durationMs: number,
    onEnd?: () => void,
  ): void {
    const n = track.visemes.length;
    const payload: SpeakAudioPayload = {
      audio,
      ...this.thWordsGate(durationMs),
      visemes: track.visemes,
      vtimes: track.vtimes.slice(0, n),
      vdurations: track.vdurations.slice(0, n),
    };
    if (onEnd) {
      payload.markers = [onEnd];
      payload.mtimes = [Math.max(0, durationMs - 10)];
    }
    head.speakAudio(payload, { isRaw: true });
  }

  private async createSilentBuffer(durationSec: number): Promise<AudioBuffer> {
    if (!this.audioCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.audioCtx = new Ctor();
    }
    const sr = this.audioCtx.sampleRate;
    const frames = Math.max(1, Math.ceil(durationSec * sr));
    return this.audioCtx.createBuffer(1, frames, sr);
  }

  // Decode an ArrayBuffer (mp3/wav/opus/etc.) into an AudioBuffer using a
  // shared AudioContext. Exposed so audioQueue can decode before enqueueing.
  async decodeAudio(buffer: ArrayBuffer): Promise<AudioBuffer> {
    if (!this.audioCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.audioCtx = new Ctor();
    }
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }
    // Some browsers mutate the input; copy to be safe.
    const copy = buffer.slice(0);
    return await this.audioCtx.decodeAudioData(copy);
  }

  stopSpeaking(): void {
    this.morphDriver.stop();
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
    try {
      this.head?.stopSpeaking();
    } catch {
      /* noop */
    }
    // Force-drain so UI doesn't think we're still speaking.
    if (this.outstanding > 0) {
      this.outstanding = 0;
      this.events.onQueueDrain?.();
      // Drop the body back to idle.
      if (this.currentClip === "talk") {
        void this.playClip("idle", { loop: true });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private beginSpeech(): void {
    this.outstanding += 1;
    if (this.outstanding === 1) {
      this.events.onSpeakStart?.();
      // Body sync: talk animation starts when the queue starts playing.
      if (this.currentClip !== "talk") {
        void this.playClip("talk", { loop: true });
      }
    }
  }

  private endSpeech(): void {
    this.outstanding = Math.max(0, this.outstanding - 1);
    if (this.outstanding === 0) {
      this.events.onQueueDrain?.();
      // Body sync: return to idle when the queue drains.
      if (!this.destroyed && this.currentClip === "talk") {
        void this.playClip("idle", { loop: true });
      }
    }
  }

}
