export type AgentSource = 'claude' | 'codex' | 'cursor';

export type SessionStatus =
  | 'idle'
  | 'running'
  | 'thinking'
  | 'tool'
  | 'shell'
  | 'mcp'
  | 'file'
  | 'compact'
  | 'permission'
  | 'attention'
  | 'done'
  | 'error';

export interface PermissionDecisionPayload {
  decision: 'approve' | 'deny';
  reason?: string | null;
}

export interface LauncherView {
  name: string;
  iconDataUrl?: string | null;
  bundlePath?: string | null;
}

export interface PermissionRequestView {
  requestId: string;
  sessionId: string;
  source: AgentSource;
  toolName: string;
  summary: string;
  rawArgsPreview?: string | null;
  createdAt: string;
}

export interface SessionView {
  id: string;
  source: AgentSource;
  title: string;
  status: SessionStatus;
  statusDetail: string;
  cwd?: string | null;
  startedAt: string;
  durationMs: number;
  hasPendingPermission: boolean;
  needsUserAttention: boolean;
  subagentCount: number;
  launcher?: LauncherView | null;
}

export interface InstallStatusItem {
  agent: AgentSource;
  path: string;
  exists: boolean;
  injected: boolean;
  backupPath?: string | null;
  lastSeenAt?: string | null;
  lastSeenKind?: string | null;
  lastSeenWorkspace?: string | null;
}

export interface UserPreferences {
  notificationsEnabled: boolean;
  launchAtLogin: boolean;
  logLimit: number;
}

export interface LogEntry {
  id: string;
  source: AgentSource;
  sessionId?: string | null;
  kind: string;
  createdAt: string;
  raw: string;
}

export interface TimelineLogEntry {
  id: string;
  source: AgentSource;
  sessionId?: string | null;
  kind: string;
  createdAt: string;
  channel: 'event' | 'bridge';
  stage?: string | null;
  raw: string;
}

export interface AppStateSnapshot {
  sessions: SessionView[];
  permissionRequest?: PermissionRequestView | null;
  installStatus: InstallStatusItem[];
  preferences: UserPreferences;
  logs: LogEntry[];
}
