// The Content-Security-Policy, and the things that would force it to be loosened.
//
// The policy is the only defence here that survives a mistake: escaping every value is a
// discipline someone can forget in one edit, while `default-src 'none'` stops the consequence.
// It also turns the page's promise, that writing a plan touches no network and checking one
// talks only to DataCite, into something the browser enforces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DATACITE_API, DOI_ORG } from '../src/datacite.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const html = read('../index.html');

const csp = (() => {
  const m = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html);
  assert.ok(m, 'the page ships no Content-Security-Policy');
  return Object.fromEntries(
    m[1].split(';').map((d) => d.trim()).filter(Boolean)
      .map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v]; }),
  );
})();

test('the policy denies everything it does not name', () => {
  for (const d of ['default-src', 'object-src', 'base-uri', 'form-action']) assert.deepEqual(csp[d], ["'none'"], d);
});

test('scripts, styles and fonts come from this origin only', () => {
  for (const d of ['script-src', 'style-src', 'font-src']) assert.deepEqual(csp[d], ["'self'"], `${d} must be 'self' alone`);
});

test('connect-src names exactly the two hosts the code calls', () => {
  const origin = (url) => new URL(url).origin;
  assert.deepEqual(new Set(csp['connect-src']), new Set([origin(DATACITE_API), origin(DOI_ORG)]),
    'a host added to the code and not to the policy fails silently in the browser');
});

test('no source file calls a host the policy does not name', () => {
  const allowed = new Set(csp['connect-src']);
  for (const f of ['src/app.js', 'src/datacite.js', 'src/evidence.js', 'src/plan.js'])
    for (const m of read(`../${f}`).matchAll(/fetch(?:Impl)?\(\s*['"`](https?:\/\/[^/'"`$]+)/g))
      assert.ok(allowed.has(m[1]), `${f} fetches ${m[1]}`);
  // datacite.js builds its URLs from the constant, so the scan above sees nothing there: say so.
  assert.match(read('../src/datacite.js'), /fetchImpl\(url/);
  assert.match(read('../src/datacite.js'), /\$\{DOI_ORG\}\/ra\//);
});

test('nothing in the page needs the policy loosened', () => {
  assert.equal(/\sstyle="/.test(html), false, 'an inline style attribute needs style-src unsafe-inline');
  assert.equal(/\son[a-z]+="/.test(html), false, 'an inline event handler needs script-src unsafe-inline');
  assert.equal(/<script(?![^>]*\ssrc=)/.test(html), false, 'an inline script needs a hash or unsafe-inline');
  // app.js builds markup as strings; a style attribute there is as blocked as one in the HTML.
  assert.equal(/\sstyle=/.test(read('../src/app.js')), false, 'app.js writes a style attribute');
});

test('the theme bootstrap is a blocking script, so it still beats first paint', () => {
  const tag = /<script[^>]*theme-boot[^>]*>/.exec(html);
  assert.ok(tag, 'the theme bootstrap is not loaded');
  assert.equal(/type="module"|defer|async/.test(tag[0]), false);
});
