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
    ...overrides,
  };
}

describe('SessionRow', () => {
  beforeEach(() => {
    forceRemoveSession.mockReset();
  });

  it('不再显示 elapsed 或 agent 名称标签', () => {
    render(<SessionRow session={buildSession()} />);

    expect(screen.queryByText('Elapsed')).not.toBeInTheDocument();
    expect(screen.queryByText('Claude Code')).not.toBeInTheDocument();
  });

  it('Claude 会话有来源图标时显示图标和名称', () => {
    render(
      <SessionRow
        session={buildSession({
          launcher: {
            name: 'Ghostty',
            iconDataUrl: 'data:image/png;base64,ghostty',
            bundlePath: '/Applications/Ghostty.app',
          },
        })}
      />,
    );

    expect(screen.getByText('Ghostty')).toBeInTheDocument();
    expect(screen.getByAltText('Ghostty')).toHaveAttribute('src', 'data:image/png;base64,ghostty');
  });

  it('来源图标缺失时只显示名称', () => {
    render(
      <SessionRow
        session={buildSession({
          launcher: {
            name: 'Zed',
            iconDataUrl: null,
            bundlePath: '/Applications/Zed.app',
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
