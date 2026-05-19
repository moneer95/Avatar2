# Avatar Studio

A single-page React app that renders a 3D human avatar (TalkingHead + Three.js).
The avatar idles, can wave on demand, and can speak. Speech is either
synthesised locally via the browser TTS, or streamed in from an external sender
through a standalone Node WebSocket relay. The mouth animates only when word
timings are sent alongside the audio.

- **Stack:** React 18 + Vite + TypeScript + TailwindCSS, TalkingHead + Three.js,
  Node WebSocket relay (separate process).
- **No microphone, no analyzer-based lip sync.**

## Quick start

```bash
# 1. install
npm install

# 2. drop your assets into public/animations/
#    avatar.glb, idle.fbx, wave.fbx, talk.fbx
#    (override paths via VITE_AVATAR_URL / VITE_ANIM_* if needed)

# 3. configure env (or copy .env.example)
cp .env.example .env

# 4. run the relay + Vite together
npm run dev:all
```

The web app runs on http://localhost:5173 and connects to
`ws://localhost:8787` as a viewer using `VITE_WS_SECRET`.

## Layout

```
.
├── index.html
├── public/animations/        # ← drop your GLB + FBX clips here
├── server/
│   ├── relay.mjs             # Node WebSocket TTS relay
│   └── sample-sender.mjs     # Tiny test sender
└── src/
    ├── App.tsx
    ├── main.tsx
    ├── avatar/
    │   ├── assets.ts         # Single source for asset paths
    │   ├── engine.ts         # TalkingHead wrapper
    │   ├── audioQueue.ts     # Decode + ordered playback
    │   └── types.ts          # AudioPacket, AvatarStatus
    ├── components/           # Avatar, Controls, StatusPill, SidePanel
    ├── hooks/useAvatar.ts    # Wires engine + queue + relay client
    ├── ws/
    │   ├── protocol.ts       # Frame encoder/decoder + control msg types
    │   └── relayClient.ts    # Browser WS client w/ reconnect + auth
    └── styles/globals.css
```

## Phase 1 — view the avatar

What you get out of the box without any sender running:

- Avatar loads, frames the upper body, runs the idle clip.
- **Wave Gesture** plays the wave clip and blends back to idle.
- **Make Speak** uses the browser's Web Speech API; the engine swaps to the
  talk clip while speaking and returns to idle when done.
- The status pill shows the avatar state in real time.

Done when:
- Avatar visible and idling without drift.
- Wave plays and blends back to idle.
- Make Speak produces sound and triggers the talk animation.
- English lip-sync module is attached and the model exposes morph targets.

## Phase 2 — WebSocket TTS with word-timed lip sync

A sender connects to the relay as `role: "sender"`, the React viewer connects as
`role: "viewer"`. Both authenticate with the shared `WS_SECRET`. Audio frames
sent by senders are broadcast verbatim to every viewer.

### Wire format

Control frames are JSON text. Audio frames are binary with this layout:

```
[uint32 LE: header length][UTF-8 JSON header][raw audio bytes]
```

Header schema (`AudioHeader`):

```ts
{
  mime?: string;          // e.g. "audio/mpeg"
  sampleRate?: number;
  words?: string[];
  wtimes?: number[];      // ms, relative to audio start
  wdurations?: number[];  // ms
  seq?: number;
}
```

### Lip-sync rule (single contract)

> If `words`, `wtimes`, and `wdurations` are **all** present and well-formed,
> the mouth animates and the timings are linearly scaled to match the real
> decoded audio duration. Otherwise the audio plays and the mouth stays
> neutral.

### Body sync

- The talk clip starts as soon as any audio enters the engine queue.
- When the queue drains, the avatar returns to idle.

### Auth

- Anyone who fails to send a `hello` within 5s, or who sends the wrong
  `secret`, gets a `reject` frame and the socket is closed (code 4001/4002).
- Viewers can't push binary frames; senders can't subscribe to other senders.

### Try it without a real TTS pipeline

```bash
# In one shell, run the relay
WS_SECRET=devsecret npm run server

# In another, push an audio file as a sender
WS_SECRET=devsecret node server/sample-sender.mjs ./sample.mp3 ./timings.json
```

`timings.json` example:

```json
{
  "words": ["Hello", "world"],
  "wtimes": [0, 600],
  "wdurations": [500, 700]
}
```

Open http://localhost:5173 to watch the viewer play the chunk and lip-sync.

## Environment variables

| Var | Used by | Purpose |
| --- | --- | --- |
| `VITE_WS_URL` | React | Relay URL the viewer connects to |
| `VITE_WS_SECRET` | React | Shared secret sent in `hello` |
| `VITE_AVATAR_URL` | React | Override GLB path |
| `VITE_ANIM_IDLE` / `_WAVE` / `_TALK` | React | Override clip paths |
| `PORT` | Relay | TCP port (default 8787) |
| `WS_SECRET` | Relay + sender | Shared secret |
| `PING_MS` | Relay | Heartbeat interval |

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server only |
| `npm run server` | Node relay only |
| `npm run dev:all` | Both, with colourised logs |
| `npm run build` | Production web build |
| `npm run preview` | Preview the built web app |
