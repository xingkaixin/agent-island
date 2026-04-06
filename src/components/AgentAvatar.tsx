import clsx from "clsx";
import type { AgentSource, SessionStatus } from "../types/agent";

const iconBySource: Record<AgentSource, string> = {
  claude: "/agent-icon/claudecode-color.png",
  codex: "/agent-icon/codex.png",
  cursor: "/agent-icon/cursor.png",
};

const labelBySource: Record<AgentSource, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
};

function statusTone(status?: SessionStatus, highlighted?: boolean) {
  if (
    highlighted ||
    status === "permission" ||
    status === "attention" ||
    status === "error"
  ) {
    return "border-[var(--accent)]";
  }
  return "border-[var(--border-visible)]";
}

interface AgentAvatarProps {
  source: AgentSource;
  status?: SessionStatus;
  highlighted?: boolean;
  size?: "sm" | "md";
}

export function agentSourceLabel(source: AgentSource) {
  return labelBySource[source];
}

export default function AgentAvatar({
  source,
  status,
  highlighted = false,
  size = "md",
}: AgentAvatarProps) {
  return (
    <span
      className={clsx(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-[var(--surface-raised)]",
        statusTone(status, highlighted),
        size === "sm" ? "h-9 w-9" : "h-11 w-11",
      )}
    >
      <img
        alt={labelBySource[source]}
        className={clsx("relative z-10 object-contain", size === "sm" ? "h-5 w-5" : "h-6 w-6")}
        src={iconBySource[source]}
      />
    </span>
  );
}
