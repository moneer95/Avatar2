import type { RelayStatus } from "../hooks/useAvatar";

interface SidePanelProps {
  relayStatus: RelayStatus;
  wsUrl?: string;
  lastSubtitle: string | null;
  lastError: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function SidePanel({
  relayStatus,
  wsUrl,
  lastSubtitle,
  lastError,
  onConnect,
  onDisconnect,
}: SidePanelProps) {
  const connected = relayStatus === "connected";
  const inFlight =
    relayStatus === "connecting" || relayStatus === "authenticating";

  return (
    <div className="flex h-full flex-col gap-4">
      <section className="rounded-2xl border border-ink-700/60 bg-ink-850/60 p-5">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-wide text-slate-100">
            Audiofish TTS
          </h3>
          <span className="text-[10px] uppercase tracking-widest text-slate-500">
            :3002
          </span>
        </header>
        <div className="space-y-1 text-xs text-slate-400">
          <div>
            <span className="text-slate-500">URL:</span>{" "}
            <span className="font-mono text-slate-300">
              {wsUrl ?? "(not configured)"}
            </span>
          </div>
          <div>
            <span className="text-slate-500">State:</span>{" "}
            <span className="font-mono text-slate-300">{relayStatus}</span>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onConnect}
            disabled={connected || inFlight || !wsUrl}
            className="flex-1 rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-slate-500"
          >
            Connect
          </button>
          <button
            type="button"
            onClick={onDisconnect}
            disabled={!connected && !inFlight}
            className="flex-1 rounded-lg border border-ink-700/80 bg-ink-850/70 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:text-slate-500"
          >
            Disconnect
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-ink-700/60 bg-ink-850/60 p-5">
        <header className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-wide text-slate-100">
            Live Caption
          </h3>
        </header>
        <div className="min-h-[3rem] rounded-lg border border-ink-700/60 bg-ink-900/70 px-3 py-2 font-mono text-sm text-slate-200">
          {lastSubtitle ?? (
            <span className="text-slate-500">— silence —</span>
          )}
        </div>
      </section>

      {lastError && (
        <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-200">
          <div className="mb-1 font-semibold text-red-100">Last error</div>
          <div className="break-words font-mono text-red-200/80">
            {lastError}
          </div>
        </section>
      )}

      <section className="mt-auto rounded-2xl border border-ink-700/60 bg-ink-850/40 p-4 text-[11px] leading-relaxed text-slate-500">
        <div className="mb-1 font-semibold uppercase tracking-widest text-slate-400">
          Lip-sync contract
        </div>
        Lip sync needs <code className="text-slate-300">words</code>,{" "}
        <code className="text-slate-300">wtimes</code>, and{" "}
        <code className="text-slate-300">wdurations</code> on each{" "}
        <code className="text-slate-300">audio</code> message (Audiofish sends
        these when alignment has segments). Chunks play in{" "}
        <code className="text-slate-300">chunk_seq</code> order at{" "}
        <code className="text-slate-300">chunk_audio_offset_sec</code>.
      </section>
    </div>
  );
}
