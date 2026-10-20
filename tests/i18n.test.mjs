// i18n. Aimed at the failures that still render: a key built at runtime that nobody wrote, a
// code a module emits with no string, a question that drifted from the guide's wording. Most
// keys here ARE built at runtime (`q.${id}`, `det.${...}`), so they are enumerated from the
// catalogue rather than found by grepping for literals.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DEFAULT_LANG, LANGS, LOCALES, extraKeys, missingKeys, placeholders, resolveLang } from '../src/i18n/index.js';
import { CHECK_IDS, OUTCOMES, PHASES, VERDICTS } from '../src/evidence.js';
import { DATASET_FIELDS, PLAN_FIELDS, QUESTIONS, SECTIONS } from '../src/requirements.js';
import { PLAN_META } from '../src/diff.js';
import { KEYWORDS } from '../src/jsonschema.js';

const CODES = Object.keys(LOCALES);
const en = LOCALES.en;
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('English only for now, and any later locale is held to the English key set', () => {
  assert.deepEqual(CODES, ['en']);
  assert.deepEqual(LANGS.map((l) => l.code), CODES);
  for (const code of CODES) {
    assert.deepEqual(missingKeys(code), [], `${code} is missing keys`);
    assert.deepEqual(extraKeys(code), [], `${code} carries keys English does not`);
    for (const key of Object.keys(en)) assert.deepEqual(placeholders(LOCALES[code][key]), placeholders(en[key]), `${code}.${key}`);
  }
});

test('no string is empty or carries an em dash', () => {
  for (const [key, value] of Object.entries(en)) {
    assert.ok(String(value).trim().length > 0, `${key} is empty`);
    assert.equal(String(value).includes('—'), false, `${key} has an em dash`);
  }
});

/** Every key the page builds from the catalogue at runtime. */
function runtimeKeys() {
  const keys = [];
  for (const s of SECTIONS) keys.push(`sec.${s}`);
  for (const q of QUESTIONS) keys.push(`q.${q.id}`, `q.${q.id}.guide`);
  for (const v of VERDICTS) keys.push(`verdict.${v}`);
  for (const o of OUTCOMES) keys.push(`out.${o}`);
  for (const p of PHASES) keys.push(`phase.${p}`);
  for (const id of CHECK_IDS) keys.push(`chk.${id}`);
  for (const f of DATASET_FIELDS) {
    keys.push(`field.${f.key}`);
    for (const o of f.options ?? []) keys.push(['data_access', 'certified_with'].includes(f.key) ? `opt.${f.key}.${o}` : `opt.${o}`);
  }
  for (const s of ['planned', 'applied', 'granted', 'rejected']) keys.push(`opt.funding_status.${s}`);
  for (const f of PLAN_FIELDS) {
    keys.push(`field.${f.key}`, `cmp.field.${f.key}`);
    for (const c of f.columns ?? []) keys.push(`col.${f.key}.${c.key}`);
  }
  for (const f of PLAN_META) keys.push(`cmp.field.${f.key}`);
  for (const k of ['added', 'removed', 'changed']) keys.push(`cmp.kind.${k}`);
  // Every validation code the schema walker can produce.
  for (const c of ['required', 'type', 'enum', 'oneOf', 'minItems', 'uniqueItems']) keys.push(`val.${c}`);
  for (const f of ['date', 'date-time', 'email', 'uri', 'url']) keys.push(`val.format.${f}`);
  return keys;
}

test('every key built from the catalogue exists', () => {
  const keys = runtimeKeys();
  assert.ok(keys.length > 70, 'the enumeration found suspiciously few keys');
  for (const k of keys) assert.ok(k in en, `no string for ${k}`);
  assert.ok(KEYWORDS.includes('oneOf'));
});

test('every det./val./err. code the modules can emit exists', () => {
  const found = new Set();
  for (const f of ['src/evidence.js', 'src/plan.js', 'src/jsonschema.js', 'src/datacite.js', 'src/diff.js', 'src/app.js', 'bin/dmp-check.mjs'])
    for (const m of read(`../${f}`).matchAll(/'((?:det|val|err)\.[a-zA-Z.-]+)'/g)) found.add(m[1]);
  assert.ok(found.size > 40, `the scan found suspiciously few codes (${found.size})`);
  for (const k of found) assert.ok(k in en, `${k} is emitted but has no string`);
});

test('every key the page and the CLI ask for literally exists', () => {
  const html = read('../index.html');
  const keys = new Set();
  for (const m of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) keys.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g))
    for (const pair of m[1].split(';')) keys.add(pair.split(':')[1]?.trim());
  for (const f of ['src/app.js', 'src/plan.js', 'src/report.js', 'src/diff.js', 'bin/dmp-check.mjs'])
    for (const m of read(`../${f}`).matchAll(/\bt(?:Html)?\('([a-z][\w.-]+)'/gi)) keys.add(m[1]);
  keys.delete(undefined);
  assert.ok(keys.size > 60, `the scan found suspiciously few keys (${keys.size})`);
  for (const key of keys) assert.ok(key in en, `asked for a key nobody wrote: ${key}`);
});

test('the questions are the guide’s core requirements, verbatim', () => {
  // Spot checks against the rendered pp. 8-9, so a well-meant edit is caught.
  assert.equal(en['q.1b'], 'What data (for example the kinds, formats, and volumes) will be collected or produced?');
  assert.equal(en['q.4c'], 'How will possible ethical issues be taken into account, and codes of conduct followed?');
  assert.equal(en['q.5d'], 'How will the application of a unique and persistent identifier (such as a Digital Object Identifier (DOI)) to each data set be ensured?');
  assert.equal(en['sec.3'], 'Storage and backup during the research process');
});

test('seven questions differ from the template’s wording, as How it works says', () => {
  // The template's wording, pp. 17-25, for every question it words differently.
  const TEMPLATE = {
    '1b': 'What data (for example the kind, formats, and volumes), will be collected or produced?',
    '2a': 'What metadata and documentation (for example the methodology of data collection and way of organising data) will accompany the data?',
    '3a': 'How will data and metadata be stored and backed up during the research?',
    '4a': 'If personal data are processed, how will compliance with legislation on personal data and on security be ensured?',
    '4c': 'What ethical issues and codes of conduct are there, and how will they be taken into account?',
    '5b': 'How will data for preservation be selected, and where data will be preserved long-term (for example a data repository or archive)?',
    '5c': 'What methods or software tools are needed to access and use data?',
  };
  for (const [id, text] of Object.entries(TEMPLATE)) assert.notEqual(en[`q.${id}`], text, id);
  assert.equal(Object.keys(TEMPLATE).length, 7);
  assert.match(en['how.guide.body'], /seven of the fifteen/);
});

test('the language is resolved from the URL, then the browser, then English', () => {
  assert.equal(resolveLang('es', ['es-CL']), 'en', 'Spanish is not offered yet');
  assert.equal(resolveLang(null, []), DEFAULT_LANG);
});
