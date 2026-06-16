import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from './locales/en';
import de from './locales/de';
import fr from './locales/fr';
import es from './locales/es';
import it from './locales/it';
import tr from './locales/tr';
import pl from './locales/pl';
import zh from './locales/zh';
import ko from './locales/ko';
import jp from './locales/jp';
import vi from './locales/vi';
import ru from './locales/ru';

export const SUPPORTED_LANGUAGES = [
  'de-DE', 'en-US', 'es-ES', 'fr-FR', 'it-IT', 'pl-PL', 'ru-RU', 'tr-TR', 'vi-VN', 'zh-CN', 'ja-JP', 'ko-KR',
];

const LANG_STORAGE_KEY = '@lang';

// Detect device locale — must be called after RN runtime is ready
function detectLocale(): string {
  const { NativeModules, Platform } = require('react-native');
  const raw: string =
    Platform.OS === 'ios'
      ? (NativeModules.SettingsManager?.settings?.AppleLocale ||
         NativeModules.SettingsManager?.settings?.AppleLanguages?.[0] ||
         'en_US')
      : (NativeModules.I18nManager?.localeIdentifier || 'en_US');

  const tag = raw.replace('_', '-');
  if (SUPPORTED_LANGUAGES.includes(tag)) return tag;
  const prefix = tag.split('-')[0].toLowerCase();
  const match = SUPPORTED_LANGUAGES.find(s => s.toLowerCase().startsWith(prefix));
  return match ?? 'en-US';
}

/**
 * Call once from App component. Reads user's saved language from AsyncStorage
 * first; falls back to device locale if none is set.
 */
export async function initI18n(): Promise<void> {
  if (i18n.isInitialized) return;

  let lng: string;
  try {
    const saved = await AsyncStorage.getItem(LANG_STORAGE_KEY);
    lng = saved && SUPPORTED_LANGUAGES.includes(saved) ? saved : detectLocale();
  } catch {
    lng = detectLocale();
  }

  await i18n
    .use(initReactI18next)
    .init({
      lng,
      fallbackLng: 'en-US',
      resources: {
        'en-US': { translation: en },
        'de-DE': { translation: de },
        'fr-FR': { translation: fr },
        'es-ES': { translation: es },
        'it-IT': { translation: it },
        'tr-TR': { translation: tr },
        'pl-PL': { translation: pl },
        'zh-CN': { translation: zh },
        'ko-KR': { translation: ko },
        'ja-JP': { translation: jp },
        'vi-VN': { translation: vi },
        'ru-RU': { translation: ru },
      },
      interpolation: { escapeValue: false },
      compatibilityJSON: 'v3',
    });
}

export { LANG_STORAGE_KEY };
export default i18n;
