// String lookup + language preference. English/Hindi content ship now; adding
// another language later is additive (a new data/strings.<code>.json + one
// entry in SUPPORTED_LANGS), no code changes to the lookup path itself.

import { speechProvider } from './speechProvider.js';

export const SUPPORTED_LANGS = [
  { code: 'en', label: 'English', speechLang: 'en-US' },
  { code: 'hi', label: 'हिन्दी', speechLang: 'hi-IN' },
];

const LANG_STORAGE_KEY = 'raahi.lang';
let currentLang = 'en';
let strings = {};
const loadedCache = {};

async function loadStrings(code) {
  if (loadedCache[code]) return loadedCache[code];
  try {
    const res = await fetch(`/data/strings.${code}.json`);
    const json = await res.json();
    loadedCache[code] = json;
    return json;
  } catch (err) {
    console.error(`i18n: failed to load strings.${code}.json`, err);
    return {};
  }
}

export async function init() {
  let saved = null;
  try {
    saved = localStorage.getItem(LANG_STORAGE_KEY);
  } catch (err) { /* localStorage unavailable, ignore */ }
  const fallback = (navigator.language || 'en').split('-')[0];
  const initial = saved || (SUPPORTED_LANGS.some((l) => l.code === fallback) ? fallback : 'en');
  await setLang(initial);
}

export async function setLang(code) {
  if (!SUPPORTED_LANGS.some((l) => l.code === code)) code = 'en';
  currentLang = code;
  strings = await loadStrings(code);
  try {
    localStorage.setItem(LANG_STORAGE_KEY, code);
  } catch (err) { /* ignore */ }
}

export function getLang() {
  return currentLang;
}

export function getLangEntry() {
  return SUPPORTED_LANGS.find((l) => l.code === currentLang) || SUPPORTED_LANGS[0];
}

export function getSpeechLang() {
  return getLangEntry().speechLang;
}

export function pickVoice() {
  return speechProvider.hasVoiceForLang(getSpeechLang());
}

/**
 * t('hazard.danger', {side: 'left'}) -> looks up the key, substitutes
 * {placeholders}. Never throws; falls back to the key itself so a missing
 * translation degrades to visible-but-harmless text rather than blocking
 * speech entirely.
 */
export function t(key, vars = {}) {
  let template = strings[key];
  if (template === undefined) {
    console.warn(`i18n: missing key "${key}" for lang "${currentLang}"`);
    template = key;
  }
  return template.replace(/\{(\w+)\}/g, (_, name) => (vars[name] !== undefined ? vars[name] : ''));
}
