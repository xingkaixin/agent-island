# AgentIsland - 项目指南

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Tauri 2.x |
| 前端 | React 19 + TypeScript |
| 样式 | Tailwind CSS 4 + Framer Motion |
| 状态管理 | Zustand |
| 后端 | Rust |
| IPC | Unix Domain Socket |
| 构建 | Vite + Tauri CLI |
| 包管理 | Bun |
| 测试 | Vitest + Testing Library |

## 架构

### 整体架构

```
┌─────────────┐   Hook    ┌──────────────────┐   Unix Socket   ┌─────────────┐
│  Agent CLI  │ ────────> │ agentisland-bridge│ ──────────────>  │  Tauri App  │
│ (终端运行)   │  (stdin)  │  (Rust binary)    │                  │  (Rust 后端) │
└─────────────┘           └──────────────────┘                  └──────┬──────┘
                                                                        │
                                                                   Tauri Event
                                                                        │
                                                                  ┌──────▼──────┐
                                                                  │  React 前端  │
                                                                  │  (Zustand)   │
                                                                  └─────────────┘
```

Agent 运行时通过 Hook 机制将事件通过 stdin 传递给 bridge 二进制，bridge 转发到 Tauri 后端的 Unix Socket，后端处理后将状态变更推送到前端。

### 窗口系统

- **main 窗口**: 无边框透明浮窗（420×520），跟随菜单栏图标，always-on-top，失焦自动隐藏
- **settings 窗口**: 标准窗口（1200×760），包含设置、日志中心

### 状态流

1. Agent 触发 Hook → bridge 收到 stdin JSON
2. bridge 连接 `~/.agentisland/run/agentisland.sock` 发送事件
3. Rust 后端解析事件，更新会话状态
4. 后端 emit `app-state-updated` 事件到前端
5. Zustand store 收到事件，更新 `AppStateSnapshot`
6. React 重新渲染

## 目录结构

```
agent-island/
├── src/                          # 前端源码
│   ├── components/               # React 组件
│   │   ├── AgentAvatar.tsx       # Agent 图标（按状态着色）
│   │   ├── Capsule.tsx           # 通用胶囊标签
│   │   ├── LogCenter.tsx         # 日志中心（过滤+时间线+展开详情）
│   │   ├── PermissionCard.tsx    # 权限请求卡片
│   │   ├── SessionRow.tsx        # 会话列表行
│   │   └── Settings.tsx          # 设置页面
│   ├── lib/
│   │   └── tauri.ts              # Tauri IPC 封装（invoke 调用）
│   ├── store/
│   │   └── sessions.ts           # Zustand 全局状态（sessions, logs, preferences）
│   ├── types/
│   │   └── agent.ts              # TypeScript 类型定义
│   ├── test/
│   │   └── setup.ts              # Vitest 测试配置
│   ├── App.tsx                   # 入口组件（按 window.label 分发渲染）
│   ├── main.tsx                  # React 挂载
│   └── styles.css                # 全局样式 + CSS 变量 + 动画
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── bin/
│   │   │   └── agentisland-bridge.rs  # Bridge 二进制（stdin → Unix Socket）
│   │   ├── lib.rs                # 主入口：窗口创建、菜单栏、事件监听、IPC 启动
│   │   ├── main.rs               # 程序入口
│   │   ├── ipc.rs                # Unix Socket 服务端，接收 bridge 事件
│   │   ├── session.rs            # 会话状态管理（SessionView、事件处理、状态映射）
│   │   ├── settings.rs           # 用户偏好持久化（preferences.json）
│   │   ├── notify.rs             # 系统通知逻辑
│   │   └── inject.rs             # Hook 注入/移除/恢复（Claude/Codex/Cursor）
│   ├── capabilities/
│   │   └── default.json          # Tauri 权限声明
│   ├── icons/                    # 应用图标（各尺寸）
│   ├── build.rs                  # 构建脚本
│   ├── Cargo.toml                # Rust 依赖
│   └── tauri.conf.json           # Tauri 配置（窗口、打包、bundle）
├── scripts/
│   ├── agentisland-bridge        # 编译后的 bridge 二进制
│   ├── simulate-events.ts        # 事件模拟（开发调试用）
│   └── verify-claude-hook.ts     # Hook 安装验证
├── public/
│   ├── agent-icon/               # Agent 图标资源（claude/codex/cursor）
│   └── menu-bar-icon.png         # 菜单栏图标
├── docs/
│   └── agent-island-spec.md      # 产品规格文档
├── package.json
├── vite.config.ts
├── tsconfig.json
└── postcss.config.js
```

## 模块说明

### 前端组件

| 组件 | 职责 |
|------|------|
| `App.tsx` | 根据 `window.label` 决定渲染主面板还是设置窗口 |
| `SessionRow` | 单个会话卡片，显示 Agent 类型、状态、目录、时长 |
| `AgentAvatar` | Agent 图标，根据状态（active/idle/attention/error）着色 |
| `PermissionCard` | 权限请求卡片，提示用户去终端审批 |
| `LogCenter` | 日志中心，支持按来源/事件类型/Session/时间过滤，展开查看 JSON |
| `Settings` | 设置页：Hook 管理（注入/移除/恢复）、自启动开关、日志预览 |
| `Capsule` | 通用胶囊标签组件 |

### 后端模块

| 模块 | 职责 |
|------|------|
| `lib.rs` | 应用初始化：创建菜单栏、主窗口、设置窗口，注册 Tauri 命令，启动 IPC 服务 |
| `ipc.rs` | Unix Socket 服务端，接收 bridge 发来的事件，解析后更新状态并 emit 到前端 |
| `session.rs` | 会话管理：维护活跃会话列表，根据事件类型映射状态（idle/thinking/tool/shell 等），处理超时清理 |
| `inject.rs` | Hook 管理：读取/修改/备份 Agent 配置文件，安装 bridge 二进制到 `~/.agentisland/bin/` |
| `settings.rs` | 偏好设置读写，持久化到 `preferences.json` |
| `notify.rs` | 系统通知：权限请求和需要关注时发送 macOS 通知 |
| `agentisland-bridge.rs` | 独立二进制，从 stdin 读取 JSON 事件，提取关键字段，转发到 Unix Socket |

### 数据流路径

- 事件日志: `~/.agentisland/events.jsonl`
- Bridge 诊断: `~/.agentisland/logs/bridge.log`
- 用户偏好: `~/Library/Application Support/app.agentisland.macos/preferences.json`
- IPC Socket: `~/.agentisland/run/agentisland.sock`
- Bridge 二进制: `~/.agentisland/bin/agentisland-bridge`

## 开发

```bash
bun run tauri:dev          # 启动开发模式
bun run tauri:build        # 构建生产版本
bun run test               # 运行测试
bun run test:watch         # 测试监听模式
bun run simulate:claude    # 模拟 Claude 事件
```
