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
    return "border-[rgba(59,126,255,0.22)] bg-[rgba(235,243,255,0.94)] shadow-[0_8px_20px_rgba(59,126,255,0.12)]";
  }
  if (status === "attention" || status === "error") {
    return "border-[rgba(224,66,79,0.18)] bg-[rgba(255,242,243,0.94)] shadow-[0_8px_20px_rgba(224,66,79,0.10)]";
  }
  if (status === "idle" || status === "done") {
    return "border-[rgba(80,100,160,0.11)] bg-[rgba(255,255,255,0.82)]";
  }
  return "border-[rgba(34,166,99,0.14)] bg-[rgba(240,252,246,0.94)] shadow-[0_8px_20px_rgba(34,166,99,0.08)]";
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
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border transition-transform duration-200 ease-[var(--ease-out)]",
        "before:absolute before:inset-[1px] before:rounded-full before:bg-[linear-gradient(180deg,rgba(255,255,255,0.58),rgba(255,255,255,0))] before:content-['']",
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
