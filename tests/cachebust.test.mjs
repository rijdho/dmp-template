// Asset versioning. There is no bundler here, so nothing content-hashes the
// files: the only thing that reaches a browser holding an old copy is the ?v=
// on the URL. The family learned this in orcid-finder: only the entry module
// carried a version, a browser served a cached module against a fresh one that
// imported a symbol the cached copy did not export, and the whole module graph
// aborted with no visible error: a blank tool that looked deployed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assetHash, assetVersion, readLock, relockRefusal, servedFiles } from './assets-lock.mjs';

const root = new URL('../', import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, root)), 'utf8');

const srcFiles = [
  ...readdirSync(fileURLToPath(new URL('src/', root))).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`),
  ...readdirSync(fileURLToPath(new URL('src/i18n/', root))).filter((f) => f.endsWith('.js')).map((f) => `src/i18n/${f}`),
];

/** Every relative import in the source tree, with the version it carries. */
function imports() {
  const found = [];
  for (const file of srcFiles)
    for (const m of read(file).matchAll(/from\s+'(\.[^']+)'/g))
      found.push({ file, specifier: m[1], version: /\?v=(\d+)$/.exec(m[1])?.[1] ?? null });
  return found;
}

test('the source tree actually has relative imports to check', () => {
  assert.ok(imports().length >= 5, 'the scan found suspiciously few imports');
});

test('every relative import carries a version', () => {
  for (const i of imports())
    assert.ok(i.version, `${i.file} imports '${i.specifier}' with no ?v=, so a cached copy can be served`);
});

test('every version in the app is the same number', () => {
  const html = read('index.html');
  const style = /style\.css\?v=(\d+)/.exec(html)?.[1];
  const entry = /src\/app\.js\?v=(\d+)/.exec(html)?.[1];
  assert.ok(style, 'index.html does not version the stylesheet');
  assert.ok(entry, 'index.html does not version the entry module');
  const versions = new Set([style, entry, ...imports().map((i) => i.version)]);
  assert.equal(
    versions.size, 1,
    `versions disagree (${[...versions].join(', ')}): bump them together or a mixed set of files is served`,
  );
});

// ── The asset lock ──────────────────────────────────────────────────────────

test('the lock matches the tree, so no served file changed without a bump', () => {
  // The test above proves the versions AGREE with each other. It cannot see a
  // file rewritten under a version that did not move, which is what went wrong
  // in orcid-finder. The lock is what notices.
  const lock = readLock();
  assert.equal(
    assetVersion(), lock.version,
    'index.html and the lock disagree on ?v=; run `node tests/assets-lock.mjs --write` after bumping',
  );
  assert.equal(
    assetHash(), lock.hash,
    'a served file changed. Bump ?v= in index.html and in every relative import, then run ' +
    '`node tests/assets-lock.mjs --write`. Without the bump, a browser that already has these ' +
    'files keeps serving the old ones for the length of the Pages cache window.',
  );
});

test('the lock covers every served file, and no more', () => {
  // A new module under src/ that the lock does not hash is a file the guard is
  // blind to, and it would be blind silently.
  const served = servedFiles();
  assert.equal(served.length, readLock().files, 'a served file was added or removed; relock');
  for (const f of ['index.html', 'style.css', 'src/app.js', 'src/evidence.js', 'src/i18n/en.js', 'src/madmp-schema.js'])
    assert.ok(served.includes(f), `${f} is served and unlocked`);
  // Tests and fonts are deliberately outside: see the header of assets-lock.mjs.
  assert.ok(!served.some((f) => f.startsWith('tests/') || f.startsWith('house/fonts/') || f.startsWith('bin/')));
});

test('relocking cannot silence the guard while the version stands still', () => {
  // Without this, "run the writer" would be a way to make the failure go away
  // without fixing it, which is worse than no guard: it would look handled.
  const at = (version, hash) => ({ version, hash, files: 12 });
  assert.match(
    relockRefusal(at('12', 'old'), at('12', 'new')) ?? '',
    /\?v= is still 12/,
    'a changed tree under an unchanged version must be refused',
  );
  // The two honest cases still pass: a bump, and a relock that changes nothing.
  assert.equal(relockRefusal(at('12', 'old'), at('13', 'new')), null);
  assert.equal(relockRefusal(at('12', 'same'), at('12', 'same')), null);
  // And the very first lock, with nothing to compare against.
  assert.equal(relockRefusal(null, at('12', 'new')), null);
});
