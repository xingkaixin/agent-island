import { useEffect, useState } from "react";
import {
  getAppState,
  getInstallStatus,
  injectAgentHooks,
  removeAgentHooks,
  restoreAgentBackup,
  setUserPreferences,
} from "../lib/tauri";
import { useSessionStore } from "../store/sessions";
import type { AgentSource, InstallStatusItem, UserPreferences } from "../types/agent";

const agents: AgentSource[] = ["claude", "codex", "cursor"];

export default function Settings() {
  const { preferences, logs, updatePreferences, replaceState } = useSessionStore();
  const [installStatus, setInstallStatus] = useState<InstallStatusItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [state, status] = await Promise.all([getAppState(), getInstallStatus()]);
      replaceState(state);
      setInstallStatus(status);
    })();
  }, [replaceState]);

  async function runAgentAction(
    key: string,
    action: (agent: AgentSource) => Promise<unknown>,
    agent: AgentSource,
  ) {
    setBusy(`${key}:${agent}`);
    try {
      await action(agent);
      setInstallStatus(await getInstallStatus());
    } finally {
      setBusy(null);
    }
  }

  async function savePreferences(next: UserPreferences) {
    updatePreferences(next);
    await setUserPreferences(next);
  }

  return (
    <div className="min-h-screen bg-[#f7f0e7] p-6 text-[var(--text-primary)]">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <section className="rounded-[28px] border border-[var(--line)] bg-white/80 p-6">
          <h1 className="text-2xl font-semibold">AgentIsland 设置</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            管理 Hook 注入、通知与菜单栏行为。
          </p>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[28px] border border-[var(--line)] bg-white/80 p-6">
            <div className="text-lg font-semibold">Hook 注入</div>
            <div className="mt-1 text-sm text-[var(--text-secondary)]">
              Hook 只负责把事件上报给 AgentIsland；应用未启动时会上报失败并静默跳过，不影响 agent 自身执行。
            </div>
            <div className="mt-4 space-y-4">
              {agents.map((agent) => {
                const item = installStatus.find((status) => status.agent === agent);
                return (
                  <div
                    key={agent}
                    className="rounded-2xl border border-[var(--line)] bg-[#fffaf4] p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold capitalize">{agent}</div>
                        <div className="text-xs text-[var(--text-secondary)]">
                          {item?.path}
                        </div>
                      </div>
                      <div className="rounded-full bg-black/5 px-3 py-1 text-xs">
                        {item?.injected ? "已注入" : item?.exists ? "未注入" : "文件不存在"}
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        className="rounded-full bg-[var(--bg-strong)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={busy !== null}
                        onClick={() => runAgentAction("inject", injectAgentHooks, agent)}
                        type="button"
                      >
                        注入
                      </button>
                      <button
                        className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
                        disabled={busy !== null}
                        onClick={() => runAgentAction("remove", removeAgentHooks, agent)}
                        type="button"
                      >
                        移除
                      </button>
                      <button
                        className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
                        disabled={busy !== null}
                        onClick={() => runAgentAction("restore", restoreAgentBackup, agent)}
                        type="button"
                      >
                        恢复备份
                      </button>
                    </div>
                    {item?.backupPath ? (
                      <div className="mt-2 text-xs text-[var(--text-secondary)]">
                        备份: {item.backupPath}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            <section className="rounded-[28px] border border-[var(--line)] bg-white/80 p-6">
              <div className="text-lg font-semibold">偏好设置</div>
              <div className="mt-4 space-y-4 text-sm">
                <label className="flex items-center justify-between gap-3">
                  <span>系统通知</span>
                  <input
                    checked={preferences.notificationsEnabled}
                    onChange={(event) =>
                      void savePreferences({
                        ...preferences,
                        notificationsEnabled: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span>开机自启动</span>
                  <input
                    checked={preferences.launchAtLogin}
                    onChange={(event) =>
                      void savePreferences({
                        ...preferences,
                        launchAtLogin: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                </label>
              </div>
            </section>

            <section className="rounded-[28px] border border-[var(--line)] bg-white/80 p-6">
              <div className="text-lg font-semibold">最近日志</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">
                应用内事件日志展示在这里；更底层的 hook 原始日志会写入
                <span className="font-mono"> ~/.agentisland/logs/bridge.log</span>
              </div>
              <div className="mt-4 max-h-96 space-y-3 overflow-auto">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-2xl border border-[var(--line)] bg-[#fffaf4] p-3"
                  >
                    <div className="text-xs font-semibold uppercase text-[var(--accent-strong)]">
                      {log.source} / {log.kind}
                    </div>
                    <div className="mt-1 text-xs text-[var(--text-secondary)]">
                      {log.createdAt}
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap break-all text-xs text-[var(--text-secondary)]">
                      {log.raw}
                    </pre>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  );
}
