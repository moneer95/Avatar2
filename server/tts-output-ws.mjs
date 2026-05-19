// AudiofishTTS output receiver + avatar viewer fan-out.
//
//   ws://localhost:3002/api/tts-output-ws
//
// Producers (AudiofishTTS forwarder):
//   First message: { "type": "auth", "secret": "<TTS_OUTPUT_SECRET>" }
//   Then pushes: open | audio | close | error (JSON text frames)
//
// Viewers (this React app):
//   First message: { "type": "auth", "secret": "...", "role": "viewer" }
//   Receives the same events the producer sends (no binary relay).

import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { config as loadDotenv } from "dotenv";

loadDotenv();

const PORT = Number(process.env.PORT ?? 3002);
const SECRET =
  process.env.TTS_OUTPUT_SECRET ??
  process.env.WS_SECRET ??
  process.env.VITE_WS_SECRET;

if (!SECRET) {
  console.error(
    "[tts-output] Set TTS_OUTPUT_SECRET (or WS_SECRET) in .env",
  );
  process.exit(1);
}

const http = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, viewers: viewers.size, producers: producers.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });
const producers = new Set();
const viewers = new Set();

function sendJson(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function broadcastToViewers(msg) {
  const payload = JSON.stringify(msg);
  for (const v of viewers) {
    if (v.readyState === v.OPEN) v.send(payload);
  }
}

http.on("upgrade", (req, socket, head) => {
  const path = req.url?.split("?")[0];
  if (path !== "/api/tts-output-ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws, req) => {
  ws.role = null;
  ws.authed = false;
  ws.remote = req.socket.remoteAddress;

  const authTimer = setTimeout(() => {
    if (!ws.authed) {
      try {
        ws.close(4002, "auth timeout");
      } catch {
        /* noop */
      }
    }
  }, 8000);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString("utf8"));
    } catch {
      try {
        ws.close(4003, "bad json");
      } catch {
        /* noop */
      }
      return;
    }

    if (!ws.authed) {
      if (msg?.type !== "auth" || msg.secret !== SECRET) {
        sendJson(ws, { ok: false, error: "unauthorized" });
        try {
          ws.close(4001, "unauthorized");
        } catch {
          /* noop */
        }
        return;
      }

      clearTimeout(authTimer);
      ws.authed = true;
      ws.role = msg.role === "viewer" ? "viewer" : "producer";

      if (ws.role === "viewer") {
        viewers.add(ws);
        sendJson(ws, { ok: true, subscribed: true });
        console.log(
          `[tts-output] viewer connected from ${ws.remote} (viewers=${viewers.size})`,
        );
      } else {
        producers.add(ws);
        sendJson(ws, { ok: true, subscribed: true });
        console.log(
          `[tts-output] producer connected from ${ws.remote} (producers=${producers.size})`,
        );
      }
      return;
    }

    // Producers push TTS events → fan out to viewers.
    if (ws.role === "producer") {
      if (msg?.type === "audio") {
        const seq = msg.chunk_seq;
        const words = msg.words?.length ?? 0;
        console.log(
          `[tts-output] audio seq=${seq} words=${words} offset=${msg.chunk_audio_offset_sec ?? 0}s → ${viewers.size} viewer(s)`,
        );
      } else if (msg?.type === "open" || msg?.type === "close" || msg?.type === "error") {
        console.log(`[tts-output] ${msg.type} → ${viewers.size} viewer(s)`);
      }
      broadcastToViewers(msg);
      return;
    }

    // Viewers are listen-only after auth (ping optional).
    if (msg?.type === "ping") {
      sendJson(ws, { type: "pong", t: msg.t });
    }
  });

  ws.on("close", () => {
    clearTimeout(authTimer);
    producers.delete(ws);
    viewers.delete(ws);
    if (ws.authed) {
      console.log(
        `[tts-output] ${ws.role} disconnected (producers=${producers.size}, viewers=${viewers.size})`,
      );
    }
  });

  ws.on("error", (err) => {
    console.warn("[tts-output] socket error:", err?.message ?? err);
  });
});

http.listen(PORT, () => {
  console.log(
    `[tts-output] listening on ws://0.0.0.0:${PORT}/api/tts-output-ws`,
  );
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[tts-output] ${sig}, shutting down`);
    wss.close();
    http.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
