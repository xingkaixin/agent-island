import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SessionRow from './SessionRow';
import type { SessionView } from '../types/agent';

const { forceRemoveSession } = vi.hoisted(() => ({
  forceRemoveSession: vi.fn<(sessionId: string) => Promise<void>>(),
}));

vi.mock('../lib/tauri', () => ({
  forceRemoveSession,
}));

vi.mock('./SessionStatusSprite', () => ({
  default: () => <div data-testid="session-status-sprite" />,
}));

function buildSession(overrides: Partial<SessionView> = {}): SessionView {
  return {
    id: 'session-1',
    source: 'claude',
    title: 'claude session',
    status: 'running',
    statusDetail: 'running',
    cwd: '/Users/Kevin/workspace/projects/personal/agent-island',
    startedAt: '2026-04-05T10:00:00.000Z',
    durationMs: 35_000,
    hasPendingPermission: false,
    needsUserAttention: false,
    subagentCount: 0,
    launcher: null,
    recentHooks: [],
    ...overrides,
  };
}

describe('SessionRow', () => {
  beforeEach(() => {
    forceRemoveSession.mockReset();
  });

  it('显示项目名、original app 回退名和最近三条 hook 占位', () => {
    const { container } = render(<SessionRow session={buildSession()} />);

    expect(screen.getByText('agent-island')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(container.querySelectorAll('.session-hook-line')).toHaveLength(3);
    expect(screen.getByTestId('session-status-sprite')).toBeInTheDocument();
  });

  it('任意会话有来源图标时显示图标和名称', () => {
    render(
      <SessionRow
        session={buildSession({
          source: 'codex',
          launcher: {
            name: 'Ghostty',
            iconDataUrl: 'data:image/png;base64,ghostty',
            bundlePath: '/Applications/Ghostty.app',
            pid: 123,
            detectedFrom: 'processTree',
          },
          recentHooks: [
            { kind: 'UserPromptSubmit', role: 'user', text: 'Fix the login bug' },
            { kind: 'Stop', role: 'assistant', text: 'Done' },
          ],
        })}
      />,
    );

    expect(screen.getByText('Ghostty')).toBeInTheDocument();
    expect(screen.getByAltText('Ghostty')).toHaveAttribute('src', 'data:image/png;base64,ghostty');
    expect(screen.getByText('Fix the login bug')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('来源图标缺失时只显示名称', () => {
    render(
      <SessionRow
        session={buildSession({
          launcher: {
            name: 'Zed',
            iconDataUrl: null,
            bundlePath: '/Applications/Zed.app',
            pid: 456,
            detectedFrom: 'processTree',
          },
        })}
      />,
    );

    expect(screen.getByText('Zed')).toBeInTheDocument();
    expect(screen.queryByAltText('Zed')).not.toBeInTheDocument();
  });

  it('点击强退按钮时调用移除会话接口', async () => {
    const user = userEvent.setup();
    forceRemoveSession.mockResolvedValue(undefined);

    render(<SessionRow session={buildSession()} />);

    await user.click(screen.getByRole('button', { name: '强退会话 agent-island' }));

    expect(forceRemoveSession).toHaveBeenCalledWith('session-1');
  });
});
