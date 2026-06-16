import en from '../src/i18n/locales/en';
import de from '../src/i18n/locales/de';
import fr from '../src/i18n/locales/fr';
import es from '../src/i18n/locales/es';
import it from '../src/i18n/locales/it';
import tr from '../src/i18n/locales/tr';
import pl from '../src/i18n/locales/pl';

export const SUPPORTED_LANGUAGES = [
  { code: 'en-US', label: 'English' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'es-ES', label: 'Español' },
  { code: 'it-IT', label: 'Italiano' },
  { code: 'tr-TR', label: 'Türkçe' },
  { code: 'pl-PL', label: 'Polski' },
] as const;

const dictionaries: Record<string, Record<string, string>> = {
  'en-US': en,
  'de-DE': de,
  'fr-FR': fr,
  'es-ES': es,
  'it-IT': it,
  'tr-TR': tr,
  'pl-PL': pl,
};

const STORAGE_KEY = 'settings_language';

export function detectLanguage(): string {
  const persisted = localStorage.getItem(STORAGE_KEY);
  if (persisted && dictionaries[persisted]) {
    return persisted;
  }

  const raw = navigator.language || 'en-US';
  if (dictionaries[raw]) {
    return raw;
  }

  const prefix = raw.slice(0, 2).toLowerCase();
  const fallback = Object.keys(dictionaries).find(item => item.slice(0, 2).toLowerCase() === prefix);
  return fallback ?? 'en-US';
}

export function persistLanguage(code: string): void {
  localStorage.setItem(STORAGE_KEY, code);
}

export function t(language: string, key: string): string {
  const dict = dictionaries[language] ?? dictionaries['en-US'];
  return dict[key] ?? dictionaries['en-US'][key] ?? key;
}
