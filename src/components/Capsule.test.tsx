import { render, screen } from '@testing-library/react';
import Capsule from './Capsule';

describe('Capsule', () => {
  it('shows empty state label', () => {
    render(
      <Capsule
        expanded={false}
        hasAttention={false}
        hasPermission={false}
        onOpenSettings={() => {}}
        onToggleExpanded={() => {}}
        sessions={[]}
      />,
    );

    expect(screen.getByText('AgentIsland')).toBeInTheDocument();
    expect(screen.getByText('暂无活跃 session')).toBeInTheDocument();
  });
});
