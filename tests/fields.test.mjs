// Required and optional: which questions a plan must answer, and every optional detail field
// read and written in the shape maDMP wants.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DATASET_FIELDS, PLAN_FIELDS, QUESTION_IDS, requiredQuestions } from '../src/requirements.js';
import { completeness, createPlan, fieldValue, finalisePlan, setFieldValue, validatePlan } from '../src/plan.js';

const NOW = new Date('2026-10-20T10:00:00Z');

function valid() {
  const p = createPlan({ title: 'T', now: NOW, uuid: 'p', datasetUuid: 'd' });
  Object.assign(p.dmp.contact, { name: 'J', mbox: 'j@example.org' });
  p.dmp.contact.contact_id.identifier = '0000-0002-1825-0097';
  p.dmp.dataset[0].title = 'Readings';
  return p;
}
const errors = (p) => validatePlan(p).filter((x) => x.severity === 'error').map((x) => `${x.path} ${x.code}`);
const field = (key) => DATASET_FIELDS.find((f) => f.key === key);

test('4a and 4c are required only when their condition holds or is unknown', () => {
  const p = valid();
  // A new plan does not know yet: unknown personal data, unknown ethics. All fifteen.
  assert.deepEqual(requiredQuestions(p), [...QUESTION_IDS]);
  p.dmp.dataset[0].personal_data = 'no';
  p.dmp.ethical_issues_exist = 'no';
  assert.deepEqual(requiredQuestions(p), QUESTION_IDS.filter((id) => id !== '4a' && id !== '4c'));
  p.dmp.dataset.push({ ...p.dmp.dataset[0], personal_data: 'yes' });
  assert.ok(requiredQuestions(p).includes('4a'));
  assert.ok(!requiredQuestions(p).includes('4c'));
});

test('completeness counts required questions only, and is apart from validity', () => {
  const p = valid();
  p.dmp.dataset[0].personal_data = 'no';
  p.dmp.ethical_issues_exist = 'no';
  for (const id of QUESTION_IDS) if (id !== '4a' && id !== '4c' && id !== '6b') p.dmp.actionable_dmp.answers[id] = 'x';
  assert.deepEqual(completeness(p), { required: 13, answered: 12, complete: false, missing: ['6b'] });
  assert.deepEqual(errors(p), [], 'an incomplete plan is still a valid maDMP');
  // A question that is not required gives no warning when it is blank.
  assert.deepEqual(validatePlan(p).filter((x) => x.severity === 'warning').map((x) => x.path), ['dmp.actionable_dmp.answers.6b']);
  p.dmp.actionable_dmp.answers['6b'] = 'Two weeks of staff time.';
  assert.equal(completeness(p).complete, true);
});

test('each kind of dataset field reads back what was written, in maDMP shape', () => {
  const ds = valid().dmp.dataset[0];
  const cases = [
    ['is_reused', 'yes', true, 'yes'],
    ['byte_size', '5000', 5000, '5000'],
    ['keyword', 'air, sensors ,', ['air', 'sensors'], 'air, sensors'],
    ['data_quality_assurance', 'Calibration\n\nDouble entry', ['Calibration', 'Double entry'], 'Calibration\nDouble entry'],
    ['security_and_privacy', 'Encryption\nAccess control', [{ title: 'Encryption' }, { title: 'Access control' }], 'Encryption\nAccess control'],
    ['technical_resource', 'R', [{ name: 'R' }], 'R'],
    ['certified_with', 'coretrustseal', 'coretrustseal', 'coretrustseal'],
    ['pid_system', 'doi, handle', ['doi', 'handle'], 'doi, handle'],
    ['storage_type', 'Institutional storage', 'Institutional storage', 'Institutional storage'],
  ];
  for (const [key, typed, stored, shown] of cases) {
    const fd = field(key);
    setFieldValue(ds, fd, typed);
    const at = fd.path.reduce((o, k) => o[k], ds);
    assert.deepEqual(at, stored, key);
    assert.equal(fieldValue(ds, fd), shown, key);
  }
  setFieldValue(ds, field('is_reused'), '');
  assert.equal(fieldValue(ds, field('is_reused')), '');
  setFieldValue(ds, field('byte_size'), 'lots');
  assert.equal(ds.distribution[0].byte_size, '', 'a non-number is not stored as one');
});

test('a description already on a security measure survives editing its title', () => {
  const ds = valid().dmp.dataset[0];
  ds.security_and_privacy = [{ title: 'Encryption', description: 'AES at rest' }];
  setFieldValue(ds, field('security_and_privacy'), 'Encryption at rest');
  assert.deepEqual(ds.security_and_privacy, [{ title: 'Encryption at rest', description: 'AES at rest' }]);
});

test('a metadata standard becomes a full maDMP metadata entry, in the plan’s language', () => {
  const p = valid();
  setFieldValue(p.dmp.dataset[0], field('metadata_standard'), 'https://schema.datacite.org/', { language: 'deu' });
  assert.deepEqual(p.dmp.dataset[0].metadata, [{ metadata_standard_id: { identifier: 'https://schema.datacite.org/', type: 'url' }, language: 'deu' }]);
  assert.deepEqual(errors(p), []);
  setFieldValue(p.dmp.dataset[0], field('metadata_standard'), '');
  assert.equal('metadata' in finalisePlan(p).dmp.dataset[0], false, 'a cleared standard leaves no half entry');
});

test('host detail without a repository named is an error, not silently dropped', () => {
  const p = valid();
  setFieldValue(p.dmp.dataset[0], field('backup_frequency'), 'nightly');
  assert.deepEqual(errors(p), ['dmp.dataset[0].distribution[0].host.title val.required', 'dmp.dataset[0].distribution[0].host.url val.required']);
});

test('contributors and costs: blank rows vanish, filled ones take maDMP shape', () => {
  const p = valid();
  const contrib = PLAN_FIELDS.find((f) => f.key === 'contributor');
  const cost = PLAN_FIELDS.find((f) => f.key === 'cost');
  p.dmp.contributor = [{}, {}];
  const col = (fd, k) => fd.columns.find((c) => c.key === k);
  setFieldValue(p.dmp.contributor[0], col(contrib, 'name'), 'Example Steward');
  setFieldValue(p.dmp.contributor[0], col(contrib, 'role'), 'DataManager, ProjectLeader');
  setFieldValue(p.dmp.contributor[0], col(contrib, 'id'), 'https://orcid.org/0000-0002-1825-0097');
  p.dmp.cost = [{}];
  setFieldValue(p.dmp.cost[0], col(cost, 'title'), 'Repository fees');
  setFieldValue(p.dmp.cost[0], col(cost, 'value'), '1200.50');
  setFieldValue(p.dmp.cost[0], col(cost, 'currency_code'), 'EUR');
  const out = finalisePlan(p).dmp;
  assert.deepEqual(out.contributor, [{ name: 'Example Steward', role: ['DataManager', 'ProjectLeader'], contributor_id: { identifier: 'https://orcid.org/0000-0002-1825-0097', type: 'orcid' } }]);
  assert.deepEqual(out.cost, [{ title: 'Repository fees', value: 1200.5, currency_code: 'EUR' }]);
  assert.deepEqual(errors(p), []);
  // A contributor with a name and no identifier is incomplete in maDMP terms, and said so.
  p.dmp.contributor[0].contributor_id.identifier = '';
  assert.deepEqual(errors(p), ['dmp.contributor[0].contributor_id val.required']);
  setFieldValue(p.dmp.cost[0], col(cost, 'currency_code'), 'Euro');
  assert.ok(errors(p).includes('dmp.cost[0].currency_code val.enum'));
});
