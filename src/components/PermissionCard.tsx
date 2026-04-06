import { Check, X } from 'lucide-react';
import type { PermissionRequestView } from '../types/agent';
import AgentAvatar from './AgentAvatar';

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
    <div className="no-drag flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text-primary)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <AgentAvatar highlighted size="sm" source={permission.source} status="permission" />
          <div>
            <div className="text-sm font-medium">需要审批</div>
            <div className="font-[var(--font-mono)] text-[10px] text-[var(--text-secondary)]">
              {permission.sessionId}
            </div>
          </div>
        </div>
        <div className="rounded-full border border-[var(--border-visible)] px-2.5 py-1 font-[var(--font-mono)] text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--interactive)]">
          {permission.toolName}
        </div>
      </div>
      <div className="rounded-lg bg-[var(--surface-raised)] p-3 text-sm leading-6">
        <div>{permission.summary}</div>
        {permission.rawArgsPreview ? (
          <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md border border-[var(--border)] bg-[var(--black)] p-2 font-[var(--font-mono)] text-[11px] text-[var(--text-secondary)]">
            {permission.rawArgsPreview}
          </pre>
        ) : null}
      </div>
      <div className="flex gap-2">
        <button
          className="flex flex-1 items-center justify-center gap-2 rounded-full border border-[var(--text-primary)] bg-[var(--text-primary)] px-4 py-2 font-[var(--font-mono)] text-xs font-bold uppercase tracking-[0.06em] text-[var(--black)] disabled:opacity-40"
          disabled={busy}
          onClick={onApprove}
        >
          <Check className="h-4 w-4" />
          APPROVE
        </button>
        <button
          className="flex flex-1 items-center justify-center gap-2 rounded-full border border-[var(--accent)] bg-transparent px-4 py-2 font-[var(--font-mono)] text-xs font-bold uppercase tracking-[0.06em] text-[var(--accent)] disabled:opacity-40"
          disabled={busy}
          onClick={onDeny}
        >
          <X className="h-4 w-4" />
          DENY
        </button>
      </div>
    </div>
  );
}
