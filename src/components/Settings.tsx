import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Download, FileText, Trash2 } from "lucide-react";
import {
  getAppState,
  getInstallStatus,
  getLogTimeline,
  injectAgentHooks,
  removeAgentHooks,
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

  const recentTimeline = useMemo(() => timeline.slice(0, 3), [timeline]);

  return (
    <div className="bg-transparent px-3 py-3 text-[var(--text-primary)] sm:px-4 sm:py-4">
      <motion.div
        {...staggerTransition}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="settings-shell settings-shell-v2 flex w-full min-w-0 flex-col gap-4 rounded-xl p-0"
        data-page={page === "logs" ? "logs" : "overview"}
      >
        {page === "logs" ? (
          <LogCenter
            entries={timeline}
            loading={timelineLoading}
            onBack={() => setPage("overview")}
            onLogsCleared={() => void refreshTimeline()}
            onRefresh={() => void refreshTimeline()}
          />
        ) : (
          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <motion.div
              {...staggerTransition}
              transition={{ duration: 0.2, delay: 0.04, ease: [0.16, 1, 0.3, 1] }}
              className="settings-card rounded-xl p-5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-[var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Hook 注入</h2>
              </div>
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                仅负责上报事件；应用未启动时上报会静默失败。
              </p>
              <div className="mt-4 flex flex-col gap-3">
                {agents.map((agent, index) => {
                  const item = installStatus.find((status) => status.agent === agent);
                  return (
                    <motion.div
                      key={agent}
                      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                      animate={reduceMotion ? {} : { opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: 0.03 * index, ease: [0.16, 1, 0.3, 1] }}
                      className="settings-agent-card settings-agent-card-v2 rounded-xl p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <AgentAvatar size="sm" source={agent} />
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{agentSourceLabel(agent)}</div>
                            <div className="mt-0.5 truncate font-[var(--font-mono)] text-[10px] text-[var(--text-disabled)]">
                              {item?.path ?? "—"}
                            </div>
                          </div>
                        </div>
                        <div
                          className="status-pill shrink-0 rounded-md px-2 py-0.5 text-[10px]"
                          data-tone={installTone(item)}
                        >
                          {installLabel(item)}
                        </div>
                      </div>

                      <div className="settings-agent-actions mt-2.5 flex flex-wrap">
                        <button
                          className="settings-action-btn hook-primary-btn inline-flex items-center"
                          disabled={busy !== null || item?.injected === true}
                          onClick={() => runAgentAction("inject", injectAgentHooks, agent)}
                          type="button"
                        >
                          <Download className="h-3 w-3" aria-hidden />
                          注入
                        </button>
                        <button
                          className="settings-action-btn hook-secondary-btn inline-flex items-center"
                          disabled={busy !== null || !item?.injected}
                          onClick={() => runAgentAction("remove", removeAgentHooks, agent)}
                          type="button"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden />
                          移除
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>

            <div className="flex flex-col gap-4">
              <motion.section
                {...staggerTransition}
                transition={{ duration: 0.2, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
                className="settings-card rounded-xl p-4"
              >
                <h2 className="font-[var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">偏好</h2>
                <label className="setting-row mt-3 flex items-center justify-between gap-3 rounded-xl px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">开机自启动</div>
                    <div className="mt-0.5 text-[11px] leading-snug text-[var(--text-secondary)]">
                      登录后自动启动菜单栏监控
                    </div>
                  </div>
                  <input
                    aria-label="切换开机自启动"
                    checked={preferences.launchAtLogin}
                    className="setting-switch shrink-0"
                    onChange={(event) =>
                      void savePreferences({
                        ...preferences,
                        launchAtLogin: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                </label>
              </motion.section>

              <motion.section
                {...staggerTransition}
                transition={{ duration: 0.2, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
                className="settings-card rounded-xl p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-[var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">日志</h2>
                  <span className="font-[var(--font-mono)] text-[10px] text-[var(--text-disabled)]">{timeline.length} 条</span>
                </div>
                <button
                  className="settings-link-row log-link-row mt-3 flex w-full items-center justify-between gap-2 text-left"
                  onClick={() => setPage("logs")}
                  type="button"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">查看全部日志</span>
                      <span className="block truncate text-[11px] text-[var(--text-secondary)]">
                        筛选、查看、清空
                      </span>
                    </span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" aria-hidden />
                </button>

                <div className="mt-3 flex flex-col gap-1.5">
                  {recentTimeline.length > 0 ? (
                    recentTimeline.map((entry) => (
                      <div key={entry.id} className="timeline-preview-row rounded-lg px-2.5 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium">
                              {agentSourceLabel(
                                agents.includes(entry.source as AgentSource)
                                  ? (entry.source as AgentSource)
                                  : "codex",
                              )}{" "}
                              · {entry.kind}
                            </div>
                            <div className="truncate font-[var(--font-mono)] text-[10px] text-[var(--text-secondary)]">
                              {entry.channel === "bridge" ? `bridge / ${entry.stage}` : "hook"}
                            </div>
                          </div>
                          <div className="shrink-0 font-[var(--font-mono)] text-[10px] text-[var(--text-disabled)]">
                            {formatTime(entry.createdAt)}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--text-secondary)]">
                      暂无摘要
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
