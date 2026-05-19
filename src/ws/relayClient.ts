import {
  decodeAudioFrame,
  type ControlMessage,
  type AudioHeader,
} from "./protocol";

// RelayClient is a thin wrapper around a single browser WebSocket. It owns
// reconnection, auth handshake, and surfaces three kinds of events to the
// caller: status changes, audio frames, and errors.

export type RelayStatus =
  | "idle"
  | "connecting"
  | "authenticating"
  | "connected"
  | "rejected"
  | "disconnected"
  | "error";

export interface RelayEvents {
  onStatus?: (status: RelayStatus, info?: string) => void;
  onAudio?: (header: AudioHeader, audio: ArrayBuffer) => void;
  onStop?: () => void;
  onError?: (err: unknown) => void;
}

export interface RelayOptions {
  url: string;
  secret: string;
  // Backoff base in ms (gets doubled up to maxReconnectMs).
  reconnectBaseMs?: number;
  maxReconnectMs?: number;
}

export class RelayClient {
  private opts: Required<Omit<RelayOptions, never>>;
  private events: RelayEvents;
  private ws: WebSocket | null = null;
  private status: RelayStatus = "idle";
  private reconnectTimer: number | null = null;
  private reconnectDelay: number;
  private intentionallyClosed = false;

  constructor(opts: RelayOptions, events: RelayEvents = {}) {
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
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.setStatus("authenticating");
      this.send({ type: "hello", role: "viewer", secret: this.opts.secret });
    });

    ws.addEventListener("message", (event) => this.onMessage(event));

    ws.addEventListener("error", (event) => {
      // The browser hides details; the close event will follow.
      this.events.onError?.(event);
    });

    ws.addEventListener("close", (event) => {
      const wasRejected = this.status === "rejected";
      if (!wasRejected) {
        this.setStatus(
          this.intentionallyClosed ? "disconnected" : "disconnected",
          event.reason || undefined,
        );
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

  getStatus(): RelayStatus {
    return this.status;
  }

  private send(msg: ControlMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private setStatus(status: RelayStatus, info?: string): void {
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

  private onMessage(event: MessageEvent): void {
    if (typeof event.data === "string") {
      let msg: ControlMessage;
      try {
        msg = JSON.parse(event.data) as ControlMessage;
      } catch (err) {
        this.events.onError?.(err);
        return;
      }
      this.handleControl(msg);
      return;
    }
    if (event.data instanceof ArrayBuffer) {
      try {
        const { header, audio } = decodeAudioFrame(event.data);
        this.events.onAudio?.(header, audio);
      } catch (err) {
        this.events.onError?.(err);
      }
    }
  }

  private handleControl(msg: ControlMessage): void {
    switch (msg.type) {
      case "welcome":
        this.setStatus("connected");
        this.reconnectDelay = this.opts.reconnectBaseMs;
        break;
      case "reject":
        this.setStatus("rejected", msg.reason);
        this.intentionallyClosed = true; // don't retry on bad secret
        try {
          this.ws?.close(4001, "rejected");
        } catch {
          /* noop */
        }
        break;
      case "ping":
        this.send({ type: "pong", t: msg.t });
        break;
      case "stop":
        this.events.onStop?.();
        break;
      default:
        // Unknown control frames are ignored intentionally — forward-compat.
        break;
    }
  }
}
