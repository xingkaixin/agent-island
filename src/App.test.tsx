import { render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import type { AppStateSnapshot } from './types/agent';

const mockedTauri = vi.hoisted(() => ({
  getAppState: vi.fn<() => Promise<AppStateSnapshot>>(),
  getCurrentWindowLabel: vi.fn<() => Promise<string>>(),
  onAppStateUpdated: vi.fn<() => Promise<() => void>>(),
  openSettingsWindow: vi.fn<() => Promise<void>>(),
  quitApp: vi.fn<() => Promise<void>>(),
}));

vi.mock('./lib/tauri', () => mockedTauri);

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    hide: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    onFocusChanged: vi.fn<
      (listener: ({ payload }: { payload: boolean }) => void) => Promise<() => void>
    >(() => Promise.resolve(() => {})),
  }),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  function omitMotionProps<T extends Record<string, unknown>>(props: T) {
    const { initial: _initial, animate: _animate, transition: _transition, ...rest } = props;
    return rest;
  }

  return {
    motion: {
      div: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
        ({ children, ...props }, ref) => (
          <div ref={ref} {...omitMotionProps(props)}>
            {children}
          </div>
        ),
      ),
      section: React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
        ({ children, ...props }, ref) => (
          <section ref={ref} {...omitMotionProps(props)}>
            {children}
          </section>
        ),
      ),
    },
    useReducedMotion: () => true,
  };
});

vi.mock('./components/SessionStatusSprite', () => ({
  default: () => <div data-testid="session-status-sprite" />,
}));

const state: AppStateSnapshot = {
  permissionRequest: null,
  installStatus: [],
  preferences: {
    notificationsEnabled: false,
    launchAtLogin: false,
    logLimit: 100,
  },
  logs: [],
  sessions: [
    {
      id: 'claude-1',
      source: 'claude',
      title: 'claude session',
      status: 'thinking',
      statusDetail: 'thinking',
      cwd: '/tmp/alpha',
      startedAt: '2026-04-08T10:00:00.000Z',
      durationMs: 1000,
      hasPendingPermission: false,
      needsUserAttention: false,
      subagentCount: 0,
      launcher: {
        name: 'Ghostty',
        iconDataUrl: null,
        bundlePath: '/Applications/Ghostty.app',
        pid: 1,
        detectedFrom: 'processTree',
      },
      recentHooks: [{ kind: 'UserPromptSubmit', role: 'user', text: 'alpha prompt' }],
    },
    {
      id: 'claude-2',
      source: 'claude',
      title: 'claude session',
      status: 'idle',
      statusDetail: 'idle',
      cwd: '/tmp/beta',
      startedAt: '2026-04-08T10:01:00.000Z',
      durationMs: 1000,
      hasPendingPermission: false,
      needsUserAttention: false,
      subagentCount: 0,
      launcher: null,
      recentHooks: [{ kind: 'Stop', role: 'assistant', text: 'beta done' }],
    },
    {
      id: 'codex-1',
      source: 'codex',
      title: 'codex session',
      status: 'running',
      statusDetail: 'running',
      cwd: '/tmp/gamma',
      startedAt: '2026-04-08T10:02:00.000Z',
      durationMs: 1000,
      hasPendingPermission: false,
      needsUserAttention: false,
      subagentCount: 0,
      launcher: null,
      recentHooks: [{ kind: 'UserPromptSubmit', role: 'user', text: 'gamma prompt' }],
    },
  ],
};

describe('App', () => {
  beforeEach(() => {
    mockedTauri.getCurrentWindowLabel.mockResolvedValue('main');
    mockedTauri.getAppState.mockResolvedValue(state);
    mockedTauri.onAppStateUpdated.mockResolvedValue(() => {});
  });

  it('按 agent 分组展示会话并显示会话数量', async () => {
    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Claude')).toBeInTheDocument();
      expect(screen.getAllByText('Codex').length).toBeGreaterThan(0);
    });

    const groups = Array.from(container.querySelectorAll('.agent-group'));
    expect(groups).toHaveLength(2);

    expect(within(groups[0] as HTMLElement).getByText('Claude')).toBeInTheDocument();
    expect(within(groups[0] as HTMLElement).getByText('2')).toBeInTheDocument();
    expect(within(groups[0] as HTMLElement).getByText('alpha')).toBeInTheDocument();
    expect(within(groups[0] as HTMLElement).getByText('beta')).toBeInTheDocument();

    expect(within(groups[1] as HTMLElement).getAllByText('Codex').length).toBeGreaterThan(0);
    expect(within(groups[1] as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(within(groups[1] as HTMLElement).getByText('gamma')).toBeInTheDocument();
  });

  it('original app 缺失时回退显示 agent 名称', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Ghostty')).toBeInTheDocument();
    });

    expect(screen.getAllByText('Claude Code')).toHaveLength(1);
    expect(screen.getAllByText('Codex')).toHaveLength(2);
  });
});
