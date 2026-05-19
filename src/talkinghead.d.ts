// Minimal ambient declarations for the `talkinghead` ESM package so the rest of
// the TS code can use it without `any`. The real surface area is much larger;
// we only describe the bits we touch.
declare module "talkinghead/modules/lipsync-en.mjs" {
  export class LipsyncEn {
    preProcessText(s: string): string;
    wordsToVisemes(word: string): {
      visemes: string[];
      times: number[];
      durations: number[];
    } | null;
  }
}

declare module "talkinghead" {
  export interface TalkingHeadOptions {
    ttsEndpoint?: string | null;
    ttsApikey?: string | null;
    ttsTrimStart?: number;
    ttsTrimEnd?: number;
    lipsyncModules?: string[];
    lipsyncLang?: string;
    cameraView?: "full" | "upper" | "head" | "mid";
    cameraDistance?: number;
    cameraX?: number;
    cameraY?: number;
    cameraRotateX?: number;
    cameraRotateY?: number;
    cameraRotateEnable?: boolean;
    cameraPanEnable?: boolean;
    cameraZoomEnable?: boolean;
    avatarMood?: string;
    avatarMute?: boolean;
    avatarIdleEyeContact?: number;
    avatarIdleHeadMove?: number;
    avatarSpeakingEyeContact?: number;
    avatarSpeakingHeadMove?: number;
    modelRoot?: string;
    modelPixelRatio?: number;
    modelFPS?: number;
    dracoEnabled?: boolean;
    dracoDecoderPath?: string;
    /** Shared Web Audio context (must match decodeAudio / PCM playback). */
    audioCtx?: AudioContext;
    pcmSampleRate?: number;
    [key: string]: unknown;
  }

  export interface ShowAvatarOptions {
    url: string;
    body?: "M" | "F";
    avatarMood?: string;
    lipsyncLang?: string;
    [key: string]: unknown;
  }

  export interface SpeakAudioPayload {
    audio?: ArrayBuffer | AudioBuffer | Float32Array[] | ArrayBuffer[];
    words?: string[];
    wtimes?: number[];
    wdurations?: number[];
    visemes?: string[];
    vtimes?: number[];
    vdurations?: number[];
    markers?: (() => void)[];
    mtimes?: number[];
  }

  export interface SpeakOptions {
    lipsyncLang?: string;
    avatarMood?: string;
    avatarMute?: boolean;
    isRaw?: boolean;
  }

  export class TalkingHead {
    constructor(node: HTMLElement, opt?: TalkingHeadOptions);
    showAvatar(
      opt: ShowAvatarOptions,
      onprogress?: (event: ProgressEvent) => void,
    ): Promise<void>;
    playAnimation(
      url: string,
      onprogress?: (event: ProgressEvent) => void,
      duration?: number,
      index?: number,
      scale?: number,
    ): Promise<void>;
    stopAnimation(): void;
    playPose(
      url: string,
      onprogress?: (event: ProgressEvent) => void,
      duration?: number,
      index?: number,
      scale?: number,
    ): Promise<void>;
    stopPose(): void;
    speakText(
      text: string,
      opt?: SpeakOptions,
      onsubtitles?: (word: string) => void,
      excludes?: unknown,
    ): void;
    speakAudio(
      payload: SpeakAudioPayload,
      opt?: SpeakOptions,
      onsubtitles?: (word: string) => void,
    ): void;
    stopSpeaking(): void;
    setValue(mt: string, val: number, ms?: number | null): void;
    setFixedValue(mt: string, val: number | null, ms?: number | null): void;
    setMood(mood: string): void;
    start(): void;
    stop(): void;
    armature?: unknown;
    morphs?: Record<string, number>;
    /** Lip-sync processors keyed by language code (e.g. `en`). */
    lipsync?: Record<
      string,
      {
        preProcessText(s: string): string;
        wordsToVisemes(word: string): unknown;
      }
    >;
    [key: string]: unknown;
  }
}
