#!/usr/bin/env bun

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const bridgePath = join(homedir(), '.agentisland', 'bin', 'agentisland-bridge');
const cwd = process.cwd();
const scenario = process.argv[2] ?? 'full';

type HookPayload = Record<string, unknown>;

function payload(hookEventName: string, extra: HookPayload = {}) {
  return {
    hookEventName,
    sessionId: 'claude-real-hook-demo',
    cwd,
    ...extra,
  };
}

const scenarios: Record<string, HookPayload[]> = {
  running: [
    payload('SessionStart'),
    payload('UserPromptSubmit'),
    payload('PreToolUse', { toolName: 'Read' }),
    payload('PostToolUse', { toolName: 'Read' }),
  ],
  attention: [payload('Notification', { message: '需要你回到终端确认下一步' })],
  permission: [
    payload('PermissionRequest', {
      requestId: 'claude-real-hook-demo-request',
      toolName: 'Bash',
      summary: '请求执行 bun run tauri dev',
      toolArgs: { cmd: 'bun run tauri dev' },
    }),
  ],
  stop: [payload('Stop')],
  full: [
    payload('SessionStart'),
    payload('UserPromptSubmit'),
    payload('Notification', { message: '需要你回到终端确认下一步' }),
    payload('PermissionRequest', {
      requestId: 'claude-real-hook-demo-request',
      toolName: 'Bash',
      summary: '请求执行 bun run tauri dev',
      toolArgs: { cmd: 'bun run tauri dev' },
    }),
    payload('Stop'),
  ],
};

const selected = scenarios[scenario];

if (!selected) {
  console.error(`Unknown scenario: ${scenario}`);
  console.error(`Available: ${Object.keys(scenarios).join(', ')}`);
  process.exit(1);
}

for (const item of selected) {
  await runBridge(item);
}

async function runBridge(item: HookPayload) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bridgePath, ['--source', 'claude'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`bridge exited with code ${code}`));
        return;
      }
      if (stdout.trim()) {
        console.log(`[${item.hookEventName}] ${stdout.trim()}`);
      } else {
        console.log(`[${item.hookEventName}] ok`);
      }
      resolve();
    });

    child.stdin.end(JSON.stringify(item));
  });
}
