type TimerId = ReturnType<typeof setTimeout>;

interface GroundingPreambleCallbacks {
  speak: () => void;
  stop: () => void;
}

interface GroundingPreambleOptions {
  enabled: boolean;
  delayMs?: number;
  callbacks: GroundingPreambleCallbacks;
}

interface GroundingPreambleController {
  arm: () => void;
  markResponseStarted: () => void;
  finalize: () => void;
  hasSpoken: () => boolean;
}

export function createGroundingPreambleController(options: GroundingPreambleOptions): GroundingPreambleController {
  const { enabled, callbacks, delayMs = 1200 } = options;

  let timer: TimerId | null = null;
  let spoken = false;
  let active = false;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    arm: () => {
      if (!enabled || spoken || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        spoken = true;
        active = true;
        callbacks.speak();
      }, delayMs);
    },

    markResponseStarted: () => {
      clearTimer();
      if (active) {
        active = false;
        callbacks.stop();
      }
    },

    finalize: () => {
      clearTimer();
      if (active) {
        active = false;
        callbacks.stop();
      }
    },

    hasSpoken: () => spoken,
  };
}