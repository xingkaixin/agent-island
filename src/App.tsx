import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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

export default function App() {
  const { hydrated, sessions, permissionRequest, replaceState } = useSessionStore();
  const [windowLabel, setWindowLabel] = useState("main");

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
        sessionSummary.idle > 0 ? `${sessionSummary.idle} 个睡觉中` : null,
        sessionSummary.attention > 0 ? `${sessionSummary.attention} 个待处理` : null,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <div className="min-h-screen bg-transparent p-3 text-[var(--text-primary)]">
      <div className="menu-panel mx-auto flex h-[520px] w-full max-w-[420px] flex-col overflow-hidden rounded-[28px] border border-white/60 bg-[var(--bg-shell)]/96">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-md border border-[var(--line)] bg-white/80">
                  <img alt="AgentIsland" className="h-4 w-4 object-contain" src="/app-icon.png" />
                </span>
                <span>AgentIsland</span>
              </span>
            </div>
            <div className="mt-1 text-sm text-[var(--text-secondary)]">
              {permissionRequest || hasAttention ? `需要你回到终端处理 · ${statusText}` : statusText}
            </div>
            <div className="mt-3 flex items-center gap-2">
              {sessions.length > 0 ? (
                sessions.slice(0, 5).map((session) => (
                  <AgentAvatar
                    key={session.id}
                    highlighted={session.hasPendingPermission || session.needsUserAttention}
                    size="sm"
                    source={session.source}
                    status={session.status}
                  />
                ))
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] bg-white/70 text-[var(--text-secondary)]">
                  <CircleDot className="h-4 w-4" />
                </span>
              )}
            </div>
          </div>
          <button
            className="rounded-full bg-black/5 p-2 text-[var(--text-secondary)] hover:bg-black/8"
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

        <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {hasAttention || permissionRequest ? (
            <div className="rounded-[24px] border border-[var(--accent)]/20 bg-white/80 p-4">
              <div className="flex items-center gap-3">
                {attentionSession ? (
                  <AgentAvatar
                    highlighted
                    size="sm"
                    source={attentionSession.source}
                    status={attentionSession.status}
                  />
                ) : null}
                <div className="text-sm font-semibold">
                  {attentionSession?.statusDetail ?? "需要你返回终端"}
                </div>
              </div>
              <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                AgentIsland 只负责提醒当前发生了什么事件，实际处理请回到 Claude 终端完成。
              </div>
            </div>
          ) : null}

          <section className="rounded-[24px] border border-[var(--line)] bg-white/70 p-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold">当前活跃 Agent</div>
              <div className="text-xs text-[var(--text-secondary)]">
                {hydrated ? `${sessions.length} 个` : "同步中"}
              </div>
            </div>

            {sessions.length > 0 ? (
              <div className="space-y-2">
                {sessions.map((session) => (
                  <SessionRow key={session.id} session={session} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[#fffaf4] px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
                暂无活跃 agent，菜单栏会保持静止图标。
              </div>
            )}
          </section>

          {!hydrated ? (
            <div className="rounded-full bg-white/50 px-3 py-2 text-center text-xs text-[var(--text-secondary)]">
              正在同步状态...
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
