import type { SessionView } from "../types/agent";
import AgentAvatar from "./AgentAvatar";

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function SessionRow({ session }: { session: SessionView }) {
  const sessionLabel = session.id.length > 14 ? `${session.id.slice(0, 14)}…` : session.id;

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-white/60 px-3 py-2">
      <AgentAvatar
        highlighted={session.hasPendingPermission || session.needsUserAttention}
        source={session.source}
        status={session.status}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span>{sessionLabel}</span>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
            {formatDuration(session.durationMs)}
          </span>
        </div>
        <div className="truncate text-xs text-[var(--text-secondary)]">
          {session.statusDetail}
        </div>
      </div>
      <div className="max-w-32 truncate text-right text-[11px] text-[var(--text-secondary)]">
        {session.cwd ?? "未提供路径"}
      </div>
    </div>
  );
}
