// Standalone WebSocket relay.
//
// Roles:
//   sender  - authenticated client that pushes audio frames (+ optional word
//             timings) and may broadcast "stop" control frames.
//   viewer  - authenticated client that receives whatever any sender produces.
//
// Wire format mirrors src/ws/protocol.ts:
//   - JSON text frames for control (hello/welcome/reject/ping/pong/stop)
//   - Binary frames are forwarded verbatim from senders to all viewers.
//
// Environment:
//   PORT         (default 8787)
//   WS_SECRET    (required; shared secret for hello.secret)
//   PING_MS      (default 20000)

import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { config as loadDotenv } from "dotenv";

loadDotenv();

const PORT = Number(process.env.PORT ?? 8787);
const SECRET = process.env.WS_SECRET;
const PING_MS = Number(process.env.PING_MS ?? 20000);

if (!SECRET) {
  console.error("[relay] WS_SECRET env var is required.");
  process.exit(1);
}

const http = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: http });

// Set of authenticated clients per role.
const senders = new Set();
const viewers = new Set();

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) {
    ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
}

function broadcastBinary(buffer, exclude) {
  for (const v of viewers) {
    if (v === exclude) continue;
    if (v.readyState !== v.OPEN) continue;
    v.send(buffer, { binary: true });
  }
}

function broadcastControl(msg, exclude) {
  const payload = JSON.stringify(msg);
  for (const v of viewers) {
    if (v === exclude) continue;
    send(v, payload);
  }
}

wss.on("connection", (ws, req) => {
  ws.isAlive = true;
  ws.role = null;
  ws.authedAt = 0;
  ws.remote = req.socket.remoteAddress;

  // Connections must authenticate within 5 seconds or get cut.
  const authTimer = setTimeout(() => {
    if (!ws.role) {
      send(ws, { type: "reject", reason: "auth timeout" });
      try {
        ws.close(4002, "auth timeout");
      } catch {
        /* noop */
      }
    }
  }, 5000);

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      if (ws.role !== "sender") {
        // Viewers and unauth'd sockets must not push binary.
        send(ws, { type: "reject", reason: "binary not allowed" });
        try {
          ws.close(4003, "binary not allowed");
        } catch {
          /* noop */
        }
        return;
      }
      // Forward to all viewers. ws gives us a Buffer; pass through as-is.
      broadcastBinary(data);
      return;
    }

    let msg;
    try {
      msg = JSON.parse(data.toString("utf8"));
    } catch {
      send(ws, { type: "reject", reason: "bad json" });
      return;
    }

    switch (msg?.type) {
      case "hello": {
        if (ws.role) {
          send(ws, { type: "reject", reason: "already authed" });
          return;
        }
        if (msg.secret !== SECRET) {
          send(ws, { type: "reject", reason: "bad secret" });
          try {
            ws.close(4001, "bad secret");
          } catch {
            /* noop */
          }
          return;
        }
        if (msg.role !== "sender" && msg.role !== "viewer") {
          send(ws, { type: "reject", reason: "bad role" });
          try {
            ws.close(4004, "bad role");
          } catch {
            /* noop */
          }
          return;
        }
        ws.role = msg.role;
        ws.authedAt = Date.now();
        clearTimeout(authTimer);
        if (ws.role === "sender") senders.add(ws);
        else viewers.add(ws);
        send(ws, { type: "welcome", role: ws.role });
        console.log(
          `[relay] ${ws.role} connected from ${ws.remote} (senders=${senders.size}, viewers=${viewers.size})`,
        );
        return;
      }
      case "stop": {
        if (ws.role !== "sender") return;
        broadcastControl({ type: "stop" });
        return;
      }
      case "ping": {
        send(ws, { type: "pong", t: msg.t });
        return;
      }
      case "pong": {
        ws.isAlive = true;
        return;
      }
      default:
        return;
    }
  });

  ws.on("close", () => {
    clearTimeout(authTimer);
    senders.delete(ws);
    viewers.delete(ws);
    if (ws.role) {
      console.log(
        `[relay] ${ws.role} disconnected (senders=${senders.size}, viewers=${viewers.size})`,
      );
    }
  });

  ws.on("error", (err) => {
    console.warn("[relay] socket error:", err?.message ?? err);
  });
});

// Heartbeat to drop dead sockets.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      try {
        ws.terminate();
      } catch {
        /* noop */
      }
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      /* noop */
    }
  }
}, PING_MS);

wss.on("close", () => clearInterval(heartbeat));

http.listen(PORT, () => {
  console.log(`[relay] listening on ws://0.0.0.0:${PORT}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[relay] ${sig} received, shutting down`);
    clearInterval(heartbeat);
    wss.close();
    http.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
