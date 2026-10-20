// Minimal i18n: no dependencies, no build step, matching the rest of the app.
//
//  · Flat, dotted keys in one object per locale. Easy to diff, easy to lint for
//    gaps (see `missingKeys`), and cheap to look up.
//  · `t()` is DOM-free, so the Node test runner can drive it directly.
//  · English is the fallback for any key a locale has not translated, so a
//    partial locale degrades to mixed language rather than to blank UI.
//  · File names (dmp.json, maDMP field names, SPDX ids) are never keys here: they
//    are the vocabulary of the formats and stay as written in every locale.
//
// English only for now. The structure stays: a locale is one more file here and one more
// entry in LOCALES and LANGS, and the i18n test then holds it to the English key set.

import { en } from './en.js?v=20';

export const LOCALES = { en };

// `label` is deliberately the endonym: a reader looking for their own language
// scans for "Español", not for "Spanish".
export const LANGS = [
  { code: 'en', label: 'English' },
];

export const DEFAULT_LANG = 'en';

const isSupported = (code) => Object.prototype.hasOwnProperty.call(LOCALES, code);

// The selected language lives on a global slot rather than in a module-local
// `let`. ES modules are cached per resolved URL, so importing this file at two
// different cache-busting versions gives TWO instances with independent state,
// and half the page would keep rendering the old language.
const state = (globalThis.__dmpTemplateI18n ??= { lang: DEFAULT_LANG });

export const getLang = () => state.lang;

export function setLang(code) {
  if (isSupported(code)) state.lang = code;
  return state.lang;
}

/** Resolve a language from an explicit code, then the browser, then English. */
export function resolveLang(preferred, navigatorLangs = []) {
  if (preferred && isSupported(preferred)) return preferred;
  for (const raw of navigatorLangs) {
    const base = String(raw).toLowerCase().split('-')[0];
    if (isSupported(base)) return base;
  }
  return DEFAULT_LANG;
}

// {placeholder} substitution. Values are inserted verbatim: a caller building
// HTML is responsible for escaping what it passes in.
function interpolate(str, vars) {
  if (!vars) return str;
  return String(str).replace(/\{(\w+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/**
 * Translate `key`. Falls back to English, then to the key itself: a missing
 * string shows up as a visible `form.submit` rather than an empty element, which
 * is what catches it in review.
 */
export function t(key, vars) {
  const table = LOCALES[state.lang] || LOCALES[DEFAULT_LANG];
  const str = table[key] ?? LOCALES[DEFAULT_LANG][key];
  return str == null ? key : interpolate(str, vars);
}

// The two helpers below are for the test suite, not the page: they live here
// because the catalogues do, and a lint that ships with the thing it lints does
// not go stale.

/** Keys present in English but missing from `code`. Empty is the passing state. */
export function missingKeys(code) {
  const table = LOCALES[code] ?? {};
  return Object.keys(en).filter((k) => !(k in table));
}

/** Keys a locale carries that English does not: dead weight, or a typo'd key. */
export function extraKeys(code) {
  const table = LOCALES[code] ?? {};
  return Object.keys(table).filter((k) => !(k in en));
}

/** The {placeholders} a string uses, as a sorted list. */
export const placeholders = (str) =>
  [...String(str).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
