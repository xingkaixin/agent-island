import clsx from "clsx";
import type { AgentSource, SessionStatus } from "../types/agent";

const iconBySource: Record<AgentSource, string> = {
  claude: "/agent-icon/claudecode-color.png",
  codex: "/agent-icon/codex-color.png",
  cursor: "/agent-icon/cursor.png",
};

const labelBySource: Record<AgentSource, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
};

function statusTone(status?: SessionStatus, highlighted?: boolean) {
  if (highlighted || status === "permission") {
    return "border-[var(--accent)]/40 bg-[var(--accent)]/8";
  }
  if (status === "attention" || status === "error") {
    return "border-[var(--danger)]/25 bg-[var(--danger-soft)]";
  }
  return "border-[var(--line)] bg-white/75";
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
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full border",
        statusTone(status, highlighted),
        size === "sm" ? "h-8 w-8" : "h-10 w-10",
      )}
    >
      <img
        alt={labelBySource[source]}
        className={clsx("object-contain", size === "sm" ? "h-5 w-5" : "h-6 w-6")}
        src={iconBySource[source]}
      />
    </span>
  );
}
