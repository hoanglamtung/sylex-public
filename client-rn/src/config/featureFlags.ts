import { APP_VERSION } from './appVersion';

/**
 * Minimum app version required before a mode button is shown on HomeScreen.
 * Modes not listed here are always visible (e.g. 'standard', 'personal').
 *
 * Map is keyed by the lowercase mode string sent to the server.
 */
export const MODE_MIN_VERSIONS: Record<string, string> = {
  business: '1.3.0', // #120 — Phase 4 Business Assistant
  kids:     '1.4.0', // #121 — Phase 5 Kids Assistant
  car:      '1.5.0', // #122 — Phase 6 Car Assistant
};

/**
 * Compare two semver strings without importing a library.
 * Returns true if `a >= b` for the major.minor.patch components.
 */
function semverGte(a: string, b: string): boolean {
  const parse = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0);
  const [aMaj, aMin, aPatch] = parse(a);
  const [bMaj, bMin, bPatch] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPatch >= bPatch;
}

/**
 * Returns true when the current app binary meets the minimum version
 * required to show this mode button.
 */
export function isModeAvailable(mode: string): boolean {
  const minVersion = MODE_MIN_VERSIONS[mode.toLowerCase()];
  if (!minVersion) return true;
  return semverGte(APP_VERSION, minVersion);
}
