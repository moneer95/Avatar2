// Tiny test sender. Reads an audio file (mp3/wav/ogg) and an optional JSON
// timings file, then pushes them as a binary frame to the relay.
//
// Usage:
//   node server/sample-sender.mjs <audio-file> [timings.json]
//
// timings.json shape:
//   { "words": ["Hi", "there"], "wtimes": [0, 500], "wdurations": [400, 400] }
//
// Env:
//   WS_URL=ws://localhost:8787
//   WS_SECRET=devsecret

import { readFile } from "node:fs/promises";
import { WebSocket } from "ws";
import { config as loadDotenv } from "dotenv";

loadDotenv();

const audioPath = process.argv[2];
const timingsPath = process.argv[3];

if (!audioPath) {
  console.error("usage: node server/sample-sender.mjs <audio-file> [timings.json]");
  process.exit(1);
}

const WS_URL = process.env.WS_URL ?? "ws://localhost:8787";
const SECRET = process.env.WS_SECRET ?? "devsecret";

function mimeFor(path) {
  if (path.endsWith(".mp3")) return "audio/mpeg";
  if (path.endsWith(".wav")) return "audio/wav";
  if (path.endsWith(".ogg")) return "audio/ogg";
  if (path.endsWith(".webm")) return "audio/webm";
  if (path.endsWith(".opus")) return "audio/ogg";
  return "application/octet-stream";
}

function encodeAudioFrame(header, audioBuf) {
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.byteLength, 0);
  return Buffer.concat([len, json, audioBuf]);
}

const audio = await readFile(audioPath);
let timings = {};
if (timingsPath) {
  timings = JSON.parse(await readFile(timingsPath, "utf8"));
}

const ws = new WebSocket(WS_URL);
ws.binaryType = "arraybuffer";

ws.on("open", () => {
  ws.send(
    JSON.stringify({ type: "hello", role: "sender", secret: SECRET }),
  );
});

ws.on("message", (data, isBinary) => {
  if (isBinary) return;
  const msg = JSON.parse(data.toString("utf8"));
  if (msg.type === "welcome") {
    const header = {
      mime: mimeFor(audioPath),
      seq: 1,
      ...timings,
    };
    const frame = encodeAudioFrame(header, audio);
    ws.send(frame, { binary: true });
    console.log(
      `[sender] pushed ${audio.byteLength} bytes (timings=${Boolean(timings.words)})`,
    );
    setTimeout(() => ws.close(1000, "done"), 250);
  } else if (msg.type === "reject") {
    console.error("[sender] rejected:", msg.reason);
    process.exit(1);
  }
});

ws.on("error", (err) => {
  console.error("[sender] socket error:", err.message);
  process.exit(1);
});

ws.on("close", () => {
  process.exit(0);
});
