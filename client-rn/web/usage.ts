export const DAILY_LIMIT = 30;
export const SESSION_DURATION_MS = 10 * 60 * 1000;
const SESSION_WARNING_MS = 8 * 60 * 1000;
const RATE_LIMIT_MS = 3000;
const MAX_INPUT_CHARS = 500;

const KEY_DAILY_COUNT = 'cap_daily_count';
const KEY_DAILY_DATE = 'cap_daily_date';

let lastRequestTime = 0;
let warningTimer: number | null = null;
let endTimer: number | null = null;
let sessionActive = false;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function canMakeRequest(): boolean {
  if (!sessionActive) {
    return false;
  }
  return Date.now() - lastRequestTime >= RATE_LIMIT_MS;
}

export function recordRequest(): void {
  lastRequestTime = Date.now();
}

export function sanitizeInput(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_INPUT_CHARS) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, MAX_INPUT_CHARS), truncated: true };
}

export function checkAndIncrementDaily(): boolean {
  const date = localStorage.getItem(KEY_DAILY_DATE);
  const count = Number(localStorage.getItem(KEY_DAILY_COUNT) ?? '0');
  const current = date === today() ? count : 0;

  if (current >= DAILY_LIMIT) {
    return false;
  }

  localStorage.setItem(KEY_DAILY_DATE, today());
  localStorage.setItem(KEY_DAILY_COUNT, String(current + 1));
  return true;
}

export function getDailyUsageStats(): {
  used: number;
  remaining: number;
  limit: number;
  remainingPercent: number;
} {
  const date = localStorage.getItem(KEY_DAILY_DATE);
  const count = Number(localStorage.getItem(KEY_DAILY_COUNT) ?? '0');
  const used = date === today() ? count : 0;
  const clampedUsed = Math.max(0, Math.min(used, DAILY_LIMIT));
  const remaining = DAILY_LIMIT - clampedUsed;

  return {
    used: clampedUsed,
    remaining,
    limit: DAILY_LIMIT,
    remainingPercent: Math.round((remaining / DAILY_LIMIT) * 100),
  };
}

export function grantAdRewardCommands(commands: number): void {
  const safeCommands = Math.max(0, Math.floor(commands));
  if (safeCommands === 0) {
    return;
  }

  const date = localStorage.getItem(KEY_DAILY_DATE);
  const count = Number(localStorage.getItem(KEY_DAILY_COUNT) ?? '0');
  const currentUsed = date === today() ? count : 0;
  const nextUsed = Math.max(0, currentUsed - safeCommands);

  localStorage.setItem(KEY_DAILY_DATE, today());
  localStorage.setItem(KEY_DAILY_COUNT, String(nextUsed));
}

export function startSession(onWarning: () => void, onEnded: () => void): () => void {
  stopSession();

  sessionActive = true;

  warningTimer = window.setTimeout(onWarning, SESSION_WARNING_MS);
  endTimer = window.setTimeout(() => {
    stopSession();
    onEnded();
  }, SESSION_DURATION_MS);

  return stopSession;
}

export function stopSession(): void {
  sessionActive = false;
  if (warningTimer !== null) {
    window.clearTimeout(warningTimer);
  }
  if (endTimer !== null) {
    window.clearTimeout(endTimer);
  }
  warningTimer = null;
  endTimer = null;
}
