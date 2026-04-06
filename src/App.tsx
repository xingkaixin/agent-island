import { useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { motion, useReducedMotion } from 'framer-motion';
import { CircleDot, LogOut, Settings2 } from 'lucide-react';
import SessionRow from './components/SessionRow';
import Settings from './components/Settings';
import AgentAvatar from './components/AgentAvatar';
import {
  getAppState,
  getCurrentWindowLabel,
  onAppStateUpdated,
  openSettingsWindow,
  quitApp,
} from './lib/tauri';
import { useSessionStore } from './store/sessions';
import type { SessionView } from './types/agent';

function summarizeSessions(sessions: SessionView[]) {
  return sessions.reduce(
    (summary, session) => {
      if (session.hasPendingPermission || session.needsUserAttention) {
        summary.attention += 1;
      } else if (session.status === 'idle') {
        summary.idle += 1;
      } else {
        summary.running += 1;
      }
      return summary;
    },
    { running: 0, idle: 0, attention: 0 },
  );
}

function metricTone(value: number, tone: 'active' | 'idle' | 'attention') {
  return value > 0 ? tone : 'idle';
}

export default function App() {
  const { hydrated, sessions, permissionRequest, replaceState } = useSessionStore();
  const [windowLabel, setWindowLabel] = useState('main');
  const reduceMotion = useReducedMotion();
  const focusParkingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      setWindowLabel(await getCurrentWindowLabel());
      replaceState(await getAppState());
    })();

    let disposed = false;

    void onAppStateUpdated((state) => {
      if (!disposed) {
        replaceState(state);
      }
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      window.addEventListener(
        'beforeunload',
        () => {
          unlisten();
        },
        { once: true },
      );
    });

    return () => {
      disposed = true;
    };
  }, [replaceState]);

  useEffect(() => {
    document.body.dataset.window = windowLabel;
    return () => {
      delete document.body.dataset.window;
    };
  }, [windowLabel]);

  const hasAttention = useMemo(
    () => sessions.some((session) => session.needsUserAttention),
    [sessions],
  );
  const attentionSession = useMemo(
    () => sessions.find((session) => session.needsUserAttention || session.hasPendingPermission),
    [sessions],
  );
  const sessionSummary = useMemo(() => summarizeSessions(sessions), [sessions]);

  const parkInitialFocus = () => {
    window.requestAnimationFrame(() => {
      focusParkingRef.current?.focus();
    });
  };

  useEffect(() => {
    if (windowLabel !== 'main') {
      return;
    }
    parkInitialFocus();
    const currentWindow = getCurrentWindow();
    const unlisten = currentWindow.onFocusChanged(({ payload: focused }) => {
      if (!focused) {
        void currentWindow.hide();
        return;
      }
      parkInitialFocus();
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [windowLabel]);

  if (windowLabel === 'settings') {
    return <Settings />;
  }

  const attentionText = permissionRequest || hasAttention ? '需要你回到终端处理' : null;

  const enterMotion = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className="h-screen bg-transparent p-3 text-[var(--text-primary)]">
      <div ref={focusParkingRef} aria-hidden="true" className="sr-only" tabIndex={-1} />
      <motion.div
        {...enterMotion}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className={`menu-panel mx-auto flex h-full max-h-full w-full max-w-[420px] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[rgba(0,0,0,0.92)] ${
          hasAttention || permissionRequest ? 'attention-ring' : ''
        }`}
      >
        <div className="relative border-b border-[var(--border)] px-3 pb-3 pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <img alt="AgentIsland" className="h-6 w-6 object-contain" src="/app-icon.png" />
              </span>
              <div className="min-w-0">
                <div className="font-[var(--font-display)] text-[1.2rem] font-semibold leading-none tracking-[-0.03em] text-[var(--text-display)]">
                  AgentIsland
                </div>
                {attentionText ? (
                  <div className="mt-0.5 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                    {attentionText}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                className="icon-button no-drag rounded-lg p-2"
                onClick={() => {
                  const currentWindow = getCurrentWindow();
                  void currentWindow.hide();
                  void openSettingsWindow();
                }}
                type="button"
              >
                <Settings2 className="h-4 w-4" aria-hidden />
                <span className="sr-only">打开设置</span>
              </button>
              <button
                className="icon-button no-drag rounded-lg p-2"
                onClick={() => void quitApp()}
                type="button"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                <span className="sr-only">退出 AgentIsland</span>
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <span
              className="status-pill-inline"
              data-tone={metricTone(sessionSummary.running, 'active')}
            >
              <span className="font-[var(--font-mono)] font-bold tabular-nums">
                {sessionSummary.running}
              </span>
              <span>运行</span>
            </span>
            <span
              className="status-pill-inline"
              data-tone={metricTone(sessionSummary.idle, 'idle')}
            >
              <span className="font-[var(--font-mono)] font-bold tabular-nums">
                {sessionSummary.idle}
              </span>
              <span>空闲</span>
            </span>
            <span
              className="status-pill-inline"
              data-tone={metricTone(sessionSummary.attention, 'attention')}
            >
              <span className="font-[var(--font-mono)] font-bold tabular-nums">
                {sessionSummary.attention}
              </span>
              <span>待处理</span>
            </span>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 px-2.5 py-2.5">
          {hasAttention || permissionRequest ? (
            <motion.section
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={reduceMotion ? {} : { opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-xl border border-[var(--border)] border-l-2 border-l-[var(--accent)] bg-[var(--surface)] px-3 py-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-[var(--font-mono)] text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--accent)]">
                    需要处理
                  </div>
                  <div className="mt-1 text-sm font-medium leading-snug tracking-[-0.01em]">
                    {attentionSession?.statusDetail ?? '请回到终端继续'}
                  </div>
                </div>
                {attentionSession ? (
                  <AgentAvatar
                    highlighted
                    size="sm"
                    source={attentionSession.source}
                    status={attentionSession.status}
                  />
                ) : null}
              </div>
              <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                审批与输入仍在终端完成；此处仅提示状态。
              </p>
            </motion.section>
          ) : null}

          <section className="panel-card flex min-h-0 flex-1 flex-col rounded-xl p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-[var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                会话
              </h2>
              <span className="font-[var(--font-mono)] text-[10px] text-[var(--text-disabled)]">
                {hydrated ? `${sessions.length} 个` : '同步中…'}
              </span>
            </div>

            {sessions.length > 0 ? (
              <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                {sessions.map((session, index) => (
                  <motion.div
                    key={session.id}
                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                    animate={reduceMotion ? {} : { opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: 0.03 * index, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <SessionRow session={session} />
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center">
                <CircleDot className="mx-auto h-5 w-5 text-[var(--text-disabled)]" aria-hidden />
                <div className="mt-2 text-sm font-medium text-[var(--text-secondary)]">
                  暂无活跃会话
                </div>
                <div className="mt-1 text-xs leading-5 text-[var(--text-disabled)]">
                  有新事件时菜单栏图标会更新。
                </div>
              </div>
            )}
          </section>

          {!hydrated ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-center font-[var(--font-mono)] text-[10px] uppercase tracking-[0.06em] text-[var(--text-secondary)]">
              正在同步…
            </div>
          ) : null}
        </div>
      </motion.div>
    </div>
  );
}
