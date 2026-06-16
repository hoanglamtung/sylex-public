/**
 * secureStorage — #246
 *
 * Thin wrapper around react-native-encrypted-storage.
 * iOS:     Keychain-backed (same security level as react-native-keychain).
 * Android: EncryptedSharedPreferences (AES-256, key in Android Keystore).
 *
 * Use for PII and sensitive preferences only.
 * For non-sensitive preferences (language, DEV toggles) continue using AsyncStorage.
 */

import EncryptedStorage from 'react-native-encrypted-storage';

// ─── Key registry ─────────────────────────────────────────────────────────────

export const SecureKeys = {
  /** Apple User ID — stored for revocation checks (#246, replaces react-native-keychain). */
  APPLE_USER_ID: 'apple_user_id',
  /** Wake-word enabled preference (#246 — moved out of plain AsyncStorage). */
  WAKE_WORD_ENABLED: 'wake_word_enabled',
} as const;

// ─── API ──────────────────────────────────────────────────────────────────────

export async function secureGet(key: string): Promise<string | null> {
  try {
    return (await EncryptedStorage.getItem(key)) ?? null;
  } catch {
    return null;
  }
}

export async function secureSet(key: string, value: string): Promise<void> {
  await EncryptedStorage.setItem(key, value);
}

export async function secureRemove(key: string): Promise<void> {
  try {
    await EncryptedStorage.removeItem(key);
  } catch {
    // ignore if key doesn't exist
  }
}

/** Wipes the entire encrypted store. Called by "Clear All Data" in Settings. */
export async function secureClear(): Promise<void> {
  try {
    await EncryptedStorage.clear();
  } catch {
    // ignore
  }
}
