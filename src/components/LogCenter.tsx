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

function toLocalDatetimeValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const [viewMode, setViewMode] = useState<"all" | "event" | "bridge">("all");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const kinds = useMemo(
    () =>
      Array.from(new Set(entries.map((entry) => entry.kind))).sort((left, right) =>
        left.localeCompare(right),
      ),
    [entries],
  );

  const rangeBounds = useMemo(() => {
    const startMs = startLocal ? new Date(startLocal).getTime() : null;
    const endMs = endLocal ? new Date(endLocal).getTime() : null;
    return { startMs, endMs };
  }, [startLocal, endLocal]);

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
        const t = new Date(entry.createdAt).getTime();
        if (rangeBounds.startMs !== null && !Number.isNaN(rangeBounds.startMs) && t < rangeBounds.startMs) {
          return false;
        }
        if (rangeBounds.endMs !== null && !Number.isNaN(rangeBounds.endMs) && t > rangeBounds.endMs) {
          return false;
        }
        return true;
      }),
    [entries, rangeBounds, selectedKinds, selectedSources, viewMode],
  );

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

  function setLast24h() {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    setStartLocal(toLocalDatetimeValue(start));
    setEndLocal(toLocalDatetimeValue(end));
  }

  function clearRange() {
    setStartLocal("");
    setEndLocal("");
  }

  async function handleClearLogs() {
    const ok1 = window.confirm("确定清空全部日志吗？包含 Hook 事件与 bridge 诊断，且不可撤销。");
    if (!ok1) {
      return;
    }
    const ok2 = window.confirm("再次确认：将删除磁盘上的事件记录。");
    if (!ok2) {
      return;
    }
    setClearing(true);
    try {
      await clearLogs();
      onLogsCleared?.();
      onRefresh();
      setExpandedId(null);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "清空失败");
    } finally {
      setClearing(false);
    }
  }

  return (
    <section className="settings-card log-center-shell rounded-[22px] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="eyebrow">Log Center</div>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em]">日志</h2>
          <p className="mt-1 max-w-[56ch] text-xs leading-5 text-[var(--text-secondary)]">
            Hook 与 bridge 合并时间线。点行展开原始内容；可按时间段缩小范围。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="secondary-button rounded-lg px-3 py-1.5 text-xs font-semibold"
            onClick={onBack}
            type="button"
          >
            返回设置
          </button>
          <button
            className="ghost-button hook-ghost-btn rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            disabled={clearing || loading}
            onClick={() => void handleClearLogs()}
            type="button"
          >
            <Trash2 className="mr-1 inline-block h-3.5 w-3.5 align-[-2px]" aria-hidden />
            清空日志
          </button>
          <button
            className="icon-button no-drag rounded-lg p-2"
            disabled={loading}
            onClick={onRefresh}
            type="button"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            <span className="sr-only">刷新</span>
          </button>
        </div>
      </div>

      <div className="log-toolbar mt-4 flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">视图</span>
          {(
            [
              ["all", "全部"],
              ["event", "Hook"],
              ["bridge", "Bridge"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className="filter-chip rounded-md px-2.5 py-1 text-[11px] font-semibold"
              data-active={viewMode === value}
              onClick={() => setViewMode(value)}
              type="button"
            >
              {label}
            </button>
          ))}
          <span className="mx-1 hidden h-4 w-px bg-[var(--line)] sm:inline-block" aria-hidden />
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Agent</span>
          <div className="flex flex-wrap gap-1">
            {agents.map((source) => (
              <button
                key={source}
                className="agent-filter-chip rounded-md px-2 py-1"
                data-active={selectedSources.includes(source)}
                onClick={() => toggleSource(source)}
                type="button"
              >
                <AgentAvatar size="sm" source={source} />
                <span className="text-[11px] font-semibold">{agentSourceLabel(source)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              时间范围
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label="开始时间"
                className="log-datetime-input rounded-md border border-[var(--line)] bg-white px-2 py-1 text-[11px]"
                onChange={(e) => setStartLocal(e.target.value)}
                type="datetime-local"
                value={startLocal}
              />
              <span className="text-[var(--text-tertiary)]">—</span>
              <input
                aria-label="结束时间"
                className="log-datetime-input rounded-md border border-[var(--line)] bg-white px-2 py-1 text-[11px]"
                onChange={(e) => setEndLocal(e.target.value)}
                type="datetime-local"
                value={endLocal}
              />
              <button
                className="rounded-md border border-[var(--line)] bg-[var(--bg-muted)] px-2 py-1 text-[11px] font-semibold text-[var(--text-secondary)]"
                onClick={setLast24h}
                type="button"
              >
                近 24h
              </button>
              <button
                className="rounded-md border border-transparent px-2 py-1 text-[11px] font-semibold text-[var(--accent-strong)]"
                onClick={clearRange}
                type="button"
              >
                清除范围
              </button>
            </div>
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] lg:pb-1">
            匹配 <span className="font-semibold tabular-nums text-[var(--text-primary)]">{filteredEntries.length}</span>{" "}
            条
          </div>
        </div>

        {kinds.length > 0 ? (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">事件 kind</div>
            <div className="mt-1.5 flex max-h-20 flex-wrap gap-0.5 overflow-y-auto">
              {kinds.map((kind) => (
                <button
                  key={kind}
                  className="log-kind-chip filter-chip min-w-0 max-w-[6.5rem] truncate rounded px-1.5 py-0 text-[9px] font-semibold leading-none"
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
      </div>

      <div className="mt-3 flex flex-col gap-1">
        {filteredEntries.length > 0 ? (
          filteredEntries.map((entry) => {
            const open = expandedId === entry.id;
            return (
              <div
                key={entry.id}
                className="log-row-compact rounded-lg border border-[var(--line)] bg-white"
              >
                <button
                  className="flex w-full items-center gap-2 px-2 py-2 text-left"
                  onClick={() => setExpandedId(open ? null : entry.id)}
                  type="button"
                >
                  {open ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" aria-hidden />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" aria-hidden />
                  )}
                  <AgentAvatar
                    size="sm"
                    source={
                      agents.includes(entry.source as AgentSource)
                        ? (entry.source as AgentSource)
                        : "codex"
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[13px] font-semibold">{entry.kind}</span>
                      <span className="shrink-0 rounded bg-[var(--bg-muted)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                        {entryStageLabel(entry)}
                      </span>
                    </div>
                    {entry.sessionId ? (
                      <div className="truncate text-[10px] text-[var(--text-secondary)]">{entry.sessionId}</div>
                    ) : null}
                  </div>
                  <time className="shrink-0 text-[10px] text-[var(--text-tertiary)]" dateTime={entry.createdAt}>
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
          <div className="rounded-lg border border-dashed border-[var(--line)] px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
            没有匹配的日志
          </div>
        )}
      </div>
    </section>
  );
}
