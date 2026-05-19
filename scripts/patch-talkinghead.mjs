// Postinstall hack: the GitHub install of `talkinghead` omits
// modules/playback-worklet.js but modules/talkinghead.mjs references it at
// import time via `new URL('./playback-worklet.js', import.meta.url)`. Vite's
// static analyzer needs the file to exist or the dev server logs noisy
// warnings (and production builds fail). We ship a vendored copy and drop it
// in alongside the module on install.

import { copyFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "vendor", "playback-worklet.js");
const dstDir = join(here, "..", "node_modules", "talkinghead", "modules");
const dst = join(dstDir, "playback-worklet.js");

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

try {
  if (!(await exists(dstDir))) {
    // TalkingHead isn't installed (e.g. running before `npm install`); skip.
    process.exit(0);
  }
  if (await exists(dst)) {
    // Already there (perhaps from a future release that ships it).
    process.exit(0);
  }
  await mkdir(dstDir, { recursive: true });
  await copyFile(src, dst);
  console.log("[patch-talkinghead] installed playback-worklet.js");
} catch (err) {
  console.warn("[patch-talkinghead] skipped:", err?.message ?? err);
}
