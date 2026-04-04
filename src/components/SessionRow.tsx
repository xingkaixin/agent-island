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

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function SessionRow({ session }: { session: SessionView }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-white/60 px-3 py-2">
      <AgentAvatar
        highlighted={session.hasPendingPermission || session.needsUserAttention}
        source={session.source}
        status={session.status}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="truncate">{session.cwd ?? "未提供路径"}</span>
        </div>
        <div className="truncate text-xs text-[var(--text-secondary)]">
          {statusLabel(session)} · {session.statusDetail}
        </div>
      </div>
      <div className="shrink-0 text-right text-[11px] text-[var(--text-secondary)]">
        {formatDuration(session.durationMs)}
      </div>
    </div>
  );
}
