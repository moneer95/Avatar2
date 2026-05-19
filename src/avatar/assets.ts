// Single source of truth for which model + clip files the avatar uses.
//
// Defaults point at the files currently in /public. Each path can be
// overridden at build time via Vite env vars so swapping in new clips never
// requires a code change.
//
// To add more clips later: drop the .fbx into public/animations/ and add a
// new entry to `clips` below — the engine treats clip names as opaque keys.

// Helper: filenames in /public may contain spaces. We encode each path
// segment so the dev server / production host serves them correctly.
const asset = (path: string): string =>
  path
    .split("/")
    .map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg)))
    .join("/");

const DEFAULT_AVATAR = asset("/models/Monir.glb");
const DEFAULT_IDLE = asset("/animations/Standing W_Briefcase Idle.fbx");
const DEFAULT_WAVE = asset("/animations/Standing Arguing.fbx");
const DEFAULT_TALK = asset("/animations/Talking.fbx");

export const ASSETS = {
  avatarUrl: import.meta.env.VITE_AVATAR_URL ?? DEFAULT_AVATAR,
  clips: {
    idle: import.meta.env.VITE_ANIM_IDLE ?? DEFAULT_IDLE,
    wave: import.meta.env.VITE_ANIM_WAVE ?? DEFAULT_WAVE,
    talk: import.meta.env.VITE_ANIM_TALK ?? DEFAULT_TALK,
  },
} as const;

export type ClipName = keyof typeof ASSETS.clips;
