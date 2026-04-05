import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LogCenter from "./LogCenter";
import { clearLogs } from "../lib/tauri";
import type { TimelineLogEntry } from "../types/agent";

vi.mock("../lib/tauri", () => ({
  clearLogs: vi.fn(),
}));

const mockedClearLogs = vi.mocked(clearLogs);

const entries: TimelineLogEntry[] = [
  {
    id: "log-1",
    source: "codex",
    sessionId: "session-1",
    kind: "session_start",
    createdAt: "2026-04-05T10:00:00.000Z",
    channel: "event",
    raw: '{"kind":"session_start"}',
  },
];

function renderLogCenter(nextEntries: TimelineLogEntry[] = entries) {
  const onBack = vi.fn();
  const onRefresh = vi.fn();
  const onLogsCleared = vi.fn();

  render(
    <LogCenter
      entries={nextEntries}
      loading={false}
      onBack={onBack}
      onLogsCleared={onLogsCleared}
      onRefresh={onRefresh}
    />,
  );

  return { onBack, onRefresh, onLogsCleared };
}

describe("LogCenter", () => {
  beforeEach(() => {
    mockedClearLogs.mockReset();
  });

  it("点击清空后先进入确认态，不会立刻调用后端", async () => {
    const user = userEvent.setup();

    renderLogCenter();

    await user.click(screen.getByRole("button", { name: "清空日志" }));

    expect(mockedClearLogs).not.toHaveBeenCalled();
    expect(screen.getByText("确认清空日志")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认清空" })).toBeInTheDocument();
  });

  it("确认后调用清空，并触发刷新回调", async () => {
    const user = userEvent.setup();
    mockedClearLogs.mockResolvedValue(undefined);
    const { onLogsCleared, onRefresh } = renderLogCenter();

    await user.click(screen.getByRole("button", { name: "清空日志" }));
    await user.click(screen.getByRole("button", { name: "确认清空" }));

    await waitFor(() => {
      expect(mockedClearLogs).toHaveBeenCalledTimes(1);
    });
    expect(onLogsCleared).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("确认清空日志")).not.toBeInTheDocument();
  });

  it("失败时展示错误提示，并允许结束加载态", async () => {
    const user = userEvent.setup();
    mockedClearLogs.mockRejectedValue(new Error("磁盘写入失败"));

    renderLogCenter();

    await user.click(screen.getByRole("button", { name: "清空日志" }));
    await user.click(screen.getByRole("button", { name: "确认清空" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("磁盘写入失败");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "确认清空" })).toBeEnabled();
    });
  });

  it("取消后恢复初始状态", async () => {
    const user = userEvent.setup();

    renderLogCenter();

    await user.click(screen.getByRole("button", { name: "清空日志" }));
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByText("确认清空日志")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "清空日志" })).toBeInTheDocument();
    expect(mockedClearLogs).not.toHaveBeenCalled();
  });

  it("没有日志时禁用清空按钮，并提示当前没有可清理的日志", () => {
    renderLogCenter([]);

    expect(screen.getByRole("button", { name: "清空日志" })).toBeDisabled();
    expect(screen.getByText("当前没有可清理的日志。")).toBeInTheDocument();
  });

  it("有筛选条件时，确认文案明确会清空全部日志", async () => {
    const user = userEvent.setup();

    renderLogCenter();

    await user.click(screen.getByRole("button", { name: "Hook" }));
    await user.click(screen.getByRole("button", { name: "清空日志" }));

    const panel = screen.getByText("确认清空日志").closest("div");
    expect(panel).not.toBeNull();
    expect(
      within(screen.getByText("确认清空日志").closest(".log-danger-panel") as HTMLElement).getByText(
        "当前已应用筛选条件，但确认后仍会清空全部日志，不仅是当前筛选结果。",
      ),
    ).toBeInTheDocument();
  });

  it("将返回设置和日志操作放在筛选工具栏内", () => {
    renderLogCenter();

    const toolbar = screen.getByLabelText("日志筛选工具栏");
    expect(within(toolbar).getByText("日志筛选")).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "返回设置" })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "清空日志" })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "刷新" })).toBeInTheDocument();
  });
});
