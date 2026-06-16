import AsyncStorage from '@react-native-async-storage/async-storage';

export const DAILY_LIMIT = 30;
export const SESSION_DURATION_MS = 10 * 60 * 1000; // 10 minutes (free)
export const SESSION_DURATION_PREMIUM_MS = 30 * 60 * 1000; // 30 minutes (premium)
export const AD_REWARD_COMMANDS = 5;
export const AD_DAILY_LIMIT = 6;
export const AD_COOLDOWN_MS = 5 * 60 * 1000;
const SESSION_WARNING_MS  =  8 * 60 * 1000; // warn at 8 minutes (free)
const RATE_LIMIT_MS = 3000;
const MAX_INPUT_CHARS = 500;

const KEY_DAILY_COUNT = 'cap_daily_count';
const KEY_DAILY_DATE  = 'cap_daily_date';
const KEY_AD_DAILY_COUNT = 'cap_ad_daily_count';
const KEY_AD_DAILY_DATE = 'cap_ad_daily_date';
const KEY_AD_LAST_REWARDED_AT = 'cap_ad_last_rewarded_at';

let lastRequestTime = 0;
let sessionActive = false;
let sessionWarningTimer: ReturnType<typeof setTimeout> | null = null;
let sessionEndTimer:     ReturnType<typeof setTimeout> | null = null;

// ─── Daily limit ─────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getDailyCount(): Promise<number> {
  const [countStr, date] = await Promise.all([
    AsyncStorage.getItem(KEY_DAILY_COUNT),
    AsyncStorage.getItem(KEY_DAILY_DATE),
  ]);
  if (date !== today()) return 0;
  return parseInt(countStr ?? '0', 10);
}

export async function checkAndIncrementDaily(): Promise<boolean> {
  const count = await getDailyCount();
  if (count >= DAILY_LIMIT) return false;
  await Promise.all([
    AsyncStorage.setItem(KEY_DAILY_COUNT, String(count + 1)),
    AsyncStorage.setItem(KEY_DAILY_DATE, today()),
  ]);
  return true;
}

export type AdRewardStatus = {
  canWatchAd: boolean;
  adsWatchedToday: number;
  adsRemainingToday: number;
  cooldownMsLeft: number;
  blockReason: 'none' | 'daily_limit' | 'cooldown';
};

export async function getAdRewardStatus(): Promise<AdRewardStatus> {
  const now = Date.now();
  const [adCountStr, adDate, lastRewardedAtStr] = await Promise.all([
    AsyncStorage.getItem(KEY_AD_DAILY_COUNT),
    AsyncStorage.getItem(KEY_AD_DAILY_DATE),
    AsyncStorage.getItem(KEY_AD_LAST_REWARDED_AT),
  ]);

  const adsWatchedToday = adDate === today() ? parseInt(adCountStr ?? '0', 10) : 0;
  const clampedWatchedToday = Number.isNaN(adsWatchedToday)
    ? 0
    : Math.max(0, Math.min(adsWatchedToday, AD_DAILY_LIMIT));
  const adsRemainingToday = Math.max(0, AD_DAILY_LIMIT - clampedWatchedToday);

  const lastRewardedAt = parseInt(lastRewardedAtStr ?? '0', 10);
  const cooldownMsLeft = Number.isNaN(lastRewardedAt)
    ? 0
    : Math.max(0, AD_COOLDOWN_MS - (now - lastRewardedAt));

  if (adsRemainingToday <= 0) {
    return {
      canWatchAd: false,
      adsWatchedToday: clampedWatchedToday,
      adsRemainingToday,
      cooldownMsLeft,
      blockReason: 'daily_limit',
    };
  }

  if (cooldownMsLeft > 0) {
    return {
      canWatchAd: false,
      adsWatchedToday: clampedWatchedToday,
      adsRemainingToday,
      cooldownMsLeft,
      blockReason: 'cooldown',
    };
  }

  return {
    canWatchAd: true,
    adsWatchedToday: clampedWatchedToday,
    adsRemainingToday,
    cooldownMsLeft: 0,
    blockReason: 'none',
  };
}

export async function grantAdRewardCommands(commands: number): Promise<void> {
  const safeCommands = Math.max(0, Math.floor(commands));
  if (safeCommands <= 0) return;

  const now = Date.now();
  const adStatus = await getAdRewardStatus();
  if (!adStatus.canWatchAd) {
    if (adStatus.blockReason === 'daily_limit') {
      throw new Error('AD_REWARD_DAILY_LIMIT_REACHED');
    }
    throw new Error('AD_REWARD_COOLDOWN_ACTIVE');
  }

  const count = await getDailyCount();
  const nextCount = Math.max(0, count - safeCommands);

  const nextAdsWatched = Math.min(AD_DAILY_LIMIT, adStatus.adsWatchedToday + 1);

  await Promise.all([
    AsyncStorage.setItem(KEY_DAILY_COUNT, String(nextCount)),
    AsyncStorage.setItem(KEY_DAILY_DATE, today()),
    AsyncStorage.setItem(KEY_AD_DAILY_COUNT, String(nextAdsWatched)),
    AsyncStorage.setItem(KEY_AD_DAILY_DATE, today()),
    AsyncStorage.setItem(KEY_AD_LAST_REWARDED_AT, String(now)),
  ]);
}

// ─── Rate limit ───────────────────────────────────────────────────────────────

export function canMakeRequest(): boolean {
  return Date.now() - lastRequestTime >= RATE_LIMIT_MS;
}

export function recordRequest(): void {
  lastRequestTime = Date.now();
}

// ─── Input validation ─────────────────────────────────────────────────────────

export function sanitizeInput(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_INPUT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_INPUT_CHARS), truncated: true };
}

// ─── Session management ───────────────────────────────────────────────────────

function clearSessionTimers(): void {
  if (sessionWarningTimer) { clearTimeout(sessionWarningTimer); sessionWarningTimer = null; }
  if (sessionEndTimer)     { clearTimeout(sessionEndTimer);     sessionEndTimer = null; }
}

export function startSession(
  onWarning: () => void,
  onEnded: () => void,
): void {
  clearSessionTimers();
  sessionActive = true;

  sessionWarningTimer = setTimeout(() => {
    if (!sessionActive) return;
    onWarning();
  }, SESSION_WARNING_MS);

  sessionEndTimer = setTimeout(() => {
    sessionActive = false;
    clearSessionTimers();
    onEnded();
  }, SESSION_DURATION_MS);
}

export function endSession(): void {
  sessionActive = false;
  clearSessionTimers();
}

export function isSessionActive(): boolean {
  return sessionActive;
}

// ─── Background guard ─────────────────────────────────────────────────────────

export function onAppBackground(): void {
  if (sessionActive) endSession();
}
