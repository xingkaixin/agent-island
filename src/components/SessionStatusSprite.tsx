import { useEffect, useMemo, useState } from 'react';
import type { SessionStatus } from '../types/agent';

type SpriteState = 'ask' | 'working' | 'idle';

const framesByState: Record<SpriteState, string[]> = {
  ask: Array.from({ length: 6 }, (_, index) => `/bot/ask-5fps/agentisland_perm_0${index}.png`),
  working: Array.from({ length: 4 }, (_, index) => `/bot/work-8fps/agentisland_work_0${index}.png`),
  idle: Array.from({ length: 8 }, (_, index) => `/bot/idle-6fps/agentisland_idle_0${index}.png`),
};

const frameDurationByState: Record<SpriteState, number> = {
  ask: 200,
  working: 125,
  idle: 167,
};

function resolveSpriteState(
  status: SessionStatus,
  hasPendingPermission: boolean,
  needsUserAttention: boolean,
): SpriteState {
  if (
    hasPendingPermission ||
    needsUserAttention ||
    status === 'attention' ||
    status === 'permission'
  ) {
    return 'ask';
  }

  if (status === 'idle' || status === 'done') {
    return 'idle';
  }

  return 'working';
}

export default function SessionStatusSprite({
  status,
  hasPendingPermission,
  needsUserAttention,
}: {
  status: SessionStatus;
  hasPendingPermission: boolean;
  needsUserAttention: boolean;
}) {
  const spriteState = resolveSpriteState(status, hasPendingPermission, needsUserAttention);
  const frames = useMemo(() => framesByState[spriteState], [spriteState]);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(0);
    if (frames.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % frames.length);
    }, frameDurationByState[spriteState]);

    return () => {
      window.clearInterval(timer);
    };
  }, [frames, spriteState]);

  return (
    <span className="session-status-sprite">
      <img alt={spriteState} className="h-11 w-11 object-contain" src={frames[frameIndex]} />
    </span>
  );
}
