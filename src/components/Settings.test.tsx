import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import Settings from './Settings';
import { useSessionStore } from '../store/sessions';
import type { AppStateSnapshot, InstallStatusItem, TimelineLogEntry } from '../types/agent';

const mockedTauri = vi.hoisted(() => ({
  getAppState: vi.fn<() => Promise<AppStateSnapshot>>(),
  getInstallStatus: vi.fn<() => Promise<InstallStatusItem[]>>(),
  getLogTimeline: vi.fn<() => Promise<TimelineLogEntry[]>>(),
  injectAgentHooks: vi.fn<(agent: string) => Promise<void>>(),
  removeAgentHooks: vi.fn<(agent: string) => Promise<void>>(),
  setUserPreferences: vi.fn<() => Promise<void>>(),
}));

vi.mock('../lib/tauri', () => mockedTauri);

vi.mock('framer-motion', async () => {
  const React = await import('react');

  return {
    motion: {
      div: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
        ({ children, ...props }, ref) => (
          <div ref={ref} {...props}>
            {children}
          </div>
        ),
      ),
      section: React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
        ({ children, ...props }, ref) => (
          <section ref={ref} {...props}>
            {children}
          </section>
        ),
      ),
    },
    useReducedMotion: () => true,
  };
});

const appState: AppStateSnapshot = {
  sessions: [],
  permissionRequest: null,
  installStatus: [],
  preferences: {
    notificationsEnabled: false,
    launchAtLogin: false,
    logLimit: 100,
  },
  logs: [],
};

const installStatus: InstallStatusItem[] = [
  {
    agent: 'claude',
    path: '/Users/Kevin/.claude/settings.json',
    exists: true,
    injected: true,
  },
  {
    agent: 'codex',
    path: '/Users/Kevin/.codex/hooks.json',
    exists: true,
    injected: true,
  },
  {
    agent: 'cursor',
    path: '/Users/Kevin/.cursor/hooks.json',
    exists: true,
    injected: true,
  },
];

function resetStore() {
  useSessionStore.setState({
    hydrated: false,
    sessions: [],
    permissionRequest: null,
    installStatus: [],
    preferences: {
      notificationsEnabled: false,
      launchAtLogin: false,
      logLimit: 100,
    },
    logs: [],
  });
}

describe('Settings', () => {
  beforeEach(() => {
    resetStore();
    mockedTauri.getAppState.mockReset();
    mockedTauri.getInstallStatus.mockReset();
    mockedTauri.getLogTimeline.mockReset();
    mockedTauri.injectAgentHooks.mockReset();
    mockedTauri.removeAgentHooks.mockReset();
    mockedTauri.setUserPreferences.mockReset();

    mockedTauri.getAppState.mockResolvedValue(appState);
    mockedTauri.getInstallStatus.mockResolvedValue(installStatus);
    mockedTauri.getLogTimeline.mockResolvedValue([]);
    mockedTauri.injectAgentHooks.mockResolvedValue(undefined);
    mockedTauri.removeAgentHooks.mockResolvedValue(undefined);
    mockedTauri.setUserPreferences.mockResolvedValue(undefined);
  });

  it('已注入时保留禁用语义，但注入按钮文本仍可见', async () => {
    render(<Settings />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: '注入' })).toHaveLength(3);
    });

    const cards = screen.getAllByText('已注入');
    expect(cards).toHaveLength(3);

    for (const status of cards) {
      const card = status.closest('.settings-agent-card');
      expect(card).not.toBeNull();
      expect(within(card as HTMLElement).getByRole('button', { name: '注入' })).toBeDisabled();
      expect(within(card as HTMLElement).getByRole('button', { name: '移除' })).toBeEnabled();
    }
  });

  it('设置页按钮禁用态不再通过整体 opacity 压暗文本', async () => {
    const stylesheet = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(stylesheet).toContain('.settings-action-btn:disabled');
    expect(stylesheet).not.toMatch(
      /\.settings-action-btn:disabled\s*\{[^}]*opacity:\s*0\.4;[^}]*\}/,
    );
  });
});
