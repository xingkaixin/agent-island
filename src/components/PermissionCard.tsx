import { Check, X } from "lucide-react";
import type { PermissionRequestView } from "../types/agent";
import AgentAvatar, { agentSourceLabel } from "./AgentAvatar";

interface PermissionCardProps {
  permission: PermissionRequestView;
  onApprove: () => void;
  onDeny: () => void;
  busy: boolean;
}

export default function PermissionCard({
  permission,
  onApprove,
  onDeny,
  busy,
}: PermissionCardProps) {
  return (
    <div className="no-drag flex flex-col gap-3 rounded-[28px] border border-[var(--line)] bg-[var(--bg-shell)] p-4 text-[var(--text-primary)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <AgentAvatar highlighted size="sm" source={permission.source} status="permission" />
          <div>
            <div className="text-sm font-semibold">需要审批</div>
            <div className="text-xs text-[var(--text-secondary)]">
              {agentSourceLabel(permission.source)} / {permission.sessionId}
            </div>
          </div>
        </div>
        <div className="rounded-full bg-[var(--accent)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--accent-strong)]">
          {permission.toolName}
        </div>
      </div>
      <div className="rounded-2xl bg-white/80 p-3 text-sm leading-6">
        <div>{permission.summary}</div>
        {permission.rawArgsPreview ? (
          <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-black/5 p-2 text-[11px] text-[var(--text-secondary)]">
            {permission.rawArgsPreview}
          </pre>
        ) : null}
      </div>
      <div className="flex gap-2">
        <button
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--bg-strong)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={busy}
          onClick={onApprove}
        >
          <Check className="h-4 w-4" />
          Approve
        </button>
        <button
          className="flex flex-1 items-center justify-center gap-2 rounded-full border border-[var(--danger)]/20 bg-[var(--danger-soft)] px-4 py-2 text-sm font-semibold text-[var(--danger)] disabled:opacity-50"
          disabled={busy}
          onClick={onDeny}
        >
          <X className="h-4 w-4" />
          Deny
        </button>
      </div>
    </div>
  );
}
