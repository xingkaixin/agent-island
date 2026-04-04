import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion, useReducedMotion } from "framer-motion";
import { CircleDot, Settings2 } from "lucide-react";
import SessionRow from "./components/SessionRow";
import Settings from "./components/Settings";
import AgentAvatar from "./components/AgentAvatar";
import {
  getAppState,
  getCurrentWindowLabel,
  onAppStateUpdated,
  openSettingsWindow,
} from "./lib/tauri";
import { useSessionStore } from "./store/sessions";
import type { SessionView } from "./types/agent";

function summarizeSessions(sessions: SessionView[]) {
  return sessions.reduce(
    (summary, session) => {
      if (session.hasPendingPermission || session.needsUserAttention) {
        summary.attention += 1;
      } else if (session.status === "idle") {
        summary.idle += 1;
      } else {
        summary.running += 1;
      }
      return summary;
    },
    { running: 0, idle: 0, attention: 0 },
  );
}

function metricTone(value: number, tone: "active" | "idle" | "attention") {
  return value > 0 ? tone : "idle";
}

export default function App() {
  const { hydrated, sessions, permissionRequest, replaceState } = useSessionStore();
  const [windowLabel, setWindowLabel] = useState("main");
  const reduceMotion = useReducedMotion();

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
        "beforeunload",
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

  useEffect(() => {
    if (windowLabel !== "main") {
      return;
    }
    const currentWindow = getCurrentWindow();
    const unlisten = currentWindow.onFocusChanged(({ payload: focused }) => {
      if (!focused) {
        void currentWindow.hide();
      }
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [windowLabel]);

  if (windowLabel === "settings") {
    return <Settings />;
  }

  const statusText = sessions.length === 0
    ? "暂无活跃 agent"
    : [
        sessionSummary.running > 0 ? `${sessionSummary.running} 个运行中` : null,
        sessionSummary.idle > 0 ? `${sessionSummary.idle} 个空闲中` : null,
        sessionSummary.attention > 0 ? `${sessionSummary.attention} 个待处理` : null,
      ]
        .filter(Boolean)
        .join(" · ");

  const attentionText = permissionRequest || hasAttention
    ? `需要你回到终端处理 · ${statusText}`
    : statusText;

  const enterMotion = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className="min-h-screen bg-transparent p-3 text-[var(--text-primary)]">
      <motion.div
        {...enterMotion}
        transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
        className={`menu-panel mx-auto flex h-[520px] w-full max-w-[420px] flex-col overflow-hidden rounded-[30px] border border-white/60 bg-[var(--bg-shell)]/96 ${
          hasAttention || permissionRequest ? "attention-ring" : ""
        }`}
      >
        <div className="relative border-b border-[var(--line)]/80 px-4 pb-4 pt-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="eyebrow">Menu Overview</div>
              <div className="mt-2 flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-white/70 bg-white/80 shadow-[0_12px_28px_rgba(79,54,25,0.1)]">
                  <img alt="AgentIsland" className="h-6 w-6 object-contain" src="/app-icon.png" />
                </span>
                <div className="min-w-0">
                  <div className="text-[1.1rem] font-semibold tracking-[-0.02em]">AgentIsland</div>
                  <div className="mt-0.5 text-sm text-[var(--text-secondary)]">{attentionText}</div>
                </div>
              </div>
            </div>
            <button
              className="icon-button no-drag rounded-full p-2.5"
              onClick={() => {
                const currentWindow = getCurrentWindow();
                void currentWindow.hide();
                void openSettingsWindow();
              }}
              type="button"
            >
              <Settings2 className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {sessions.length > 0 ? (
                sessions.slice(0, 5).map((session, index) => (
                  <motion.div
                    key={session.id}
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.92, x: 10 }}
                    animate={reduceMotion ? {} : { opacity: 1, scale: 1, x: 0 }}
                    transition={{ duration: 0.26, delay: 0.03 * index, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <AgentAvatar
                      highlighted={session.hasPendingPermission || session.needsUserAttention}
                      size="sm"
                      source={session.source}
                      status={session.status}
                    />
                  </motion.div>
                ))
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] bg-white/70 text-[var(--text-secondary)]">
                  <CircleDot className="h-4 w-4" />
                </span>
              )}
            </div>

            <div className="grid min-w-0 flex-1 grid-cols-3 gap-2">
              <div
                className="metric-chip rounded-2xl px-3 py-2 text-center"
                data-tone={metricTone(sessionSummary.running, "active")}
              >
                <div className="text-base font-semibold leading-none">{sessionSummary.running}</div>
                <div className="mt-1 text-[11px] text-[var(--text-secondary)]">运行中</div>
              </div>
              <div
                className="metric-chip rounded-2xl px-3 py-2 text-center"
                data-tone={metricTone(sessionSummary.idle, "idle")}
              >
                <div className="text-base font-semibold leading-none">{sessionSummary.idle}</div>
                <div className="mt-1 text-[11px] text-[var(--text-secondary)]">空闲</div>
              </div>
              <div
                className="metric-chip rounded-2xl px-3 py-2 text-center"
                data-tone={metricTone(sessionSummary.attention, "attention")}
              >
                <div className="text-base font-semibold leading-none">{sessionSummary.attention}</div>
                <div className="mt-1 text-[11px] text-[var(--text-secondary)]">待处理</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {hasAttention || permissionRequest ? (
            <motion.section
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={reduceMotion ? {} : { opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="hero-card rounded-[26px] px-4 py-4"
            >
              <div className="section-header">
                <div>
                  <div className="eyebrow">Needs Attention</div>
                  <div className="mt-2 text-base font-semibold tracking-[-0.02em]">
                    {attentionSession?.statusDetail ?? "需要你返回终端"}
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
              <div className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                AgentIsland 负责把关键状态提到桌面层。实际审批和处理仍在终端完成。
              </div>
            </motion.section>
          ) : null}

          <section className="panel-card rounded-[26px] p-3.5">
            <div className="section-header">
              <div>
                <div className="eyebrow">Sessions</div>
                <div className="mt-2 text-base font-semibold tracking-[-0.02em]">当前活跃 Agent</div>
              </div>
              <div className="rounded-full border border-[var(--line)]/80 bg-white/70 px-3 py-1 text-xs text-[var(--text-secondary)]">
                {hydrated ? `${sessions.length} 个会话` : "同步中"}
              </div>
            </div>
            <div className="subtle-divider my-3" />

            {sessions.length > 0 ? (
              <div className="space-y-2.5">
                {sessions.map((session, index) => (
                  <motion.div
                    key={session.id}
                    initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                    animate={reduceMotion ? {} : { opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, delay: 0.04 * index, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <SessionRow session={session} />
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="panel-card-soft rounded-[22px] px-4 py-9 text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line)] bg-white/70 text-[var(--text-secondary)]">
                  <CircleDot className="h-5 w-5" />
                </div>
                <div className="mt-3 text-sm font-medium">暂无活跃 agent</div>
                <div className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                  菜单栏会回到静止状态，新的终端事件出现时会自动恢复提示。
                </div>
              </div>
            )}
          </section>

          {!hydrated ? (
            <div className="rounded-full border border-[var(--line)]/80 bg-white/55 px-3 py-2 text-center text-xs text-[var(--text-secondary)]">
              正在同步状态...
            </div>
          ) : null}
        </div>
      </motion.div>
    </div>
  );
}
