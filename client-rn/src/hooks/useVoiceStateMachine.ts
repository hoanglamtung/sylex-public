import { useState, useCallback } from 'react';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

export interface VoiceStateMachine {
  state: VoiceState;
  setState: (next: VoiceState) => void;
  reset: () => void;
}

export function useVoiceStateMachine(): VoiceStateMachine {
  const [state, setStateInternal] = useState<VoiceState>('idle');

  const setState = useCallback((next: VoiceState) => {
    setStateInternal(current => {
      if (current === next) return current;
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setStateInternal('idle');
  }, []);

  return { state, setState, reset };
}
