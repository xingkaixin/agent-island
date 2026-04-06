import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Trash2 } from "lucide-react";
import { clearLogs } from "../lib/tauri";
import type { AgentSource, TimelineLogEntry } from "../types/agent";
import AgentAvatar, { agentSourceLabel } from "./AgentAvatar";

const agents: AgentSource[] = ["claude", "codex", "cursor"];

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function entryStageLabel(entry: TimelineLogEntry) {
  if (entry.channel === "bridge") {
    return entry.stage ? `bridge / ${entry.stage}` : "bridge";
  }
  return "hook";
}

interface LogCenterProps {
  entries: TimelineLogEntry[];
  loading: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onLogsCleared?: () => void;
}

export default function LogCenter({
  entries,
  loading,
  onBack,
  onRefresh,
  onLogsCleared,
}: LogCenterProps) {
  const [selectedSources, setSelectedSources] = useState<AgentSource[]>([]);
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"all" | "event" | "bridge">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const kinds = useMemo(
    () =>
      Array.from(new Set(entries.map((entry) => entry.kind))).sort((left, right) =>
        left.localeCompare(right),
      ),
    [entries],
  );

  const sessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of entries) {
      if (entry.sessionId) {
        ids.add(entry.sessionId);
      }
    }
    return Array.from(ids).sort((left, right) => left.localeCompare(right));
  }, [entries]);

  const filteredEntries = useMemo(
    () =>
      entries.filter((entry) => {
        if (viewMode !== "all" && entry.channel !== viewMode) {
          return false;
        }
        if (selectedSources.length > 0 && !selectedSources.includes(entry.source)) {
          return false;
        }
        if (selectedKinds.length > 0 && !selectedKinds.includes(entry.kind)) {
          return false;
        }
        if (
          selectedSessionIds.length > 0 &&
          (!entry.sessionId || !selectedSessionIds.includes(entry.sessionId))
        ) {
          return false;
        }
        return true;
      }),
    [entries, selectedKinds, selectedSessionIds, selectedSources, viewMode],
  );
  const hasAnyLogs = entries.length > 0;
  const hasActiveFilters =
    viewMode !== "all" ||
    selectedSources.length > 0 ||
    selectedKinds.length > 0 ||
    selectedSessionIds.length > 0;

  function toggleSource(source: AgentSource) {
    setSelectedSources((current) =>
      current.includes(source) ? current.filter((item) => item !== source) : [...current, source],
    );
  }

  function toggleKind(kind: string) {
    setSelectedKinds((current) =>
      current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind],
    );
  }

  function toggleSessionId(sessionId: string) {
    setSelectedSessionIds((current) =>
      current.includes(sessionId)
        ? current.filter((item) => item !== sessionId)
        : [...current, sessionId],
    );
  }

  function requestClearLogs() {
    if (clearing || loading || !hasAnyLogs) {
      return;
    }
    setClearError(null);
    setConfirmingClear(true);
  }

  function cancelClearLogs() {
    if (clearing) {
      return;
    }
    setConfirmingClear(false);
    setClearError(null);
  }

  async function handleConfirmClearLogs() {
    setClearing(true);
    try {
      await clearLogs();
      setConfirmingClear(false);
      setClearError(null);
      onLogsCleared?.();
      onRefresh();
      setExpandedId(null);
    } catch (e) {
      setClearError(e instanceof Error ? e.message : "清空失败");
    } finally {
      setClearing(false);
    }
  }

  return (
    <section className="settings-card log-center-shell w-full rounded-xl p-4 sm:p-5">
      {!hasAnyLogs ? (
        <div className="log-empty-note mt-4 rounded-lg border px-3 py-2 text-xs text-[var(--text-secondary)]">
          当前没有可清理的日志。
        </div>
      ) : null}

      {confirmingClear ? (
        <div className="log-danger-panel mt-4 rounded-xl border px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-[var(--font-mono)] text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--accent)]">确认清空日志</div>
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                会删除 Hook 事件与 bridge 诊断，并清空磁盘上的事件记录。这个操作不可撤销。
              </p>
              {hasActiveFilters ? (
                <p className="mt-1 text-xs leading-5 text-[var(--accent)]">
                  当前已应用筛选条件，但确认后仍会清空全部日志，不仅是当前筛选结果。
                </p>
              ) : null}
            </div>
            <div className="log-confirm-actions flex shrink-0 items-center">
              <button
                className="log-toolbar-btn secondary-button disabled:opacity-40"
                disabled={clearing}
                onClick={cancelClearLogs}
                type="button"
              >
                取消
              </button>
              <button
                className="log-toolbar-btn log-toolbar-btn-danger ghost-button disabled:opacity-40"
                disabled={clearing}
                onClick={() => void handleConfirmClearLogs()}
                type="button"
              >
                {clearing ? "清空中..." : "确认清空"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {clearError ? (
        <div className="log-error-banner mt-3 rounded-lg border px-3 py-2 text-xs" role="alert">
          {clearError}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-3" aria-label="日志筛选工具栏">
        <div className="log-toolbar-row flex flex-col gap-3">
          <div className="log-toolbar-top flex flex-wrap items-center justify-between gap-3">
            <div className="log-toolbar-summary flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="log-toolbar-label">日志筛选</span>
              <div className="log-match-count text-[11px] text-[var(--text-secondary)]">
                匹配{" "}
                <span className="font-[var(--font-mono)] font-bold tabular-nums text-[var(--text-primary)]">
                  {filteredEntries.length}
                </span>{" "}
                条
              </div>
            </div>
            <div className="log-toolbar-actions flex flex-wrap items-center justify-end gap-2">
              <button
                className="log-toolbar-btn secondary-button"
                onClick={onBack}
                type="button"
              >
                返回设置
              </button>
              <button
                className="log-toolbar-btn log-toolbar-btn-danger ghost-button hook-ghost-btn disabled:opacity-40"
                disabled={clearing || loading || !hasAnyLogs}
                onClick={requestClearLogs}
                title={!hasAnyLogs ? "当前没有可清理的日志" : undefined}
                type="button"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {confirmingClear ? "等待确认" : "清空日志"}
              </button>
              <button
                className="log-toolbar-icon-btn icon-button no-drag"
                disabled={loading}
                onClick={onRefresh}
                type="button"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
                <span className="sr-only">刷新</span>
              </button>
            </div>
          </div>
          <div className="log-filter-stack flex min-w-0 flex-1 flex-col gap-3">
            <div className="log-filter-group flex flex-wrap items-center">
              <span className="log-toolbar-label">视图</span>
              <div className="log-segmented-control" role="group" aria-label="视图筛选">
                {(
                  [
                    ["all", "全部"],
                    ["event", "Hook"],
                    ["bridge", "Bridge"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className="filter-chip log-segmented-chip"
                    data-active={viewMode === value}
                    onClick={() => setViewMode(value)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="log-filter-group flex flex-wrap items-center">
              <span className="log-toolbar-label">Agent</span>
              <div className="log-chip-wrap flex flex-wrap">
                {agents.map((source) => (
                  <button
                    key={source}
                    className="agent-filter-chip log-agent-chip"
                    data-active={selectedSources.includes(source)}
                    onClick={() => toggleSource(source)}
                    type="button"
                  >
                    <AgentAvatar size="sm" source={source} />
                    <span className="text-[11px] font-medium">{agentSourceLabel(source)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {kinds.length > 0 ? (
          <div className="log-filter-block">
            <div className="log-toolbar-label">事件 kind</div>
            <div className="log-chip-wrap log-chip-scroll mt-2 flex max-h-24 flex-wrap overflow-y-auto">
              {kinds.map((kind) => (
                <button
                  key={kind}
                  className="log-kind-chip filter-chip log-dense-chip max-w-full text-left"
                  data-active={selectedKinds.includes(kind)}
                  onClick={() => toggleKind(kind)}
                  title={kind}
                  type="button"
                >
                  {kind}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {sessionIds.length > 0 ? (
          <div className="log-filter-block">
            <div className="log-toolbar-label">会话</div>
            <div className="log-chip-wrap log-chip-scroll mt-2 flex max-h-24 flex-wrap overflow-y-auto">
              {sessionIds.map((sessionId) => (
                <button
                  key={sessionId}
                  className="log-session-chip filter-chip log-dense-chip max-w-full text-left font-[var(--font-mono)]"
                  data-active={selectedSessionIds.includes(sessionId)}
                  onClick={() => toggleSessionId(sessionId)}
                  title={sessionId}
                  type="button"
                >
                  {sessionId}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-col gap-1">
        {filteredEntries.length > 0 ? (
          filteredEntries.map((entry) => {
            const open = expandedId === entry.id;
            return (
              <div
                key={entry.id}
                className="log-row-compact rounded-lg border border-[var(--border)] bg-[var(--surface)]"
              >
                <button
                  className="flex w-full items-start gap-2 px-2 py-2 text-left"
                  onClick={() => setExpandedId(open ? null : entry.id)}
                  type="button"
                >
                  {open ? (
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden />
                  ) : (
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden />
                  )}
                  <div className="mt-0.5 shrink-0">
                    <AgentAvatar
                      size="sm"
                      source={
                        agents.includes(entry.source as AgentSource)
                          ? (entry.source as AgentSource)
                          : "codex"
                      }
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start gap-1.5">
                      <span className="min-w-0 text-[11px] font-medium leading-snug break-all whitespace-normal">
                        {entry.kind}
                      </span>
                      <span className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 font-[var(--font-mono)] text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                        {entryStageLabel(entry)}
                      </span>
                    </div>
                    {entry.sessionId ? (
                      <div className="mt-0.5 font-[var(--font-mono)] text-[9px] leading-snug break-all text-[var(--text-secondary)]">
                        {entry.sessionId}
                      </div>
                    ) : null}
                  </div>
                  <time
                    className="mt-0.5 shrink-0 font-[var(--font-mono)] text-[10px] text-[var(--text-disabled)]"
                    dateTime={entry.createdAt}
                  >
                    {formatTime(entry.createdAt)}
                  </time>
                </button>
                {open ? (
                  <pre className="log-pre mx-2 mb-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md p-2 text-[10px] leading-relaxed">
                    {entry.raw}
                  </pre>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
            没有匹配的日志
          </div>
        )}
      </div>
    </section>
  );
}
