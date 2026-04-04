# AgentIsland — Product Spec

## 概述

AgentIsland 是一个跨平台（macOS / Windows）的 AI Coding Agent 实时状态监控工具。它在屏幕顶部中央渲染一个常驻浮动胶囊窗口，模拟 iOS 灵动岛的视觉形态，实时展示当前所有活跃 agent session 的状态，并支持直接在胶囊内完成 permission 审批操作。

---

## 目标场景

- 同时运行多个 Claude Code / Codex / Cursor session
- 不切换窗口的情况下感知每个 agent 的当前状态
- permission 请求出现时能立即在胶囊内审批，无需回到 terminal
- session 结束或需要用户介入时有视觉提示

---

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri v2 |
| 前端 | React + Vite + TypeScript + Tailwind |
| 后端 / 系统交互 | Rust（Tauri core） |
| 进程间通信 | Unix Domain Socket（macOS）/ Named Pipe（Windows） |
| Hook 接入 | 各 agent 配置文件注入 shell 脚本 |

---

## 窗口形态

### 基本参数

```
decorations: false        // 无标题栏
always_on_top: true       // 始终置顶
transparent: true         // 窗口背景透明
resizable: false
skip_taskbar: true        // 不出现在任务栏 / Dock
```

### 位置

屏幕顶部水平居中，距顶部 0px（紧贴屏幕边缘）。

### 形态变化

| 状态 | 胶囊尺寸 | 说明 |
|---|---|---|
| 空闲（无活跃 session） | 隐藏 或 120×10 极细条 | 最小存在感 |
| 有 session 运行中 | 240×36 | 显示 agent 图标 + 状态文字 |
| 多个 session | 320×36 | 并排图标，点击展开 |
| permission 待审批 | 展开至 360×120 | 显示工具名 + approve/deny 按钮 |
| ask user（需回 terminal） | 240×36 + 脉冲动画 | 提醒用户，不可在此回答 |

所有尺寸变化使用 spring 动画过渡，模拟灵动岛展开收缩效果。

---

## 支持的 Agent 及 Hook 覆盖

### Claude Code

| Hook | 用途 |
|---|---|
| SessionStart | 创建 session 记录，胶囊出现 |
| SessionEnd | 移除 session 记录 |
| UserPromptSubmit | 状态更新为 "thinking" |
| PreToolUse | 状态更新为 "using tool: \<toolName\>" |
| PostToolUse | 状态回到 running |
| PermissionRequest | 展开胶囊，显示审批 UI，阻塞等待返回 |
| Notification | 脉冲提醒，提示用户回 terminal |
| Stop | 状态更新为 "done" |
| SubagentStart / SubagentStop | 显示子 agent 层级 |
| PreCompact | 显示 "compacting context" |

### Codex

| Hook | 用途 |
|---|---|
| SessionStart | 创建 session 记录 |
| Stop | 结束 session |
| UserPromptSubmit | 状态更新为 "thinking" |

### Cursor

| Hook | 用途 |
|---|---|
| beforeSubmitPrompt | 状态更新为 "thinking" |
| beforeShellExecution / afterShellExecution | 显示 shell 执行状态 |
| beforeMCPExecution / afterMCPExecution | 显示 MCP 工具调用状态 |
| afterFileEdit | 显示文件编辑 |
| beforeReadFile | 显示文件读取 |
| stop | 结束 session |

---

## Hook 接入机制

### Bridge 脚本

每个 agent 配置一个统一的 bridge 脚本作为 hook command：

```
~/.agentisland/bin/agentisland-bridge --source <claude|codex|cursor>
```

Bridge 脚本职责：
1. 从 stdin 读取 agent 传入的 JSON 事件
2. 附加 `--source` 标识
3. 通过 Unix Socket / Named Pipe 发送给主进程

### 自动注入

App 首次启动时提供引导流程，自动检测并注入各 agent 的配置文件：

| Agent | 配置文件路径 |
|---|---|
| Claude Code | `~/.claude/settings.json` |
| Codex | `~/.codex/hooks.json` |
| Cursor | `~/.cursor/hooks.json` |

注入前备份原始配置文件，提供还原选项。

---

## Permission 审批流程

1. Claude Code 触发 `PermissionRequest` hook，进程阻塞（timeout 86400s）
2. Bridge 脚本将事件发送给主进程
3. 胶囊展开，显示：
   - 请求来源的 session 标识
   - 工具名称（如 `Bash`, `Write File`）
   - 工具参数摘要
   - Approve / Deny 两个按钮
4. 用户点击后，主进程通过 bridge 脚本向 stdout 写入：
   ```json
   {"decision": "approve"}
   // 或
   {"decision": "deny", "reason": "user rejected"}
   ```
5. Claude Code 收到返回值，继续或中止执行
6. 胶囊收缩回正常状态

---

## 多 Session 管理

- 每个 session 用 `sessionId` 唯一标识
- 胶囊默认展示所有活跃 session 的图标（agent 类型图标）
- 点击胶囊展开 session 列表，每行显示：
  - Agent 类型
  - 当前状态
  - 运行时长
  - 工作目录（截断显示）
- 有 permission 待审批时，对应 session 高亮并优先展示

---

## 通知行为

| 事件 | 通知方式 |
|---|---|
| Permission 请求 | 胶囊展开 + 系统通知（可选） |
| Ask User（Notification hook） | 胶囊脉冲动画 + 系统通知 |
| Session 结束 | 胶囊图标消失动画 |
| 工具调用错误 | 胶囊短暂变红 |

系统通知使用 macOS `UNUserNotificationCenter` / Windows Toast，作为胶囊的补充（用户不看屏幕时兜底）。

---

## 设置面板

点击胶囊右键或长按，打开设置面板（独立窗口）：

- 已注入的 agent 列表及状态
- 手动注入 / 移除各 agent hook
- 胶囊显示位置微调（水平偏移）
- 通知开关
- 开机自启动开关
- 日志查看（最近 N 条 hook 事件原始 JSON）

---

## 平台差异

| 项目 | macOS | Windows |
|---|---|---|
| 胶囊位置 | 屏幕顶部居中（覆盖菜单栏层级） | 屏幕顶部居中（置顶浮窗） |
| 窗口层级 API | `NSWindowLevel` via objc bridge | `HWND_TOPMOST` via winapi |
| IPC | Unix Domain Socket | Named Pipe |
| 系统通知 | UNUserNotificationCenter | Windows Toast |
| 开机自启 | LaunchAgent plist | 注册表 Run key |

胶囊 UI 和所有业务逻辑平台共用，仅以上部分做平台分支。

---

## 目录结构

```
agentisland/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs           # 入口，窗口初始化
│   │   ├── ipc.rs            # Unix Socket / Named Pipe 监听
│   │   ├── session.rs        # session 状态管理
│   │   ├── permission.rs     # permission 审批逻辑
│   │   └── inject.rs         # agent 配置文件注入
│   └── tauri.conf.json
├── src/
│   ├── components/
│   │   ├── Capsule.tsx       # 胶囊主体
│   │   ├── SessionRow.tsx    # 单个 session 展示
│   │   ├── PermissionCard.tsx # permission 审批 UI
│   │   └── Settings.tsx      # 设置面板
│   ├── store/
│   │   └── sessions.ts       # Zustand session 状态
│   └── main.tsx
└── scripts/
    └── agentisland-bridge    # bridge shell 脚本
```

---

## 分发

- macOS：`.dmg` 打包，包含 bridge 脚本
- Windows：`.msi` 或 NSIS installer，包含 bridge 脚本
- 安装完成后引导用户完成 agent 配置注入

---

## 不在 v1 范围内

- Linux 支持
- Codex / Cursor 的 permission 拦截（依赖各自开放 hook）
- 云端多设备同步
- 历史 session 回放
