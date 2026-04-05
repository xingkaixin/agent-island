import clsx from "clsx";
import type { SessionView } from "../types/agent";
import AgentAvatar from "./AgentAvatar";

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

function launcherIconSrc(session: SessionView) {
  if (!session.launcher?.iconDataUrl) {
    return null;
  }
  return session.launcher.iconDataUrl;
}

export default function SessionRow({ session }: { session: SessionView }) {
  const tone = statusTone(session);
  const iconSrc = launcherIconSrc(session);

  return (
    <div className="session-row session-row-accent flex items-center gap-3 rounded-xl px-3 py-2.5" data-tone={tone}>
      <AgentAvatar
        highlighted={session.hasPendingPermission || session.needsUserAttention}
        source={session.source}
        status={session.status}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
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
        {session.source === "claude" && session.launcher?.name ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            {iconSrc ? (
              <img
                alt={session.launcher.name}
                className="h-4 w-4 shrink-0 rounded-[4px]"
                src={iconSrc}
              />
            ) : null}
            <span className="truncate">{session.launcher.name}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
