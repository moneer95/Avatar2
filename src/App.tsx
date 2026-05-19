import { useAvatar } from "./hooks/useAvatar";
import { Avatar } from "./components/Avatar";
import { Controls } from "./components/Controls";
import { StatusPill } from "./components/StatusPill";
import { SidePanel } from "./components/SidePanel";

const WS_URL = import.meta.env.VITE_WS_URL;

// Layout contract: the page never scrolls. The whole app is exactly the
// viewport tall (`h-dvh` honours the mobile address bar). Each pane that
// could overflow has `min-h-0 overflow-*` so flex/grid actually let it
// shrink instead of pushing the document taller.
export default function App() {
  const avatar = useAvatar();

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ink-950 text-slate-100">
      <header className="shrink-0 border-b border-ink-800/80 bg-ink-900/70 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent-500 to-accent-600 text-ink-950 shadow-glow">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c1-5 5-7 8-7s7 2 8 7" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold tracking-wide text-slate-100">
                Avatar Studio
              </div>
              <div className="text-[11px] uppercase tracking-widest text-slate-500">
                Idle · Wave · Speak
              </div>
            </div>
          </div>
          <StatusPill
            avatarStatus={avatar.avatarStatus}
            relayStatus={avatar.relayStatus}
            queueSize={avatar.queueSize}
          />
        </div>
      </header>

      <main className="min-h-0 flex-1">
        <div className="mx-auto grid h-full min-h-0 w-full max-w-7xl gap-4 px-4 py-4 md:grid-cols-[minmax(0,1fr)_340px] md:gap-6 md:px-6 md:py-6">
          {/* Left column: avatar (fills) + controls (fits) */}
          <div className="flex min-h-0 flex-col gap-4">
            <div className="min-h-0 flex-1">
              <Avatar
                ref={avatar.containerRef}
                loading={avatar.avatarStatus === "loading"}
                errored={avatar.avatarStatus === "error"}
                errorMessage={avatar.lastError}
              />
            </div>
            <div className="shrink-0 rounded-2xl border border-ink-700/60 bg-ink-850/60 p-4 md:p-5">
              <Controls
                ready={avatar.ready}
                speaking={avatar.avatarStatus === "speaking"}
                onSpeak={avatar.speak}
                onWave={avatar.wave}
                onStop={avatar.stop}
              />
            </div>
          </div>

          {/* Right column: side panel — scrolls internally if it overflows */}
          <aside className="hidden min-h-0 overflow-y-auto md:block">
            <SidePanel
              relayStatus={avatar.relayStatus}
              wsUrl={WS_URL}
              lastSubtitle={avatar.lastSubtitle}
              lastError={avatar.lastError}
              onConnect={avatar.connect}
              onDisconnect={avatar.disconnect}
            />
          </aside>
        </div>
      </main>

      <footer className="shrink-0 border-t border-ink-800/80 bg-ink-900/40 py-2">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 text-[11px] text-slate-500">
          <div>React · Vite · TalkingHead · Three.js</div>
          <div className="font-mono">
            {avatar.queueSize > 0 ? `${avatar.queueSize} chunk(s) queued` : "—"}
          </div>
        </div>
      </footer>
    </div>
  );
}
