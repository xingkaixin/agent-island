# 会话栏 Hook 显示清单

这份清单只描述当前代码里“会进入会话栏三行预览”的 hook 显示规则，不讨论日志中心，也不讨论未来可能支持但目前没有注入的 hook。

结论先说：

- 会话栏三行预览来自 `session.recentHooks`
- 只要某个 hook 能提取出预览文本，就会进入 `recentHooks`
- `recentHooks` 内部是“最新在前”，但 UI 渲染时会倒过来显示，所以视觉上是“最上面最旧，最下面最新”
- 图标不是按 agent 判，而是按 `role` 判：
  - `user` = human / 我
  - `assistant` = bot / 你
  - `system` = 系统事件
- 当前实际注入的 hook 来源以 [`src-tauri/src/inject.rs`](/Users/Kevin/workspace/projects/personal/agent-island/src-tauri/src/inject.rs) 为准

## 统一显示规则

### 1. role 判定

会话栏当前用的不是 `human` / `bot` 字段，而是内部 `role`：

| 判定结果 | 会话栏含义 | 判定条件 |
|---|---|---|
| `user` | human / 我 | `kind` 是 `UserPromptSubmit`、`prompt_submit`、`beforeSubmitPrompt` |
| `assistant` | bot / 你 | payload 里有 `last_assistant_message`，或 `kind` 是 `afterAgentResponse` |
| `system` | 系统 | 其他所有情况 |

### 2. 文案提取优先级

每条 hook 的预览文案 `text` 统一按下面顺序取第一个非空值：

1. `payload.prompt`
2. `payload.last_assistant_message`
3. `payload.message`
4. `payload.summary`
5. `payload.title`
6. `payload.tool_input.questions[0]`
7. 权限摘要拼装
8. `payload.tool_input.command` / `cmd`
9. `payload.tool_input.file_path` / `filePath` / `path`
10. `payload.tool_input.description`
11. `payload.toolName` / `tool_name` / `tool`
12. 兜底固定文案

补充：

- 文本会把换行压成空格
- 如果最终拿不到文本，这条 hook 不会显示在会话栏

## 当前实际注入的 Hook

### Claude

当前注入事件：

- `Notification`
- `PermissionRequest`
- `PostToolUse`
- `PreCompact`
- `PreToolUse`
- `SessionEnd`
- `SessionStart`
- `Stop`
- `SubagentStart`
- `SubagentStop`
- `UserPromptSubmit`

### Codex

当前注入事件：

- `SessionStart`
- `Stop`
- `UserPromptSubmit`

说明：代码里能处理 `beforeShellExecution`、`afterShellExecution`、`PermissionRequest` 等事件，但当前注入配置没有把这些 hook 接上，所以“当前实际会显示”不包括它们。

### Cursor

当前注入事件：

- `afterAgentResponse`
- `afterAgentThought`
- `afterFileEdit`
- `afterMCPExecution`
- `afterShellExecution`
- `beforeMCPExecution`
- `beforeReadFile`
- `beforeShellExecution`
- `beforeSubmitPrompt`
- `stop`

## 按 Hook 类型展开

下面按“当前实际注入”的 hook 来列，会话栏里每条预览会显示成什么，role 会被判成什么，以及文案实际从哪里取。

### Claude

| Hook 类型 | 会显示吗 | role 判定 | human / bot 判定 | 文案 key 类型 | 当前使用的 key 路径 | 备注 |
|---|---|---|---|---|---|---|
| `SessionStart` | 通常不显示 | `system` | 系统 | 无 | 无 | 默认拿不到任何预览文本，所以一般不会进入会话栏 |
| `SessionEnd` | 通常不显示 | `system` | 系统 | 无 | 无 | 同上 |
| `Stop` | 通常不显示 | `system` | 系统 | 无 | 无 | 当前 `preview_text` 不会给 `Stop` 生成默认文案 |
| `UserPromptSubmit` | 会显示 | `user` | human / 我 | 直接字段 | `payload.prompt` | 当前唯一明确判成 human 的 Claude hook |
| `PreToolUse` | 条件显示 | `system` | 系统 | 工具名兜底 | `payload.toolName` / `payload.tool_name` / `payload.tool` | 如果没有更高优先级字段，通常显示工具名，如 `Read`、`Bash` |
| `PostToolUse` | 条件显示 | `system` | 系统 | 工具名兜底 | `payload.toolName` / `payload.tool_name` / `payload.tool` | 行为与 `PreToolUse` 基本一致 |
| `PreCompact` | 通常不显示 | `system` | 系统 | 无 | 无 | 当前没有为它准备默认文案 |
| `SubagentStart` | 通常不显示 | `system` | 系统 | 无 | 无 | 当前没有为它准备默认文案 |
| `SubagentStop` | 通常不显示 | `system` | 系统 | 无 | 无 | 当前没有为它准备默认文案 |
| `Notification` | 基本会显示 | `system` | 系统 | 通知文本 | `payload.message`，其次 `payload.summary`，再其次 `payload.title` | 如果这些都没有，则兜底为 `Notification` |
| `PermissionRequest` | 基本会显示 | `system` | 系统 | 摘要字段 / 问题 / 权限摘要 | 优先 `payload.message` / `payload.summary` / `payload.title`；否则 `payload.tool_input.questions[0].question`；否则权限摘要拼装 | 当前不会被判成 human，也不会被判成 bot，而是 system |

### Codex

| Hook 类型 | 会显示吗 | role 判定 | human / bot 判定 | 文案 key 类型 | 当前使用的 key 路径 | 备注 |
|---|---|---|---|---|---|---|
| `SessionStart` | 通常不显示 | `system` | 系统 | 无 | 无 | 默认拿不到预览文本 |
| `Stop` | 通常不显示 | `system` | 系统 | 无 | 无 | 当前 `preview_text` 不会给 `Stop` 生成默认文案 |
| `UserPromptSubmit` | 会显示 | `user` | human / 我 | 直接字段 | `payload.prompt` | 当前唯一明确判成 human 的 Codex hook |

### Cursor

| Hook 类型 | 会显示吗 | role 判定 | human / bot 判定 | 文案 key 类型 | 当前使用的 key 路径 | 备注 |
|---|---|---|---|---|---|---|
| `beforeSubmitPrompt` | 会显示 | `user` | human / 我 | 直接字段 | `payload.prompt` | 当前唯一明确判成 human 的 Cursor hook |
| `beforeShellExecution` | 条件显示 | `system` | 系统 | 命令/路径/描述 | 优先 `payload.tool_input.command` / `cmd`；否则 `payload.tool_input.file_path` / `filePath` / `path`；否则 `payload.tool_input.description`；最后才退到工具名 | 如果 payload 里没有这些字段，则大概率不显示 |
| `afterShellExecution` | 条件显示 | `system` | 系统 | 同上 | 同上 | 同上 |
| `beforeMCPExecution` | 条件显示 | `system` | 系统 | 命令/路径/描述 | 同上 | 取决于实际 hook payload 结构 |
| `afterMCPExecution` | 条件显示 | `system` | 系统 | 命令/路径/描述 | 同上 | 同上 |
| `beforeReadFile` | 条件显示 | `system` | 系统 | 路径 | 优先 `payload.tool_input.file_path` / `filePath` / `path` | 如果 Cursor 直接把 `path` 放在 payload 根部而不是 `tool_input`，当前代码拿不到 |
| `afterFileEdit` | 条件显示 | `system` | 系统 | 路径 | 优先 `payload.tool_input.file_path` / `filePath` / `path` | 同上 |
| `afterAgentThought` | 通常不显示 | `system` | 系统 | 无 | 无 | 当前没有默认文案，也没有专门读取 thought 内容 |
| `afterAgentResponse` | 条件显示 | `assistant` | bot / 你 | assistant 文本 | `payload.last_assistant_message` | 当前唯一明确判成 bot 的 hook；如果没有该字段，当前不会自动生成默认文案，所以可能完全不显示 |
| `stop` | 通常不显示 | `system` | 系统 | 无 | 无 | 当前 `preview_text` 不会给 `stop` 生成默认文案 |

## 当前归类上的关键事实

这部分是为了方便你后面直接挑问题，不是建议方案。

### 1. 现在“我 / 你”判定非常窄

只有下面这些会被当成 human / bot：

- human / 我：
  - `UserPromptSubmit`
  - `prompt_submit`
  - `beforeSubmitPrompt`
- bot / 你：
  - `afterAgentResponse`
  - 或任何带 `payload.last_assistant_message` 的事件

除此之外，包括：

- `PermissionRequest`
- `Notification`
- `PreToolUse`
- `PostToolUse`
- `beforeShellExecution`
- `beforeReadFile`
- `afterFileEdit`

现在全部都会落到 `system`。

### 2. 现在不少 hook 是否显示，取决于 payload 形状，不取决于 kind

也就是说，很多 hook 虽然“接到了”，但如果 payload 没带当前代码识别的 key，就不会在会话栏出现。

尤其是 Cursor 这几个风险最大：

- `beforeReadFile`
- `afterFileEdit`
- `beforeShellExecution`
- `afterShellExecution`
- `beforeMCPExecution`
- `afterMCPExecution`

因为当前预览提取主要看 `tool_input.*`，但模拟脚本里很多例子是把 `path`、`command` 直接放在 payload 根部。

### 3. 当前会稳定显示的 hook，主要只有这几类

- Prompt 提交类：前提是有 `payload.prompt`
- Assistant 回复类：前提是有 `payload.last_assistant_message`
- Notification / PermissionRequest：前提是有 `message` / `summary` / `title`，否则走部分兜底
- Stop：当前默认不会稳定显示
- Tool 类：前提是有可识别的工具名或 `tool_input`

## 代码依据

- Hook 注入列表：[`src-tauri/src/inject.rs`](/Users/Kevin/workspace/projects/personal/agent-island/src-tauri/src/inject.rs)
- 会话状态与 recent hooks 写入：[`src-tauri/src/session.rs`](/Users/Kevin/workspace/projects/personal/agent-island/src-tauri/src/session.rs)
- 会话栏 UI：[`src/components/SessionRow.tsx`](/Users/Kevin/workspace/projects/personal/agent-island/src/components/SessionRow.tsx)
- 类型定义：[`src/types/agent.ts`](/Users/Kevin/workspace/projects/personal/agent-island/src/types/agent.ts)
