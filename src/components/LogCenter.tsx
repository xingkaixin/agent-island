import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { RefreshCw } from "lucide-react";
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
}

export default function LogCenter({ entries, loading, onBack, onRefresh }: LogCenterProps) {
  const reduceMotion = useReducedMotion();
  const [selectedSources, setSelectedSources] = useState<AgentSource[]>([]);
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"all" | "event" | "bridge">("all");

  const kinds = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.kind))).sort((left, right) => left.localeCompare(right)),
    [entries],
  );

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
        return true;
      }),
    [entries, selectedKinds, selectedSources, viewMode],
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

  return (
    <section className="settings-card rounded-[28px] p-6">
      <div className="section-header">
        <div>
          <div className="eyebrow">Log Center</div>
          <div className="mt-2 text-xl font-semibold tracking-[-0.02em]">日志详情</div>
        </div>
        <div className="flex items-center gap-2">
          <button className="secondary-button rounded-full px-4 py-2 text-sm font-semibold" onClick={onBack} type="button">
            返回设置
          </button>
          <button
            className="icon-button no-drag rounded-full p-2.5"
            disabled={loading}
            onClick={onRefresh}
            type="button"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
        这里按时间倒序查看 AgentIsland 已消费的 hook 事件，同时保留 bridge 诊断阶段日志，方便定位“没收到事件”和“收到了但解释错了”这两类不同问题。
      </div>

      <div className="mt-5 grid gap-4 rounded-[24px] border border-[var(--line)] bg-white/80 p-5">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            视图
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              ["all", "全部"],
              ["event", "仅 Hook 事件"],
              ["bridge", "仅 Bridge 诊断"],
            ].map(([value, label]) => (
              <button
                key={value}
                className="filter-chip rounded-full px-3 py-1.5 text-xs font-semibold"
                data-active={viewMode === value}
                onClick={() => setViewMode(value as "all" | "event" | "bridge")}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            Agent
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {agents.map((source) => (
              <button
                key={source}
                className="agent-filter-chip rounded-full px-3 py-2"
                data-active={selectedSources.includes(source)}
                onClick={() => toggleSource(source)}
                type="button"
              >
                <AgentAvatar size="sm" source={source} />
                <span className="text-sm font-semibold">{agentSourceLabel(source)}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              Hook 事件
            </div>
            <div className="text-xs text-[var(--text-secondary)]">{filteredEntries.length} 条</div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {kinds.map((kind) => (
              <button
                key={kind}
                className="filter-chip rounded-full px-3 py-1.5 text-xs font-semibold"
                data-active={selectedKinds.includes(kind)}
                onClick={() => toggleKind(kind)}
                type="button"
              >
                {kind}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {filteredEntries.length > 0 ? (
          filteredEntries.map((entry, index) => (
            <motion.div
              key={entry.id}
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={reduceMotion ? {} : { opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: 0.02 * index, ease: [0.22, 1, 0.36, 1] }}
              className="timeline-card rounded-[24px] p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <AgentAvatar size="sm" source={entry.source} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold">{entry.kind}</div>
                      <span className="rounded-full bg-[var(--bg-muted)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                        {entryStageLabel(entry)}
                      </span>
                    </div>
                    {entry.sessionId ? (
                      <div className="mt-1 text-xs text-[var(--text-secondary)]">
                        {entry.sessionId}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-[var(--text-tertiary)]">
                  {formatTime(entry.createdAt)}
                </div>
              </div>
              <pre className="log-pre mt-3 whitespace-pre-wrap break-all rounded-[18px] p-3 text-xs">
                {entry.raw}
              </pre>
            </motion.div>
          ))
        ) : (
          <div className="panel-card-soft rounded-[24px] px-4 py-10 text-center">
            <div className="text-sm font-medium">没有匹配的日志</div>
            <div className="mt-1 text-sm text-[var(--text-secondary)]">
              调整筛选条件或刷新时间线后再看。
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
