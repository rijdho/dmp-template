// The command-line checker and the exit codes CI reads, with the registry injected so no test
// touches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { failed, main, parseArgs } from '../bin/dmp-check.mjs';
import { RegistryError, recordOf } from '../src/datacite.js';
import { createPlan, planToJson, setDatasetDoi } from '../src/plan.js';

function planFile(edit) {
  const p = createPlan({ title: 'T', now: new Date('2026-09-01T00:00:00Z'), uuid: 'p', datasetUuid: 'd' });
  Object.assign(p.dmp.contact, { name: 'A', mbox: 'a@example.org' });
  p.dmp.contact.contact_id.identifier = '0000-0002-1825-0097';
  const ds = p.dmp.dataset[0];
  ds.title = 'Readings';
  setDatasetDoi(ds, '10.5281/zenodo.1');
  ds.distribution[0].issued = '2026-10-01';
  ds.distribution[0].license[0].license_ref = 'https://creativecommons.org/licenses/by/4.0/';
  edit?.(p);
  const dir = mkdtempSync(join(tmpdir(), 'dmp-check-'));
  const file = join(dir, 'dmp.json');
  writeFileSync(file, planToJson(p));
  return { file, dir };
}

const record = (rights) => recordOf({ id: '10.5281/zenodo.1', attributes: { doi: '10.5281/zenodo.1', state: 'findable', url: 'https://zenodo.org/x', rightsList: rights } });
const CC_BY = [{ rightsIdentifier: 'cc-by-4.0', rightsUri: 'https://creativecommons.org/licenses/by/4.0/legalcode' }];
const registry = (rec) => ({ record: async () => rec, byAward: async () => ({ records: [], total: 0 }) });

async function run(args, reg = registry(record(CC_BY))) {
  const out = [];
  const code = await main([...args, '--today', '2026-10-20'], { log: (s) => out.push(s), err: (s) => out.push(s), registry: reg });
  return { code, text: out.join('\n') };
}

test('0 when every dataset due by today matches its record', async () => {
  const { file, dir } = planFile();
  try {
    const { code, text } = await run([file]);
    assert.equal(code, 0, text);
    assert.match(text, /1 of 1 datasets confirmed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('1 when a record disagrees, with the disagreement in the report', async () => {
  const { file, dir } = planFile();
  try {
    const { code, text } = await run([file], registry(record([{ rightsIdentifier: 'cc0-1.0' }])));
    assert.equal(code, 1);
    assert.match(text, /✗ Licence: the plan says CC-BY-4.0, the record says cc0-1.0/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a planned dataset passes, and fails only with --strict', async () => {
  const { file, dir } = planFile((p) => { p.dmp.dataset[0].distribution[0].issued = '2027-01-01'; });
  try {
    assert.equal((await run([file], registry(null))).code, 0);
    assert.equal((await run([file, '--strict'], registry(null))).code, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('1 for an invalid plan, even offline', async () => {
  const { file, dir } = planFile((p) => { p.dmp.contact.mbox = ''; });
  try {
    const { code, text } = await run([file, '--offline']);
    assert.equal(code, 1);
    assert.match(text, /dmp\.contact\.mbox: is required/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('2 for usage errors, 3 when the registry cannot be read', async () => {
  assert.equal((await run(['/nonexistent/dmp.json'])).code, 2);
  assert.deepEqual(parseArgs(['--format', 'xml']), { error: 'unknown format xml' });
  assert.deepEqual(parseArgs(['--bogus']), { error: 'unknown option --bogus' });
  assert.equal(parseArgs(['--today', 'tomorrow']).error, '--today needs a date as YYYY-MM-DD');
  const { file, dir } = planFile();
  try {
    const down = { record: async () => { throw new RegistryError('err.network', { host: 'api.datacite.org' }); }, byAward: async () => ({ records: [], total: 0 }) };
    const { code, text } = await run([file], down);
    assert.equal(code, 3);
    assert.match(text, /api\.datacite\.org could not be reached/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('json output carries the problems and the result', async () => {
  const { file, dir } = planFile();
  try {
    const { text } = await run([file, '--format', 'json']);
    const j = JSON.parse(text);
    assert.deepEqual(Object.keys(j), ['file', 'problems', 'plan', 'datasets', 'unlisted', 'summary']);
    assert.equal(j.file.endsWith('dmp.json'), true, 'the path is not overwritten by the plan-level checks');
    assert.equal(j.datasets[0].verdict, 'evidenced');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('failed() reads errors, failing claims and --strict', () => {
  const r = (failing, pending) => ({ summary: { failing, pending } });
  assert.equal(failed(r(0, 0), [], false), false);
  assert.equal(failed(r(1, 0), [], false), true);
  assert.equal(failed(r(0, 2), [], false), false);
  assert.equal(failed(r(0, 2), [], true), true);
  assert.equal(failed(r(0, 0), [{ severity: 'error' }], false), true);
  assert.equal(failed(r(0, 0), [{ severity: 'warning' }], false), false);
});

test('neither the CLI nor the page lets the checked plan overwrite the plan-level checks', async () => {
  // A result's `plan` is the list of plan-level checks. Spreading the result and then setting
  // `plan` to the plan itself hid the DOI-of-the-plan check on the page and broke its report.
  const { readFileSync } = await import('node:fs');
  for (const f of ['../src/app.js', '../bin/dmp-check.mjs']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.equal(/\.\.\.result[^}]*\bplan:/.test(src), false, `${f} overwrites result.plan`);
  }
});
