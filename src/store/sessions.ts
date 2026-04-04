import { create } from "zustand";
import type {
  AppStateSnapshot,
  InstallStatusItem,
  LogEntry,
  PermissionRequestView,
  SessionView,
  UserPreferences,
} from "../types/agent";

const defaultPreferences: UserPreferences = {
  notificationsEnabled: true,
  launchAtLogin: false,
  logLimit: 100,
};

interface SessionStoreState {
  hydrated: boolean;
  sessions: SessionView[];
  permissionRequest: PermissionRequestView | null;
  installStatus: InstallStatusItem[];
  preferences: UserPreferences;
  logs: LogEntry[];
  replaceState: (state: AppStateSnapshot) => void;
  updatePreferences: (preferences: UserPreferences) => void;
}

export const useSessionStore = create<SessionStoreState>((set) => ({
  hydrated: false,
  sessions: [],
  permissionRequest: null,
  installStatus: [],
  preferences: defaultPreferences,
  logs: [],
  replaceState: (state) =>
    set({
      hydrated: true,
      sessions: state.sessions,
      permissionRequest: state.permissionRequest ?? null,
      installStatus: state.installStatus,
      preferences: state.preferences,
      logs: state.logs,
    }),
  updatePreferences: (preferences) => set({ preferences }),
}));
