// The asset lock.
//
// There is no bundler here, so the `?v=N` on every URL is the only thing that
// makes a browser fetch a file it already holds. "Bump N when a served file
// changes" is a rule a person has to remember, and in orcid-finder on 2026-09-04
// a person did not: a release shipped rewritten modules under the version they
// already carried, and GitHub Pages' `max-age=600` kept returning browsers on
// the old ones. Nothing broke loudly, which is the problem: it was a silent
// downgrade. This copy of the guard came from there.
//
// This file turns the rule into an artefact. `assets.lock.json` records the
// version and a hash of every file the `?v=` covers. `tests/cachebust.test.mjs`
// fails when the tree and the lock disagree, and `--write` below REFUSES to
// record a changed hash under an unchanged version, which is the one case the
// comparison alone cannot tell apart: without that refusal, relocking would be a
// way to make the failure go away without fixing it.
//
// The workflow after editing anything served:
//
//   1. bump ?v= in index.html and in every relative import (they must agree)
//   2. node tests/assets-lock.mjs --write
//
// Lock LAST, once, just before committing. Editing a served file after locking
// makes the writer refuse until N moves again, which is correct but blunt: it
// cannot tell an uncommitted edit from a shipped one. The numbers are free, so
// the answer is simply to bump again rather than to weaken the rule.
//
// What it does NOT cover: `house/fonts/` and `schema/`. The fonts are referenced
// from house.css by a bare path, and the schema by its `$id`, neither with a
// version, so locking them would promise a protection that is not there. A font
// that ever changes needs a new filename; a schema that changes needs a new
// schema_version, which is how its readers tell versions apart.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const path = (rel) => fileURLToPath(new URL(rel, root));
const read = (rel) => readFileSync(path(rel), 'utf8');

export const LOCK_FILE = 'tests/assets.lock.json';

/** Every file the `?v=` on a URL is responsible for busting, in a stable order. */
export function servedFiles() {
  const js = (dir) => readdirSync(path(dir)).filter((f) => f.endsWith('.js')).sort().map((f) => `${dir}${f}`);
  // house/house.css is the synced copy of the house style: a sync changes a served file, so it bumps ?v= too.
  return ['index.html', 'house/house.css', 'style.css', ...js('src/'), ...js('src/i18n/')];
}

/** The version index.html stamps on its own assets. The imports must match it. */
export function assetVersion() {
  const m = /(?:style\.css|src\/app\.js)\?v=(\d+)/.exec(read('index.html'));
  if (!m) throw new Error('index.html carries no ?v= on its own assets');
  return m[1];
}

/**
 * One hash over the whole served tree. The path is hashed with the content, so
 * adding or renaming a served file moves the hash as surely as editing one.
 */
export function assetHash(files = servedFiles()) {
  const h = createHash('sha256');
  for (const f of files) {
    h.update(f);
    h.update('\0');
    h.update(read(f));
    h.update('\0');
  }
  return h.digest('hex');
}

export function readLock() {
  return JSON.parse(read(LOCK_FILE));
}

/**
 * Why a relock must be refused, or null when it may proceed.
 *
 * Pure, and separate from the writing, for two reasons: a test can exercise the
 * refusal without a test writing to the repository, and the rule itself is the
 * part worth reading. `previous` is null on the first lock, which is allowed.
 */
export function relockRefusal(previous, next) {
  if (!previous) return null;
  if (previous.hash === next.hash) return null;
  if (previous.version !== next.version) return null;
  return (
    `a served file changed but ?v= is still ${next.version}. Bump it in index.html and in every ` +
    'relative import first, then run this again. Relocking in place would leave every browser ' +
    'that already has these files serving the old ones.'
  );
}

/** Record the current tree, unless `relockRefusal` says the bump is missing. */
export function writeLock() {
  const files = servedFiles();
  const next = { version: assetVersion(), hash: assetHash(files), files: files.length };
  let previous = null;
  try {
    previous = readLock();
  } catch {
    // No lock yet: the first write establishes it.
  }
  const refusal = relockRefusal(previous, next);
  if (refusal) throw new Error(refusal);
  writeFileSync(path(LOCK_FILE), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

if (process.argv[2] === '--write') {
  try {
    const { version, hash, files } = writeLock();
    console.log(`locked ${files} served files at ?v=${version}: ${hash.slice(0, 16)}…`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
