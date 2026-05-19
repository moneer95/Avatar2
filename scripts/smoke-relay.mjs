// End-to-end smoke test for the relay. Spawns the server, connects a viewer
// and a sender, pushes one binary frame with word timings, asserts the viewer
// receives the same bytes and the header round-trips.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocket } from "ws";

const PORT = 18888;
const SECRET = "smoke";

const relay = spawn(
  process.execPath,
  ["server/relay.mjs"],
  {
    env: { ...process.env, PORT: String(PORT), WS_SECRET: SECRET },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
relay.stdout.on("data", (b) => process.stdout.write(`[relay] ${b}`));
relay.stderr.on("data", (b) => process.stderr.write(`[relay] ${b}`));

async function fail(msg) {
  console.error("FAIL:", msg);
  relay.kill("SIGTERM");
  process.exit(1);
}

await sleep(500);

const url = `ws://localhost:${PORT}`;

// Viewer
const viewer = new WebSocket(url);
viewer.binaryType = "arraybuffer";
let viewerWelcomed = false;
const viewerGotFrame = new Promise((resolve) => {
  viewer.on("message", (data, isBinary) => {
    if (!isBinary) {
      const msg = JSON.parse(data.toString("utf8"));
      if (msg.type === "welcome") viewerWelcomed = true;
      if (msg.type === "reject") fail(`viewer rejected: ${msg.reason}`);
      return;
    }
    resolve(data);
  });
});
viewer.on("open", () =>
  viewer.send(JSON.stringify({ type: "hello", role: "viewer", secret: SECRET })),
);
viewer.on("error", (err) => fail(`viewer ws error: ${err.message}`));

await sleep(200);
if (!viewerWelcomed) await fail("viewer never welcomed");

// Bad secret rejection
{
  const bad = new WebSocket(url);
  const closed = new Promise((resolve) => {
    bad.on("close", (code) => resolve(code));
  });
  bad.on("open", () =>
    bad.send(JSON.stringify({ type: "hello", role: "viewer", secret: "nope" })),
  );
  const code = await closed;
  if (code !== 4001) await fail(`bad-secret close code ${code}, expected 4001`);
  console.log("[smoke] bad secret correctly rejected (4001)");
}

// Sender
const sender = new WebSocket(url);
sender.binaryType = "arraybuffer";
let senderWelcomed = false;
sender.on("message", (data) => {
  const msg = JSON.parse(data.toString("utf8"));
  if (msg.type === "welcome") senderWelcomed = true;
});
sender.on("open", () =>
  sender.send(JSON.stringify({ type: "hello", role: "sender", secret: SECRET })),
);
sender.on("error", (err) => fail(`sender ws error: ${err.message}`));
await sleep(200);
if (!senderWelcomed) await fail("sender never welcomed");

// Build a binary frame: [u32 LE header length][JSON header][audio bytes]
const header = {
  mime: "audio/wav",
  words: ["Hi", "there"],
  wtimes: [0, 500],
  wdurations: [400, 400],
  seq: 1,
};
const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
const audioBytes = Buffer.from(new Uint8Array(64).fill(0xab));
const lenBuf = Buffer.alloc(4);
lenBuf.writeUInt32LE(headerBytes.byteLength, 0);
const frame = Buffer.concat([lenBuf, headerBytes, audioBytes]);

sender.send(frame, { binary: true });

const received = await Promise.race([
  viewerGotFrame,
  sleep(3000).then(() => null),
]);
if (!received) await fail("viewer never received frame");

const buf = Buffer.from(received);
const rxLen = buf.readUInt32LE(0);
if (rxLen !== headerBytes.byteLength) {
  await fail(`header length mismatch: rx=${rxLen} expected=${headerBytes.byteLength}`);
}
const rxHeader = JSON.parse(buf.slice(4, 4 + rxLen).toString("utf8"));
if (rxHeader.words?.[0] !== "Hi") {
  await fail(`header words mismatch: ${JSON.stringify(rxHeader)}`);
}
const rxAudio = buf.slice(4 + rxLen);
if (rxAudio.byteLength !== audioBytes.byteLength) {
  await fail(`audio length mismatch: rx=${rxAudio.byteLength}`);
}
console.log("[smoke] viewer received matching frame (header + audio)");

viewer.close();
sender.close();
await sleep(200);
relay.kill("SIGTERM");
await sleep(200);
console.log("[smoke] PASS");
process.exit(0);
