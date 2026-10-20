// Saving versions, and what changed between two of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDataset, createPlan, currentVersion, saveVersion, setDatasetDoi, validatePlan, versionsOf } from '../src/plan.js';
import { changeText, delays, diffPlans, diffToMarkdown, matchDatasets } from '../src/diff.js';
import { t } from '../src/i18n/index.js';

function v1() {
  const p = createPlan({ title: 'DMP for AeroSense', now: new Date('2026-03-01T09:00:00Z'), uuid: 'p', datasetUuid: 'readings' });
  Object.assign(p.dmp.contact, { name: 'J', mbox: 'j@example.org' });
  p.dmp.contact.contact_id.identifier = '0000-0002-1825-0097';
  const ds = p.dmp.dataset[0];
  ds.title = 'Readings';
  ds.distribution[0].issued = '2026-06-30';
  p.dmp.dataset.push(createDataset({ uuid: 'log' }));
  p.dmp.dataset[1].title = 'Calibration log';
  p.dmp.actionable_dmp.answers['5a'] = 'Deposited at the end of year one.';
  return saveVersion(p, 'Submitted with the proposal', new Date('2026-03-01T10:00:00Z'));
}

test('saving numbers versions from 1, dates them and keeps the note', () => {
  const a = v1();
  assert.equal(currentVersion(a), 1);
  assert.deepEqual(versionsOf(a), [{ version: 1, date: '2026-03-01T10:00:00Z', note: 'Submitted with the proposal' }]);
  assert.equal(a.dmp.modified, '2026-03-01T10:00:00Z');
  const b = saveVersion(a, '', new Date('2026-09-01T10:00:00Z'));
  assert.deepEqual(versionsOf(b).map((v) => v.version), [1, 2]);
  assert.equal(versionsOf(a).length, 1, 'saving returns a copy and leaves the original alone');
  assert.deepEqual(validatePlan(b).filter((x) => x.severity === 'error'), []);
});

test('a history out of order, or with a bad date, is an error', () => {
  const a = v1();
  a.dmp.actionable_dmp.versions.push({ version: 1, date: 'yesterday' });
  assert.deepEqual(validatePlan(a).filter((x) => x.severity === 'error').map((x) => `${x.path} ${x.code}`), [
    'dmp.actionable_dmp.versions[1].version val.versionOrder', 'dmp.actionable_dmp.versions[1].date val.format.date-time',
  ]);
});

test('a dataset that got its DOI is still the same dataset in the next version', () => {
  const a = v1();
  const b = structuredClone(a);
  setDatasetDoi(b.dmp.dataset[0], '10.5281/zenodo.1');
  b.dmp.dataset[0].title = 'Sensor readings';
  const pairs = matchDatasets(a.dmp.dataset, b.dmp.dataset);
  assert.deepEqual(pairs.map(([x, y]) => [x?.title, y?.title]), [['Readings', 'Sensor readings'], ['Calibration log', 'Calibration log']]);
});

test('the changes between two versions, delays first in the Markdown', () => {
  const a = v1();
  let b = structuredClone(a);
  b.dmp.title = 'DMP for AeroSense, revised';
  b.dmp.actionable_dmp.answers['5a'] = 'Deposited at the end of year two.';
  b.dmp.actionable_dmp.answers['6b'] = 'Two weeks of staff time.';
  b.dmp.dataset[0].distribution[0].issued = '2027-01-31';
  setDatasetDoi(b.dmp.dataset[0], '10.5281/zenodo.1');
  b.dmp.dataset.splice(1, 1);
  b.dmp.dataset.push(createDataset({ uuid: 'new' }));
  b.dmp.dataset[1].title = 'Station photographs';
  b = saveVersion(b, 'Mid-term review', new Date('2026-09-01T10:00:00Z'));

  const d = diffPlans(a, b);
  assert.equal(d.from, 1);
  assert.equal(d.to, 2);
  assert.deepEqual(d.changes.map((c) => `${c.area}:${c.key}:${c.kind}`), [
    'plan:title:changed',
    'answer:5a:changed',
    'answer:6b:added',
    'dataset:doi:added',
    'dataset:issued:changed',
    'dataset:dataset:removed',
    'dataset:dataset:added',
  ]);
  assert.deepEqual(delays(d).map((c) => [c.title, c.days]), [['Readings', 215]]);
  const md = diffToMarkdown(d, t);
  assert.match(md, /^# Changes from version 1 to version 2\n\n\*\*1 publication date\(s\) moved later\*\*\n\n- Readings: 2026-06-30 → 2027-01-31, 215 days later/);
  assert.match(md, /- Dataset removed: Calibration log/);
  assert.match(md, /- Answer 6b: added “Two weeks of staff time\.”/);
});

test('identical plans have no changes; a long answer is shortened in words', () => {
  const a = v1();
  assert.deepEqual(diffPlans(a, structuredClone(a)).changes, []);
  assert.match(diffToMarkdown(diffPlans(a, a), t), /The two plans are the same/);
  const long = 'x'.repeat(300);
  const text = changeText({ area: 'answer', key: '1a', kind: 'changed', before: long, after: 'y' }, t);
  assert.ok(text.length < 300 && text.includes('…'));
});

test('contributors added between versions are listed one by one', () => {
  const a = v1();
  const b = structuredClone(a);
  b.dmp.contributor = [{ name: 'Example Steward', role: ['DataManager'], contributor_id: { identifier: 'https://example.org/s', type: 'url' } }];
  assert.deepEqual(diffPlans(a, b).changes.map((c) => `${c.key}:${c.kind}:${c.after}`), ['contributor:added:Example Steward · DataManager · https://example.org/s']);
});
