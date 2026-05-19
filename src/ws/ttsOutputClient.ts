// Browser client for AudiofishTTS output on /api/tts-output-ws.
// JSON text frames only — auth, then open | audio | close | error.

export type TtsOutputStatus =
  | "idle"
  | "connecting"
  | "authenticating"
  | "connected"
  | "rejected"
  | "disconnected"
  | "error";

export interface TtsAudioMessage {
  type: "audio";
  request_id?: string;
  format?: string;
  audio_base64: string;
  text?: string;
  chunk_seq?: number;
  chunk_audio_offset_sec?: number;
  words?: string[];
  wtimes?: number[];
  wdurations?: number[];
  alignment?: {
    segments?: Array<{ text: string; start: number; end: number }>;
    audio_duration?: number;
  };
}

export type TtsOutputMessage =
  | { type: "open" }
  | TtsAudioMessage
  | { type: "close" }
  | { type: "error"; message?: string }
  | { ok: boolean; subscribed?: boolean; error?: string };

export interface TtsOutputEvents {
  onStatus?: (status: TtsOutputStatus, info?: string) => void;
  onOpen?: () => void;
  onAudio?: (msg: TtsAudioMessage) => void;
  onClose?: () => void;
  onError?: (err: unknown) => void;
}

export interface TtsOutputOptions {
  url: string;
  secret: string;
  reconnectBaseMs?: number;
  maxReconnectMs?: number;
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export class TtsOutputClient {
  private opts: Required<Pick<TtsOutputOptions, "url" | "secret">> & {
    reconnectBaseMs: number;
    maxReconnectMs: number;
  };
  private events: TtsOutputEvents;
  private ws: WebSocket | null = null;
  private status: TtsOutputStatus = "idle";
  private reconnectTimer: number | null = null;
  private reconnectDelay: number;
  private intentionallyClosed = false;

  constructor(opts: TtsOutputOptions, events: TtsOutputEvents = {}) {
    this.opts = {
      url: opts.url,
      secret: opts.secret,
      reconnectBaseMs: opts.reconnectBaseMs ?? 1000,
      maxReconnectMs: opts.maxReconnectMs ?? 15000,
    };
    this.events = events;
    this.reconnectDelay = this.opts.reconnectBaseMs;
  }

  connect(): void {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;
    this.intentionallyClosed = false;
    this.setStatus("connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.url);
    } catch (err) {
      this.setStatus("error", String(err));
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.setStatus("authenticating");
      ws.send(
        JSON.stringify({
          type: "auth",
          secret: this.opts.secret,
          role: "viewer",
        }),
      );
    });

    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let msg: TtsOutputMessage;
      try {
        msg = JSON.parse(event.data) as TtsOutputMessage;
      } catch (err) {
        this.events.onError?.(err);
        return;
      }
      this.handleMessage(msg);
    });

    ws.addEventListener("error", () => {
      // Browsers expose an empty Event here — not a useful Error message.
      if (this.status === "connecting" || this.status === "authenticating") {
        this.events.onError?.(new Error("WebSocket connection failed"));
      }
    });

    ws.addEventListener("close", (event) => {
      const wasRejected = this.status === "rejected";
      if (!wasRejected) {
        this.setStatus("disconnected", event.reason || undefined);
      }
      this.ws = null;
      if (!this.intentionallyClosed && !wasRejected) {
        this.scheduleReconnect();
      }
    });
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, "client disconnect");
      } catch {
        /* noop */
      }
      this.ws = null;
    }
    this.setStatus("idle");
  }

  getStatus(): TtsOutputStatus {
    return this.status;
  }

  private setStatus(status: TtsOutputStatus, info?: string): void {
    if (this.status === status) return;
    this.status = status;
    this.events.onStatus?.(status, info);
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(
      this.opts.maxReconnectMs,
      Math.round(this.reconnectDelay * 1.7),
    );
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleMessage(msg: TtsOutputMessage): void {
    if ("ok" in msg) {
      if (msg.ok) {
        this.setStatus("connected");
        this.reconnectDelay = this.opts.reconnectBaseMs;
      } else {
        this.setStatus("rejected", msg.error ?? "unauthorized");
        this.intentionallyClosed = true;
        try {
          this.ws?.close(4001, "rejected");
        } catch {
          /* noop */
        }
      }
      return;
    }

    switch (msg.type) {
      case "open":
        this.events.onOpen?.();
        break;
      case "audio":
        this.events.onAudio?.(msg);
        break;
      case "close":
        this.events.onClose?.();
        break;
      case "error":
        this.events.onError?.(new Error(msg.message ?? "TTS stream error"));
        break;
      default:
        break;
    }
  }
}
