// Wire protocol shared by the React client and the Node relay.
//
// Two message kinds travel over the socket:
//
//   1. JSON control frames  ({ type: "...", ... })
//   2. Binary audio frames  (ArrayBuffer with a small JSON header prefix)
//
// Binary frame layout:
//   [4 bytes: little-endian uint32 header length]
//   [N bytes: UTF-8 JSON header]
//   [rest:   raw audio bytes (mp3/wav/opus/whatever the sender chose)]
//
// The header carries word timings + mime/sample rate. Keeping it as a single
// binary frame avoids ordering races between "audio" and "metadata".

export type ClientRole = "sender" | "viewer";

export interface HelloMessage {
  type: "hello";
  role: ClientRole;
  secret: string;
}

export interface WelcomeMessage {
  type: "welcome";
  role: ClientRole;
}

export interface RejectMessage {
  type: "reject";
  reason: string;
}

export interface PingMessage {
  type: "ping";
  t: number;
}

export interface PongMessage {
  type: "pong";
  t: number;
}

// "stop" is broadcast from the sender to clear viewer queues immediately.
export interface StopMessage {
  type: "stop";
}

export type ControlMessage =
  | HelloMessage
  | WelcomeMessage
  | RejectMessage
  | PingMessage
  | PongMessage
  | StopMessage;

export interface AudioHeader {
  mime?: string;
  sampleRate?: number;
  words?: string[];
  wtimes?: number[];
  wdurations?: number[];
  // Optional sequence number, useful for logs.
  seq?: number;
}

const HEADER_LEN_BYTES = 4;

export function encodeAudioFrame(
  header: AudioHeader,
  audio: ArrayBuffer | Uint8Array,
): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const audioBytes =
    audio instanceof Uint8Array ? audio : new Uint8Array(audio);
  const out = new Uint8Array(HEADER_LEN_BYTES + json.byteLength + audioBytes.byteLength);
  new DataView(out.buffer).setUint32(0, json.byteLength, true);
  out.set(json, HEADER_LEN_BYTES);
  out.set(audioBytes, HEADER_LEN_BYTES + json.byteLength);
  return out.buffer;
}

export function decodeAudioFrame(buf: ArrayBuffer): {
  header: AudioHeader;
  audio: ArrayBuffer;
} {
  if (buf.byteLength < HEADER_LEN_BYTES) {
    throw new Error("Audio frame too short");
  }
  const headerLen = new DataView(buf).getUint32(0, true);
  if (HEADER_LEN_BYTES + headerLen > buf.byteLength) {
    throw new Error("Audio frame header length out of range");
  }
  const jsonBytes = new Uint8Array(buf, HEADER_LEN_BYTES, headerLen);
  const header = JSON.parse(new TextDecoder().decode(jsonBytes)) as AudioHeader;
  const audio = buf.slice(HEADER_LEN_BYTES + headerLen);
  return { header, audio };
}
