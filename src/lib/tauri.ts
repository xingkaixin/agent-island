import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  AppStateSnapshot,
  InstallStatusItem,
  LogEntry,
  UserPreferences,
} from "../types/agent";

const APP_STATE_EVENT = "app-state-updated";

export async function getCurrentWindowLabel() {
  const currentWindow = getCurrentWindow();
  return currentWindow.label;
}

export function onAppStateUpdated(handler: (state: AppStateSnapshot) => void) {
  return listen<AppStateSnapshot>(APP_STATE_EVENT, (event) => {
    handler(event.payload);
  });
}

export async function getAppState() {
  return invoke<AppStateSnapshot>("get_app_state");
}

export async function openSettingsWindow() {
  return invoke("open_settings_window");
}

export async function getInstallStatus() {
  return invoke<InstallStatusItem[]>("get_install_status");
}

export async function injectAgentHooks(agent: string) {
  return invoke("inject_agent_hooks", { agent });
}

export async function removeAgentHooks(agent: string) {
  return invoke("remove_agent_hooks", { agent });
}

export async function restoreAgentBackup(agent: string) {
  return invoke("restore_agent_backup", { agent });
}

export async function setUserPreferences(preferences: UserPreferences) {
  return invoke("set_user_preferences", { preferences });
}

export async function getRecentLogs(limit: number) {
  return invoke<LogEntry[]>("get_recent_logs", { limit });
}
