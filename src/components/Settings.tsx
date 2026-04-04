import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight, FileText } from "lucide-react";
import {
  getAppState,
  getInstallStatus,
  getLogTimeline,
  injectAgentHooks,
  removeAgentHooks,
  restoreAgentBackup,
  setUserPreferences,
} from "../lib/tauri";
import { useSessionStore } from "../store/sessions";
import type {
  AgentSource,
  InstallStatusItem,
  TimelineLogEntry,
  UserPreferences,
} from "../types/agent";
import AgentAvatar, { agentSourceLabel } from "./AgentAvatar";
import LogCenter from "./LogCenter";

const agents: AgentSource[] = ["claude", "codex", "cursor"];

function installTone(item: InstallStatusItem | undefined) {
  if (item?.injected) {
    return "success";
  }
  if (item?.exists) {
    return "warning";
  }
  return "muted";
}

function installLabel(item: InstallStatusItem | undefined) {
  if (item?.injected) {
    return "已注入";
  }
  if (item?.exists) {
    return "未注入";
  }
  return "文件不存在";
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Settings() {
  const { preferences, logs, updatePreferences, replaceState } = useSessionStore();
  const [installStatus, setInstallStatus] = useState<InstallStatusItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [page, setPage] = useState<"overview" | "logs">("overview");
  const [timeline, setTimeline] = useState<TimelineLogEntry[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const reduceMotion = useReducedMotion();

  async function refreshTimeline() {
    setTimelineLoading(true);
    try {
      setTimeline(await getLogTimeline(1000));
    } finally {
      setTimelineLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      const [state, status, nextTimeline] = await Promise.all([
        getAppState(),
        getInstallStatus(),
        getLogTimeline(1000),
      ]);
      replaceState(state);
      setInstallStatus(status);
      setTimeline(nextTimeline);
    })();
  }, [replaceState]);

  useEffect(() => {
    if (page === "logs") {
      void refreshTimeline();
    }
  }, [logs.length, page]);

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

  const staggerTransition = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 } };

  const recentTimeline = useMemo(() => timeline.slice(0, 4), [timeline]);

  return (
    <div className="min-h-screen bg-transparent p-6 text-[var(--text-primary)]">
      <motion.div
        {...staggerTransition}
        transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
        className="settings-shell mx-auto flex max-w-5xl flex-col gap-6 rounded-[32px] p-6"
      >
        <section className="settings-card relative overflow-hidden rounded-[28px] px-6 py-6">
          <div className="eyebrow">{page === "overview" ? "Settings" : "Log Center"}</div>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h1 className="text-[2rem] font-semibold tracking-[-0.03em]">
                {page === "overview" ? "AgentIsland 设置" : "AgentIsland 日志中心"}
              </h1>
              <p className="mt-2 max-w-[60ch] text-sm leading-6 text-[var(--text-secondary)]">
                {page === "overview"
                  ? "管理 Hook 注入、桌面通知与菜单栏行为。设置负责配置系统，日志中心负责解释事实。"
                  : "按时间线查看已接收事件和 bridge 诊断日志，专门用来回答“收到了什么、为什么这样显示”。"}
              </p>
            </div>
            <div className="grid max-w-md grid-cols-3 gap-2">
              <div className="metric-chip rounded-2xl px-3 py-3 text-center" data-tone="active">
                <div className="text-base font-semibold leading-none">{agents.length}</div>
                <div className="mt-1 text-[11px] text-[var(--text-secondary)]">受管 Agent</div>
              </div>
              <div className="metric-chip rounded-2xl px-3 py-3 text-center" data-tone="attention">
                <div className="text-base font-semibold leading-none">{timeline.length}</div>
                <div className="mt-1 text-[11px] text-[var(--text-secondary)]">时间线日志</div>
              </div>
              <div className="metric-chip rounded-2xl px-3 py-3 text-center" data-tone="idle">
                <div className="text-base font-semibold leading-none">
                  {preferences.notificationsEnabled ? "On" : "Off"}
                </div>
                <div className="mt-1 text-[11px] text-[var(--text-secondary)]">通知状态</div>
              </div>
            </div>
          </div>
        </section>

        {page === "logs" ? (
          <LogCenter
            entries={timeline}
            loading={timelineLoading}
            onBack={() => setPage("overview")}
            onRefresh={() => void refreshTimeline()}
          />
        ) : (
          <section className="grid gap-6 lg:grid-cols-[1.18fr_0.82fr]">
            <motion.div
              {...staggerTransition}
              transition={{ duration: 0.34, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
              className="settings-card rounded-[28px] p-6"
            >
              <div className="section-header">
                <div>
                  <div className="eyebrow">Hooks</div>
                  <div className="mt-2 text-xl font-semibold tracking-[-0.02em]">Hook 注入</div>
                </div>
              </div>
              <div className="mt-2 max-w-[62ch] text-sm leading-6 text-[var(--text-secondary)]">
                Hook 只负责把事件上报给 AgentIsland；应用未启动时会上报失败并静默跳过，不影响 agent 自身执行。
              </div>
              <div className="mt-5 space-y-4">
                {agents.map((agent, index) => {
                  const item = installStatus.find((status) => status.agent === agent);
                  return (
                    <motion.div
                      key={agent}
                      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                      animate={reduceMotion ? {} : { opacity: 1, y: 0 }}
                      transition={{ duration: 0.24, delay: 0.04 * index, ease: [0.22, 1, 0.36, 1] }}
                      className="settings-agent-card rounded-[24px] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <AgentAvatar size="sm" source={agent} />
                          <div className="min-w-0">
                            <div className="text-base font-semibold">{agentSourceLabel(agent)}</div>
                            <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">
                              {item?.path}
                            </div>
                          </div>
                        </div>
                        <div
                          className="status-pill rounded-full px-3 py-1 text-xs font-semibold"
                          data-tone={installTone(item)}
                        >
                          {installLabel(item)}
                        </div>
                      </div>

                      {item?.agent === "cursor" ? (
                        <div className="mt-3 rounded-2xl bg-[var(--bg-muted)] px-3 py-2 text-xs leading-5 text-[var(--text-secondary)]">
                          Cursor 会话后续只要再产生新的 hook 事件，就会重新进入活跃列表；日志中心则会保留它收到过的完整时间线。
                        </div>
                      ) : null}

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          className="primary-button rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50"
                          disabled={busy !== null}
                          onClick={() => runAgentAction("inject", injectAgentHooks, agent)}
                          type="button"
                        >
                          注入
                        </button>
                        <button
                          className="secondary-button rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50"
                          disabled={busy !== null}
                          onClick={() => runAgentAction("remove", removeAgentHooks, agent)}
                          type="button"
                        >
                          移除
                        </button>
                        <button
                          className="secondary-button rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50"
                          disabled={busy !== null}
                          onClick={() => runAgentAction("restore", restoreAgentBackup, agent)}
                          type="button"
                        >
                          恢复备份
                        </button>
                      </div>

                      {item?.backupPath ? (
                        <div className="mt-3 text-xs text-[var(--text-secondary)]">
                          备份路径: {item.backupPath}
                        </div>
                      ) : null}
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>

            <div className="space-y-6">
              <motion.section
                {...staggerTransition}
                transition={{ duration: 0.34, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
                className="settings-card rounded-[28px] p-6"
              >
                <div className="eyebrow">Preferences</div>
                <div className="mt-2 text-xl font-semibold tracking-[-0.02em]">偏好设置</div>
                <div className="mt-4 space-y-3 text-sm">
                  <label className="setting-row flex items-center justify-between gap-4 rounded-[22px] px-4 py-3">
                    <div>
                      <div className="font-semibold">系统通知</div>
                      <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                        在桌面层提醒终端状态变化，但不替代终端内的审批流程。
                      </div>
                    </div>
                    <input
                      aria-label="切换系统通知"
                      checked={preferences.notificationsEnabled}
                      className="setting-switch"
                      onChange={(event) =>
                        void savePreferences({
                          ...preferences,
                          notificationsEnabled: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                  </label>
                  <label className="setting-row flex items-center justify-between gap-4 rounded-[22px] px-4 py-3">
                    <div>
                      <div className="font-semibold">开机自启动</div>
                      <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                        在登录后自动恢复菜单栏监控，减少手动启动成本。
                      </div>
                    </div>
                    <input
                      aria-label="切换开机自启动"
                      checked={preferences.launchAtLogin}
                      className="setting-switch"
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
              </motion.section>

              <motion.section
                {...staggerTransition}
                transition={{ duration: 0.34, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
                className="settings-card rounded-[28px] p-6"
              >
                <div className="section-header">
                  <div>
                    <div className="eyebrow">Logs</div>
                    <div className="mt-2 text-xl font-semibold tracking-[-0.02em]">日志中心入口</div>
                  </div>
                  <div className="rounded-full border border-[var(--line)]/80 bg-white/70 px-3 py-1 text-xs text-[var(--text-secondary)]">
                    {timeline.length} 条
                  </div>
                </div>
                <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                  设置页只展示摘要，完整日志放到独立详情页里查看，避免配置和排障信息挤在同一个滚动区。
                </div>
                <button
                  className="log-entry-button mt-4 w-full rounded-[22px] px-4 py-4 text-left"
                  onClick={() => setPage("logs")}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--line)] bg-white/70">
                        <FileText className="h-5 w-5 text-[var(--accent-strong)]" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">查看日志详情</div>
                        <div className="mt-1 text-xs text-[var(--text-secondary)]">
                          时间线、按 Agent 筛选、按 hook 事件筛选、bridge 诊断阶段
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
                  </div>
                </button>

                <div className="mt-4 space-y-2">
                  {recentTimeline.length > 0 ? (
                    recentTimeline.map((entry) => (
                      <div key={entry.id} className="timeline-preview-row rounded-[18px] px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">
                              {agentSourceLabel(entry.source)} · {entry.kind}
                            </div>
                            <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">
                              {entry.channel === "bridge" ? `bridge / ${entry.stage}` : "hook event"}
                            </div>
                          </div>
                          <div className="shrink-0 text-[11px] text-[var(--text-tertiary)]">
                            {formatTime(entry.createdAt)}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="panel-card-soft rounded-[22px] px-4 py-8 text-center">
                      <div className="text-sm font-medium">暂无日志</div>
                      <div className="mt-1 text-sm text-[var(--text-secondary)]">
                        新的 hook 事件到达后会自动出现在日志中心。
                      </div>
                    </div>
                  )}
                </div>
              </motion.section>
            </div>
          </section>
        )}
      </motion.div>
    </div>
  );
}
