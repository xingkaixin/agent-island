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

  it('没有消息时不显示 hook 列表', () => {
    const { container } = render(<SessionRow session={buildSession()} />);

    expect(screen.getByText('agent-island')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(container.querySelectorAll('.session-hook-line')).toHaveLength(0);
    expect(screen.getByTestId('session-status-sprite')).toBeInTheDocument();
  });

  it('按真实条数显示最近消息并保留最多三条', () => {
    const { container } = render(
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
            { kind: 'Stop', role: 'assistant', text: '第四条' },
            { kind: 'UserPromptSubmit', role: 'user', text: '第三条' },
            { kind: 'Notification', role: 'system', text: '第二条' },
            { kind: 'UserPromptSubmit', role: 'user', text: '第一条' },
          ],
        })}
      />,
    );

    expect(screen.getByText('Ghostty')).toBeInTheDocument();
    expect(screen.getByAltText('Ghostty')).toHaveAttribute('src', 'data:image/png;base64,ghostty');
    expect(container.querySelectorAll('.session-hook-line')).toHaveLength(3);
    expect(screen.queryByText('第一条')).not.toBeInTheDocument();
    expect(screen.getByText('第二条')).toBeInTheDocument();
    expect(screen.getByText('第三条')).toBeInTheDocument();
    expect(screen.getByText('第四条')).toBeInTheDocument();
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
