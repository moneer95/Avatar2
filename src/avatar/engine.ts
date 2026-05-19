import { TalkingHead, type SpeakAudioPayload } from "talkinghead";
import { LipsyncEn } from "talkinghead/modules/lipsync-en.mjs";
import { ASSETS, type ClipName } from "./assets";
import { resolveWordTimings, type WordTimingPlan } from "./lipsync";

const PCM_SAMPLE_RATE = 22050;
const SILENT_PCM_PAD_MS = 50;
const LIP_DEBUG =
  import.meta.env.DEV || import.meta.env.VITE_LIPSYNC_DEBUG === "1";

function lipDebug(message: string, details?: unknown): void {
  if (!LIP_DEBUG) return;
  if (details === undefined) {
    console.log(`[lipdebug][engine] ${message}`);
    return;
  }
  console.log(`[lipdebug][engine] ${message}`, details);
}

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

export interface QueueItem {
  audio: AudioBuffer;
  durationMs: number;
  wordPlan?: WordTimingPlan;
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
  private outstanding = 0;
  private destroyed = false;
  private audioCtx: AudioContext | null = null;

  constructor(container: HTMLElement, events: EngineEvents = {}) {
    this.container = container;
    this.events = events;
  }

  async init(opts: EngineInitOptions = {}): Promise<void> {
    const o = { ...DEFAULTS, ...opts };
    this.destroyed = false;

    this.audioCtx = this.createAudioContext();
    lipDebug("init: audio context created", {
      state: this.audioCtx.state,
      sampleRate: this.audioCtx.sampleRate,
    });

    this.head = new TalkingHead(this.container, {
      audioCtx: this.audioCtx,
      pcmSampleRate: PCM_SAMPLE_RATE,
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

    this.ensureLipsync();
    this.logLipsyncReadiness("before-showAvatar");

    await this.head.showAvatar({
      url: ASSETS.avatarUrl,
      body: "M",
      avatarMood: o.mood,
      lipsyncLang: "en",
    });

    this.ensureLipsync();
    this.logLipsyncReadiness("after-showAvatar");

    if (!this.destroyed && this.head) {
      void this.playClip("idle", { loop: true });
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    lipDebug("destroy: begin teardown");
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
    // Do not close here: TalkingHead may still run async resume/suspend calls
    // during teardown, which can throw on a closed context in Strict Mode.
    this.audioCtx = null;
    this.head = null;
  }

  async playClip(
    name: ClipName,
    opts: { loop?: boolean; durationMs?: number } = {},
  ): Promise<void> {
    if (this.destroyed || !this.head) return;
    const head = this.head;
    const url = ASSETS.clips[name];
    if (!url) throw new Error(`Unknown clip: ${name}`);

    this.currentClip = name;
    const dur = opts.durationMs ? opts.durationMs / 1000 : undefined;
    await head.playAnimation(url, undefined, dur, 0, 1);

    if (!opts.loop && dur && name !== "idle") {
      window.setTimeout(() => {
        if (this.destroyed) return;
        if (this.currentClip !== name) return;
        void this.playClip("idle", { loop: true });
      }, dur * 1000);
    }
  }

  getCurrentClip(): ClipName | null {
    return this.currentClip;
  }

  showCaption(text: string): void {
    this.events.onSubtitle?.(text);
  }

  async wave(durationMs = 2600): Promise<void> {
    await this.playClip("wave", { durationMs });
  }

  async speakText(text: string): Promise<void> {
    if (this.destroyed || !this.head) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    this.beginSpeech();
    try {
      const estimatedMs = Math.max(1200, trimmed.length * 50);
      const plan = resolveWordTimings({ caption: trimmed }, estimatedMs);

      const speakPromise = plan
        ? this.speakWithWordTimings(plan, estimatedMs)
        : Promise.resolve();

      await Promise.all([speakPromise, this.browserSpeak(trimmed)]);
    } finally {
      this.endSpeech();
    }
  }

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
        if (event.error === "interrupted") {
          resolve();
          return;
        }
        reject(new Error(event.error || "Speech synthesis failed"));
      };
      synth.speak(utter);
    });
  }

  enqueueDecodedAudio(item: QueueItem): void {
    if (this.destroyed || !this.head) return;
    this.ensureRuntimeReady();
    this.beginSpeech();
    this.ensureLipsync();
    lipDebug("enqueueDecodedAudio", {
      durationMs: item.durationMs,
      hasWordPlan: Boolean(item.wordPlan?.words.length),
      words: item.wordPlan?.words.length ?? 0,
      firstWord: item.wordPlan?.words[0] ?? null,
      audioCtxState: this.audioCtx?.state ?? "none",
    });

    if (item.wordPlan?.words.length) {
      this.speakWordTimedAudio(
        item.audio,
        item.wordPlan,
        item.durationMs,
        () => this.endSpeech(),
      );
      return;
    }

    this.head.speakAudio({ audio: item.audio }, { lipsyncLang: "en" });
    window.setTimeout(() => this.endSpeech(), item.durationMs);
  }

  /**
   * Word timings → English lipsync and subtitles via TalkingHead.
   */
  private speakWordTimedAudio(
    audio: AudioBuffer | ArrayBuffer | ArrayBuffer[],
    plan: WordTimingPlan,
    durationMs: number,
    onEnd?: () => void,
  ): void {
    if (!this.head) return;
    this.ensureRuntimeReady();
    const sample = Math.min(3, plan.words.length);
    const timelineEnd =
      plan.words.length > 0
        ? plan.wtimes[plan.words.length - 1]! +
          plan.wdurations[plan.words.length - 1]!
        : 0;
    lipDebug("speakWordTimedAudio payload", {
      words: plan.words.length,
      firstWords: plan.words.slice(0, sample),
      firstWTimes: plan.wtimes.slice(0, sample),
      firstWDurations: plan.wdurations.slice(0, sample),
      timelineEndMs: timelineEnd,
      durationMs,
      lipsyncLoaded: Boolean(
        (this.head as { lipsync?: Record<string, unknown> }).lipsync?.en,
      ),
      audioType: Array.isArray(audio) ? "pcm-array" : "audio-buffer",
    });

    const payload: SpeakAudioPayload = {
      audio,
      words: plan.words,
      wtimes: plan.wtimes,
      wdurations: plan.wdurations,
    };
    if (onEnd) {
      payload.markers = [onEnd];
      payload.mtimes = [Math.max(0, durationMs - 10)];
    }

    this.head.speakAudio(payload, { lipsyncLang: "en" }, (word) => {
      const t = word.trim();
      if (!t) return;
      lipDebug("subtitle callback", { word: t });
      this.events.onSubtitle?.(t);
    });
  }

  private speakWithWordTimings(
    plan: WordTimingPlan,
    durationMs: number,
  ): Promise<void> {
    if (this.destroyed || !this.head) return Promise.resolve();
    this.ensureLipsync();

    return new Promise((resolve) => {
      const pcm = this.createSilentPcm(durationMs);
      this.speakWordTimedAudio([pcm], plan, durationMs, resolve);
    });
  }

  private createSilentPcm(durationMs: number): ArrayBuffer {
    const samples = Math.ceil(
      ((durationMs + SILENT_PCM_PAD_MS) / 1000) * PCM_SAMPLE_RATE,
    );
    return new Int16Array(Math.max(1, samples)).buffer;
  }

  private ensureLipsync(): void {
    if (!this.head) return;
    if (!this.head.lipsync) {
      this.head.lipsync = {};
    }
    if (!this.head.lipsync.en) {
      this.head.lipsync.en = new LipsyncEn();
      lipDebug("ensureLipsync: loaded English lipsync processor");
    }
  }

  async decodeAudio(buffer: ArrayBuffer): Promise<AudioBuffer> {
    if (!this.audioCtx) {
      throw new Error("AvatarEngine: AudioContext not initialized");
    }
    if (this.audioCtx.state === "closed") {
      throw new Error("AvatarEngine: AudioContext is closed");
    }
    if (this.audioCtx.state === "suspended") {
      lipDebug("decodeAudio: resuming suspended context");
      await this.audioCtx.resume();
    }
    const decoded = await this.audioCtx.decodeAudioData(buffer.slice(0));
    lipDebug("decodeAudio: decoded", {
      durationSec: decoded.duration,
      sampleRate: decoded.sampleRate,
      channels: decoded.numberOfChannels,
    });
    return decoded;
  }

  private createAudioContext(): AudioContext {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    return new Ctor({ sampleRate: PCM_SAMPLE_RATE });
  }

  private ensureRuntimeReady(): void {
    if (!this.head) return;
    const headAny = this.head as {
      isRunning?: boolean;
      start?: () => void;
    };
    if (headAny.isRunning === false) {
      lipDebug("ensureRuntimeReady: restarting TalkingHead loop");
      headAny.start?.();
    }
  }

  private logLipsyncReadiness(stage: string): void {
    if (!this.head) return;
    const headAny = this.head as {
      lipsync?: Record<string, unknown>;
      getMorphTargetNames?: () => string[];
      mtAvatar?: Record<string, unknown>;
      morphs?: Array<{
        morphTargetDictionary?: Record<string, number>;
      }>;
    };
    const mtKeys =
      headAny.getMorphTargetNames?.() ?? Object.keys(headAny.mtAvatar ?? {});
    const visemeKeys = mtKeys.filter((k) => k.toLowerCase().includes("viseme"));
    const meshKeys = new Set<string>();
    for (const m of headAny.morphs ?? []) {
      for (const k of Object.keys(m.morphTargetDictionary ?? {})) meshKeys.add(k);
    }
    lipDebug(`lipsync readiness (${stage})`, {
      lipsyncLangs: Object.keys(headAny.lipsync ?? {}),
      hasEnglish: Boolean(headAny.lipsync?.en),
      morphTargetsTotal: mtKeys.length,
      visemeTargetsTotal: visemeKeys.length,
      visemeTargetsSample: visemeKeys.slice(0, 12),
      meshMorphsTotal: meshKeys.size,
      meshMorphsHasVisemeAa: meshKeys.has("viseme_aa"),
      meshMorphsSample: [...meshKeys].slice(0, 12),
    });
  }

  stopSpeaking(): void {
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
    if (this.outstanding > 0) {
      this.outstanding = 0;
      this.events.onQueueDrain?.();
      if (this.currentClip === "talk") {
        void this.playClip("idle", { loop: true });
      }
    }
  }

  private beginSpeech(): void {
    this.outstanding += 1;
    if (this.outstanding === 1) {
      this.events.onSpeakStart?.();
      // Keep the current body clip while speaking. A separate looping "talk"
      // FBX can include facial/morph tracks that override TalkingHead visemes.
    }
  }

  private endSpeech(): void {
    this.outstanding = Math.max(0, this.outstanding - 1);
    if (this.outstanding === 0) {
      this.events.onQueueDrain?.();
    }
  }
}
