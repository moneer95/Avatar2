import { useState } from "react";

interface ControlsProps {
  ready: boolean;
  speaking: boolean;
  onSpeak: (text: string) => void;
  onWave: () => void;
  onStop: () => void;
}

const DEFAULT_LINE = "Hi, I’m your avatar. Drop me a model and watch me wave.";

export function Controls({
  ready,
  speaking,
  onSpeak,
  onWave,
  onStop,
}: ControlsProps) {
  const [text, setText] = useState(DEFAULT_LINE);

  const disabled = !ready;

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
          Say something
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          spellCheck={false}
          placeholder="Type something for the avatar to say…"
          className="w-full resize-none rounded-xl border border-ink-700/70 bg-ink-850/60 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-accent-500/60 focus:outline-none focus:ring-1 focus:ring-accent-500/40"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || speaking || !text.trim()}
          onClick={() => onSpeak(text)}
          className="inline-flex items-center gap-2 rounded-xl bg-accent-500 px-4 py-2 text-sm font-semibold text-ink-950 shadow-sm transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-slate-500"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19c3.866 0 7-3.134 7-7v-1" />
            <path d="M5 11v1c0 3.866 3.134 7 7 7" />
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M12 19v3" />
          </svg>
          Make Speak
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={onWave}
          className="inline-flex items-center gap-2 rounded-xl border border-ink-700/80 bg-ink-850/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:text-slate-500"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 11V6a2 2 0 1 1 4 0v5" />
            <path d="M11 11V4a2 2 0 1 1 4 0v7" />
            <path d="M15 11V6a2 2 0 1 1 4 0v8a7 7 0 0 1-7 7H9a4 4 0 0 1-4-4v-1l-2-4a2 2 0 0 1 3-2l1 1" />
          </svg>
          Wave Gesture
        </button>

        <button
          type="button"
          disabled={!speaking}
          onClick={onStop}
          className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          Stop
        </button>
      </div>
    </div>
  );
}
