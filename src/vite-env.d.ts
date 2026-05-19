/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WS_URL?: string;
  readonly VITE_WS_SECRET?: string;
  readonly VITE_AVATAR_URL?: string;
  readonly VITE_ANIM_IDLE?: string;
  readonly VITE_ANIM_WAVE?: string;
  readonly VITE_ANIM_TALK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
