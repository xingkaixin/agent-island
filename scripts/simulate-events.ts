#!/usr/bin/env bun

import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

type Source = 'claude' | 'codex' | 'cursor';

interface EventSpec {
  source: Source;
  sessionId: string;
  kind: string;
  payload: Record<string, unknown>;
}

const cwd = process.cwd();
const scenario = process.argv[2] ?? 'claude';
const socketPath = join(homedir(), '.agentisland', 'run', 'agentisland.sock');

function event(
  source: Source,
  sessionId: string,
  kind: string,
  payload: Record<string, unknown> = {},
): EventSpec {
  return {
    source,
    sessionId,
    kind,
    payload,
  };
}

function claudeRunning(sessionId: string) {
  return [
    event('claude', sessionId, 'SessionStart', { cwd }),
    event('claude', sessionId, 'UserPromptSubmit', { cwd }),
    event('claude', sessionId, 'PreToolUse', {
      cwd,
      toolName: 'Read',
    }),
    event('claude', sessionId, 'PostToolUse', {
      cwd,
      toolName: 'Read',
    }),
  ];
}

function codexRunning(sessionId: string) {
  return [
    event('codex', sessionId, 'SessionStart', { cwd }),
    event('codex', sessionId, 'UserPromptSubmit', { cwd }),
    event('codex', sessionId, 'beforeShellExecution', { cwd }),
    event('codex', sessionId, 'afterShellExecution', { cwd }),
  ];
}

function cursorRunning(sessionId: string) {
  return [
    event('cursor', sessionId, 'beforeSubmitPrompt', { cwd }),
    event('cursor', sessionId, 'beforeReadFile', { cwd, path: 'src/App.tsx' }),
    event('cursor', sessionId, 'afterFileEdit', { cwd, path: 'src/App.tsx' }),
  ];
}

function codexPermission(sessionId: string) {
  return [
    event('codex', sessionId, 'beforeShellExecution', {
      cwd,
      command: 'bun run tauri dev',
    }),
    event('codex', sessionId, 'PermissionRequest', {
      cwd,
      toolName: 'Bash',
      summary: '请求执行 bun run tauri dev',
      toolArgs: { cmd: 'bun run tauri dev' },
    }),
  ];
}

function claudePermission(sessionId: string) {
  return [
    event('claude', sessionId, 'PreToolUse', {
      cwd,
      toolName: 'Bash',
    }),
    event('claude', sessionId, 'PermissionRequest', {
      cwd,
      toolName: 'Bash',
      summary: '请求执行 bun run tauri dev',
      toolArgs: { cmd: 'bun run tauri dev' },
    }),
  ];
}

function stopSession(source: Source, sessionId: string) {
  const stopKind = source === 'cursor' ? 'stop' : 'Stop';
  return event(source, sessionId, stopKind, {});
}

const legacySingleScenarios: Record<string, EventSpec[]> = {
  claude: [...claudeRunning('claude-demo'), ...claudePermission('claude-demo')],
  codex: [...codexRunning('codex-demo'), stopSession('codex', 'codex-demo')],
  cursor: [...cursorRunning('cursor-demo'), stopSession('cursor', 'cursor-demo')],
};

const mixedRunningSessions = {
  claude: ['claude-demo-1', 'claude-demo-2', 'claude-demo-3'],
  codex: ['codex-demo-1'],
  cursor: ['cursor-demo-1'],
} as const;

function buildMixedRunningScenario() {
  return [
    ...mixedRunningSessions.claude.flatMap((sessionId) => claudeRunning(sessionId)),
    ...mixedRunningSessions.codex.flatMap((sessionId) => codexRunning(sessionId)),
    ...mixedRunningSessions.cursor.flatMap((sessionId) => cursorRunning(sessionId)),
  ];
}

function buildMixedPermissionScenario() {
  return [...buildMixedRunningScenario(), ...codexPermission('codex-demo-1')];
}

function buildClearScenario() {
  return [
    ...mixedRunningSessions.claude.map((sessionId) => stopSession('claude', sessionId)),
    ...mixedRunningSessions.codex.map((sessionId) => stopSession('codex', sessionId)),
    ...mixedRunningSessions.cursor.map((sessionId) => stopSession('cursor', sessionId)),
    stopSession('claude', 'claude-demo'),
    stopSession('codex', 'codex-demo'),
    stopSession('cursor', 'cursor-demo'),
  ];
}

const scenarios: Record<string, EventSpec[]> = {
  ...legacySingleScenarios,
  'mixed-running': buildMixedRunningScenario(),
  'mixed-permission': buildMixedPermissionScenario(),
  clear: buildClearScenario(),
};

async function send(spec: EventSpec) {
  return new Promise<void>((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.on('connect', () => {
      socket.end(
        JSON.stringify({
          event: {
            ...spec,
            timestamp: new Date().toISOString(),
          },
        }),
      );
    });
    socket.on('data', (data) => {
      const response = JSON.parse(data.toString('utf8'));
      if (response.decision) {
        console.log(`[${spec.sessionId}] ${response.decision.decision}`);
      }
    });
    socket.on('end', resolve);
    socket.on('error', (error) => {
      if ('code' in error && error.code === 'ENOENT') {
        reject(
          new Error(
            `AgentIsland 未启动，找不到 socket: ${socketPath}\n请先启动菜单栏应用，再执行模拟脚本。`,
          ),
        );
        return;
      }
      reject(error);
    });
  });
}

const selected = scenarios[scenario];

if (!selected) {
  console.error(`Unknown scenario: ${scenario}`);
  console.error(`Available: ${Object.keys(scenarios).join(', ')}`);
  process.exit(1);
}

for (const item of selected) {
  await send(item);
}
