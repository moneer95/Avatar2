import { useCallback, useEffect, useRef, useState } from "react";
import { AvatarEngine } from "../avatar/engine";
import { AudioQueue } from "../avatar/audioQueue";
import {
  TtsOutputClient,
  base64ToArrayBuffer,
  type TtsOutputStatus,
} from "../ws/ttsOutputClient";
import type { AudioPacket, AvatarStatus } from "../avatar/types";

// Wires the avatar engine, ordered audio queue, and AudiofishTTS output socket.

export type RelayStatus = TtsOutputStatus;
const LIP_DEBUG =
  import.meta.env.DEV || import.meta.env.VITE_LIPSYNC_DEBUG === "1";

function lipDebug(message: string, details?: unknown): void {
  if (!LIP_DEBUG) return;
  if (details === undefined) {
    console.log(`[lipdebug][hook] ${message}`);
    return;
  }
  console.log(`[lipdebug][hook] ${message}`, details);
}

export interface UseAvatarOptions {
  wsUrl?: string;
  wsSecret?: string;
  autoConnect?: boolean;
}

export interface UseAvatarReturn {
  containerRef: React.RefObject<HTMLDivElement>;
  avatarStatus: AvatarStatus;
  relayStatus: RelayStatus;
  queueSize: number;
  lastError: string | null;
  lastSubtitle: string | null;
  ready: boolean;
  speak: (text: string) => Promise<void>;
  wave: () => Promise<void>;
  enqueueAudio: (packet: AudioPacket) => Promise<void>;
  stop: () => void;
  connect: () => void;
  disconnect: () => void;
}

function mimeFromFormat(format?: string): string | undefined {
  if (!format) return undefined;
  const f = format.toLowerCase();
  if (f === "mp3" || f === "mpeg") return "audio/mpeg";
  if (f === "wav") return "audio/wav";
  if (f === "ogg" || f === "opus") return "audio/ogg";
  return undefined;
}

export function useAvatar(opts: UseAvatarOptions = {}): UseAvatarReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<AvatarEngine | null>(null);
  const queueRef = useRef<AudioQueue | null>(null);
  const ttsRef = useRef<TtsOutputClient | null>(null);

  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>("idle");
  const [relayStatus, setRelayStatus] = useState<RelayStatus>("idle");
  const [queueSize, setQueueSize] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSubtitle, setLastSubtitle] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    let cancelled = false;
    setAvatarStatus("loading");

    const engine = new AvatarEngine(node, {
      onSpeakStart: () => {
        if (cancelled) return;
        setAvatarStatus("speaking");
      },
      onQueueDrain: () => {
        if (cancelled) return;
        setAvatarStatus((s) => (s === "speaking" ? "ready" : s));
      },
      onError: (err) => setLastError(stringifyError(err)),
      onSubtitle: (word) => setLastSubtitle(word),
    });
    engineRef.current = engine;

    const queue = new AudioQueue(
      engine,
      (size) => setQueueSize(size),
      (err) => setLastError(stringifyError(err)),
    );
    queueRef.current = queue;

    void engine
      .init()
      .then(() => {
        if (cancelled) return;
        setReady(true);
        setAvatarStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setLastError(stringifyError(err));
        setAvatarStatus("error");
      });

    return () => {
      cancelled = true;
      queue.clear();
      engine.destroy();
      engineRef.current = null;
      queueRef.current = null;
    };
  }, []);

  const wsUrl = opts.wsUrl ?? import.meta.env.VITE_WS_URL;
  const wsSecret = opts.wsSecret ?? import.meta.env.VITE_WS_SECRET;
  const autoConnect = opts.autoConnect ?? Boolean(wsUrl && wsSecret);

  useEffect(() => {
    if (!wsUrl || !wsSecret) return;

    const client = new TtsOutputClient(
      { url: wsUrl, secret: wsSecret },
      {
        onStatus: (s, info) => {
          setRelayStatus(s);
          if (info && (s === "rejected" || s === "error")) {
            setLastError(info);
          }
        },
        onOpen: () => {
          queueRef.current?.onSessionOpen();
        },
        onAudio: (msg) => {
          lipDebug("ws onAudio", {
            seq: msg.chunk_seq ?? null,
            offsetSec: msg.chunk_audio_offset_sec ?? null,
            textChars: msg.text?.length ?? 0,
            words: msg.words?.length ?? 0,
            wtimes: msg.wtimes?.length ?? 0,
            wdurations: msg.wdurations?.length ?? 0,
            alignmentSegments: msg.alignment?.segments?.length ?? 0,
            base64Chars: msg.audio_base64.length,
            firstWords: msg.words?.slice(0, 3) ?? [],
            firstWTimes: msg.wtimes?.slice(0, 3) ?? [],
            firstWDurations: msg.wdurations?.slice(0, 3) ?? [],
          });
          const packet: AudioPacket = {
            audio: base64ToArrayBuffer(msg.audio_base64),
            mime: mimeFromFormat(msg.format),
            words: msg.words,
            wtimes: msg.wtimes,
            wdurations: msg.wdurations,
            chunk_seq: msg.chunk_seq,
            chunk_audio_offset_sec: msg.chunk_audio_offset_sec,
            caption: msg.text,
            alignment: msg.alignment,
          };
          queueRef.current?.enqueue(packet).catch((err) => {
            setLastError(stringifyError(err));
          });
        },
        onClose: () => {
          queueRef.current?.onSessionClose();
          engineRef.current?.stopSpeaking();
        },
        onError: (err) => setLastError(stringifyError(err)),
      },
    );
    ttsRef.current = client;
    if (autoConnect) client.connect();

    return () => {
      client.disconnect();
      ttsRef.current = null;
    };
  }, [wsUrl, wsSecret, autoConnect]);

  const speak = useCallback(async (text: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      await engine.speakText(text);
    } catch (err) {
      setLastError(stringifyError(err));
    }
  }, []);

  const wave = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      setAvatarStatus("gesture");
      await engine.wave();
      setAvatarStatus((s) => (s === "gesture" ? "ready" : s));
    } catch (err) {
      setLastError(stringifyError(err));
    }
  }, []);

  const enqueueAudio = useCallback(async (packet: AudioPacket) => {
    const queue = queueRef.current;
    if (!queue) return;
    try {
      await queue.enqueue(packet);
    } catch (err) {
      setLastError(stringifyError(err));
    }
  }, []);

  const stop = useCallback(() => {
    queueRef.current?.clear();
    engineRef.current?.stopSpeaking();
  }, []);

  const connect = useCallback(() => {
    ttsRef.current?.connect();
  }, []);

  const disconnect = useCallback(() => {
    ttsRef.current?.disconnect();
  }, []);

  return {
    containerRef,
    avatarStatus,
    relayStatus,
    queueSize,
    lastError,
    lastSubtitle,
    ready,
    speak,
    wave,
    enqueueAudio,
    stop,
    connect,
    disconnect,
  };
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err instanceof Event) {
    if (err.type === "error") return "WebSocket connection error";
    return err.type || "Unknown event";
  }
  try {
    const s = JSON.stringify(err);
    if (s === '{"isTrusted":true}') return "WebSocket connection error";
    return s;
  } catch {
    return String(err);
  }
}
