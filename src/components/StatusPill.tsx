import type { AvatarStatus } from "../avatar/types";
import type { RelayStatus } from "../hooks/useAvatar";

interface StatusPillProps {
  avatarStatus: AvatarStatus;
  relayStatus: RelayStatus;
  queueSize: number;
}

const AVATAR_LABEL: Record<AvatarStatus, { text: string; tone: string }> = {
  idle: { text: "Idle", tone: "bg-slate-500/20 text-slate-300" },
  loading: { text: "Loading", tone: "bg-amber-500/20 text-amber-300" },
  ready: { text: "Ready", tone: "bg-emerald-500/20 text-emerald-300" },
  speaking: { text: "Speaking", tone: "bg-accent-500/25 text-accent-400" },
  gesture: { text: "Waving", tone: "bg-violet-500/20 text-violet-300" },
  error: { text: "Error", tone: "bg-red-500/20 text-red-300" },
};

const RELAY_LABEL: Record<RelayStatus, { text: string; tone: string }> = {
  idle: { text: "WS off", tone: "bg-slate-500/20 text-slate-400" },
  connecting: { text: "WS connecting", tone: "bg-amber-500/20 text-amber-300" },
  authenticating: { text: "WS auth", tone: "bg-amber-500/20 text-amber-300" },
  connected: { text: "WS live", tone: "bg-emerald-500/20 text-emerald-300" },
  rejected: { text: "WS rejected", tone: "bg-red-500/20 text-red-300" },
  disconnected: { text: "WS down", tone: "bg-slate-500/20 text-slate-400" },
  error: { text: "WS error", tone: "bg-red-500/20 text-red-300" },
};

export function StatusPill({
  avatarStatus,
  relayStatus,
  queueSize,
}: StatusPillProps) {
  const a = AVATAR_LABEL[avatarStatus];
  const r = RELAY_LABEL[relayStatus];
  const speaking = avatarStatus === "speaking";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${a.tone} ${
          speaking ? "pulse-ring" : ""
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            speaking
              ? "bg-accent-400"
              : avatarStatus === "ready"
                ? "bg-emerald-400"
                : avatarStatus === "error"
                  ? "bg-red-400"
                  : "bg-slate-400"
          }`}
        />
        {a.text}
      </span>

      <span
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${r.tone}`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            relayStatus === "connected"
              ? "bg-emerald-400"
              : relayStatus === "rejected" || relayStatus === "error"
                ? "bg-red-400"
                : "bg-slate-400"
          }`}
        />
        {r.text}
      </span>

      {queueSize > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-accent-500/20 px-3 py-1 text-xs font-medium text-accent-400">
          <span className="font-mono">{queueSize}</span>
          <span className="opacity-80">queued</span>
        </span>
      )}
    </div>
  );
}
