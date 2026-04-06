import { motion } from 'framer-motion';
import { BellRing, CircleDot, ListTree, Settings2 } from 'lucide-react';
import type { SessionView } from '../types/agent';
import SessionRow from './SessionRow';

interface CapsuleProps {
  sessions: SessionView[];
  hasPermission: boolean;
  hasAttention: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpenSettings: () => void;
  children?: React.ReactNode;
}

export function capsuleWidth(sessions: SessionView[], hasPermission: boolean, expanded: boolean) {
  if (hasPermission) {
    return 420;
  }
  if (expanded && sessions.length > 1) {
    return 420;
  }
  if (sessions.length > 1) {
    return 336;
  }
  if (sessions.length === 1) {
    return 272;
  }
  return 120;
}

export function capsuleHeight(sessions: SessionView[], hasPermission: boolean, expanded: boolean) {
  if (hasPermission) {
    return 320;
  }
  if (expanded && sessions.length > 1) {
    return 236;
  }
  if (sessions.length > 0) {
    return 72;
  }
  return 10;
}

function labelForSession(session: SessionView | undefined) {
  if (!session) {
    return '暂无活跃 session';
  }
  return session.statusDetail;
}

export default function Capsule({
  sessions,
  hasPermission,
  hasAttention,
  expanded,
  onToggleExpanded,
  onOpenSettings,
  children,
}: CapsuleProps) {
  const primarySession = sessions[0];

  return (
    <motion.div
      animate={{
        width: capsuleWidth(sessions, hasPermission, expanded),
        height: capsuleHeight(sessions, hasPermission, expanded),
      }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={`window-drag mx-auto mt-0 overflow-hidden rounded-b-xl border border-[var(--border)] bg-[rgba(0,0,0,0.92)] ${
        hasAttention ? 'attention-ring' : ''
      }`}
    >
      <div className="flex h-16 items-center gap-3 px-4 pt-1">
        <button
          className="no-drag flex min-w-0 flex-1 items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left"
          onClick={onToggleExpanded}
          type="button"
        >
          <div className="flex items-center gap-1.5">
            {sessions.slice(0, 4).map((session) => (
              <span
                key={session.id}
                className={`flex h-7 w-7 items-center justify-center rounded-full font-[var(--font-mono)] text-[11px] font-bold ${
                  session.hasPendingPermission || session.needsUserAttention
                    ? 'border border-[var(--accent)] text-[var(--accent)]'
                    : 'border border-[var(--border-visible)] text-[var(--text-primary)]'
                }`}
              >
                {session.source.slice(0, 1).toUpperCase()}
              </span>
            ))}
            {sessions.length === 0 ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border)] text-[var(--text-secondary)]">
                <CircleDot className="h-4 w-4" />
              </span>
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-[var(--text-primary)]">
              {sessions.length <= 1 ? 'AgentIsland' : `${sessions.length} 个活跃 session`}
            </div>
            <div className="truncate text-xs text-[var(--text-secondary)]">
              {labelForSession(primarySession)}
            </div>
          </div>
          <div className="flex items-center gap-2 text-[var(--text-secondary)]">
            {hasAttention ? <BellRing className="session-pulse h-4 w-4" /> : null}
            {sessions.length > 1 ? <ListTree className="h-4 w-4" /> : null}
          </div>
        </button>
        <button
          className="no-drag rounded-full border border-[var(--border)] p-2 text-[var(--text-secondary)] transition-colors duration-150 hover:border-[var(--border-visible)] hover:text-[var(--text-primary)]"
          onClick={onOpenSettings}
          type="button"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </div>
      {children ? <div className="px-3 pb-3">{children}</div> : null}
      {!children && expanded && sessions.length > 1 ? (
        <div className="space-y-2 px-3 pb-3">
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </div>
      ) : null}
    </motion.div>
  );
}
