import { forwardRef } from "react";

interface AvatarProps {
  loading: boolean;
  errored: boolean;
  errorMessage?: string | null;
}

// The Avatar wrapper is a strict size container:
//   - `h-full w-full` makes it fill whatever parent the layout gives it.
//   - The mount node uses absolute positioning so Three.js' canvas can never
//     push the wrapper taller than the layout intends (which is what was
//     making the page scroll forever).
//
// All logic lives in `useAvatar`; this file is pure presentation.
export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  function Avatar({ loading, errored, errorMessage }, ref) {
    return (
      <div className="relative h-full w-full overflow-hidden rounded-2xl border border-ink-700/60 bg-gradient-to-b from-ink-850 to-ink-900 shadow-glow">
        <div
          ref={ref}
          className="absolute inset-0"
          aria-label="3D avatar viewport"
        />
        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink-950/40 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3 text-slate-300">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-600 border-t-accent-400" />
              <div className="text-sm font-medium tracking-wide">
                Loading avatar…
              </div>
            </div>
          </div>
        )}
        {errored && (
          <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-ink-950/80 p-6">
            <div className="max-w-md rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-sm leading-relaxed text-red-200">
              <div className="mb-2 font-semibold text-red-100">
                Couldn’t load the avatar
              </div>
              <div className="break-words text-red-200/80">
                {errorMessage ?? "Unknown error."}
              </div>
              <div className="mt-3 text-xs text-red-200/60">
                Drop your model + Mixamo clips into{" "}
                <code className="rounded bg-red-500/20 px-1 py-0.5">
                  public/animations/
                </code>{" "}
                or set the <code>VITE_AVATAR_URL</code> /{" "}
                <code>VITE_ANIM_*</code> env vars.
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
);
