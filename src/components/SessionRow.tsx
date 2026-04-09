import { useState } from 'react';
import { Bot, Sparkles, UserRound, X } from 'lucide-react';
import { forceRemoveSession } from '../lib/tauri';
import type { SessionView } from '../types/agent';
import { agentSourceLabel } from './AgentAvatar';
import SessionStatusSprite from './SessionStatusSprite';

function formatWorkspaceLabel(cwd?: string | null) {
  if (!cwd) {
    return null;
  }

  const trimmed = cwd.replace(/[\\/]+$/, '');
  if (!trimmed) {
    return cwd;
  }

  const segments = trimmed.split(/[\\/]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : cwd;
}

function sessionProjectName(session: SessionView) {
  return formatWorkspaceLabel(session.cwd) ?? session.title;
}

function launcherIconSrc(session: SessionView) {
  if (!session.launcher?.iconDataUrl) {
    return null;
  }
  return session.launcher.iconDataUrl;
}

function launcherLabel(session: SessionView) {
  return session.launcher?.name ?? agentSourceLabel(session.source);
}

function hookIcon(role?: SessionView['recentHooks'][number]['role'] | null) {
  switch (role) {
    case 'user':
      return <UserRound className="h-[0.72rem] w-[0.72rem]" aria-hidden />;
    case 'assistant':
      return <Bot className="h-[0.72rem] w-[0.72rem]" aria-hidden />;
    default:
      return <Sparkles className="h-[0.72rem] w-[0.72rem]" aria-hidden />;
  }
}

export default function SessionRow({ session }: { session: SessionView }) {
  const iconSrc = launcherIconSrc(session);
  const launcherName = launcherLabel(session);
  const projectName = sessionProjectName(session);
  const hooks = session.recentHooks.slice(0, 3).toReversed();
  const [isRemoving, setIsRemoving] = useState(false);

  async function handleForceRemove() {
    if (isRemoving) {
      return;
    }
    setIsRemoving(true);
    try {
      await forceRemoveSession(session.id);
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <div className="session-row session-row-v2 group relative flex gap-2.5 rounded-xl px-2.5 py-2.5">
      <div className="flex shrink-0 items-center">
        <SessionStatusSprite
          hasPendingPermission={session.hasPendingPermission}
          needsUserAttention={session.needsUserAttention}
          status={session.status}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <div className="session-project-name truncate">{projectName}</div>
            <button
              aria-label={`强退会话 ${projectName}`}
              className="session-inline-dismiss no-drag shrink-0 disabled:opacity-50"
              disabled={isRemoving}
              onClick={() => void handleForceRemove()}
              title="强退会话"
              type="button"
            >
              <X className="h-[0.96rem] w-[0.96rem]" aria-hidden />
            </button>
          </div>
          <div className="session-launcher min-w-0 shrink-0">
            {iconSrc ? (
              <img alt={launcherName} className="h-4 w-4 shrink-0 rounded-[4px]" src={iconSrc} />
            ) : null}
            <span className="truncate">{launcherName}</span>
          </div>
        </div>

        {hooks.length > 0 ? (
          <div className="mt-2 space-y-1">
            {hooks.map((hook) => (
              <div
                key={`${session.id}-${hook.kind}-${hook.role}-${hook.text}`}
                className="session-hook-line"
              >
                <span className="session-hook-icon">{hookIcon(hook.role)}</span>
                <span className="min-w-0 truncate">{hook.text}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
