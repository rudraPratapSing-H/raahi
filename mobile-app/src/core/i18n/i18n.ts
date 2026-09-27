// String lookup + language preference - ported from the web-app's i18n.js.
// Two differences from the web version: AsyncStorage instead of localStorage
// (now async), and the string tables are bundled JSON (Metro resolves
// `require(...)` for .json at build time) instead of a runtime fetch().

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface LangEntry {
  code: string;
  label: string;
  speechLang: string;
}

export const SUPPORTED_LANGS: LangEntry[] = [
  { code: 'en', label: 'English', speechLang: 'en-US' },
  { code: 'hi', label: 'हिन्दी', speechLang: 'hi-IN' },
];

const STRINGS_BY_LANG: Record<string, Record<string, string>> = {
  en: require('../../../assets/strings.en.json'),
  hi: require('../../../assets/strings.hi.json'),
};

const LANG_STORAGE_KEY = 'raahi.lang';
let currentLang = 'en';

export async function init(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(LANG_STORAGE_KEY);
    if (saved && SUPPORTED_LANGS.some((l) => l.code === saved)) {
      currentLang = saved;
    }
  } catch (err) {
    // AsyncStorage unavailable - stick with the 'en' default
  }
}

export async function setLang(code: string): Promise<void> {
  currentLang = SUPPORTED_LANGS.some((l) => l.code === code) ? code : 'en';
  try {
    await AsyncStorage.setItem(LANG_STORAGE_KEY, currentLang);
  } catch (err) {
    // ignore
  }
}

export function getLang(): string {
  return currentLang;
}

export function getLangEntry(): LangEntry {
  return SUPPORTED_LANGS.find((l) => l.code === currentLang) ?? SUPPORTED_LANGS[0];
}

export function getSpeechLang(): string {
  return getLangEntry().speechLang;
}

/**
 * t('hazard.danger', {side: 'left'}) -> looks up the key, substitutes
 * {placeholders}. Never throws; falls back to the key itself so a missing
 * translation degrades to visible-but-harmless text rather than blocking
 * speech entirely.
 */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const strings = STRINGS_BY_LANG[currentLang] ?? STRINGS_BY_LANG.en;
  let template = strings[key];
  if (template === undefined) {
    console.warn(`i18n: missing key "${key}" for lang "${currentLang}"`);
    template = key;
  }
  return template.replace(/\{(\w+)\}/g, (_, name) => (vars[name] !== undefined ? String(vars[name]) : ''));
}
