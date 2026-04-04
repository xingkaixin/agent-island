import clsx from "clsx";
import type { SessionView } from "../types/agent";
import AgentAvatar, { agentSourceLabel } from "./AgentAvatar";

function statusLabel(session: SessionView) {
  switch (session.status) {
    case "idle":
      return "空闲";
    case "thinking":
      return "思考中";
    case "tool":
      return "调用工具";
    case "shell":
      return "执行命令";
    case "mcp":
      return "调用 MCP";
    case "file":
      return "读写文件";
    case "compact":
      return "压缩上下文";
    case "attention":
      return "需要处理";
    case "done":
      return "已结束";
    case "error":
      return "出错";
    default:
      return "运行中";
  }
}

function statusTone(session: SessionView) {
  if (session.hasPendingPermission || session.needsUserAttention || session.status === "attention") {
    return "attention";
  }
  if (session.status === "error") {
    return "error";
  }
  if (session.status === "idle" || session.status === "done") {
    return "idle";
  }
  return "active";
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatWorkspaceLabel(cwd?: string | null) {
  if (!cwd) {
    return "未提供路径";
  }

  const trimmed = cwd.replace(/[\\/]+$/, "");
  if (!trimmed) {
    return cwd;
  }

  const segments = trimmed.split(/[\\/]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : cwd;
}

export default function SessionRow({ session }: { session: SessionView }) {
  const tone = statusTone(session);

  return (
    <div className="session-row flex items-center gap-3 rounded-[22px] px-3.5 py-3">
      <AgentAvatar
        highlighted={session.hasPendingPermission || session.needsUserAttention}
        source={session.source}
        status={session.status}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[var(--bg-muted)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            {agentSourceLabel(session.source)}
          </span>
          <span
            className={clsx(
              "session-status-badge rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em]",
            )}
            data-tone={tone}
          >
            {statusLabel(session)}
          </span>
        </div>
        <div className="session-path mt-2 truncate">{formatWorkspaceLabel(session.cwd)}</div>
        <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">{session.statusDetail}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Elapsed</div>
        <div className="mt-1 font-mono text-sm text-[var(--text-secondary)]">
          {formatDuration(session.durationMs)}
        </div>
      </div>
    </div>
  );
}
