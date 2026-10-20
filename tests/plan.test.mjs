// Creating, validating, finalising and writing out a plan.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createDataset, createPlan, datasetDoi, editable, finalisePlan, funderIdType, fundrefNumber, isValid,
  licenceKey, licenceSpdx, normaliseDoi, orcidChecksumOk, parsePlan, planToJson, planToMarkdown, setDatasetDoi,
  stamp, validatePlan, typedIdentifier, identifierAs,
} from '../src/plan.js';
import { QUESTION_IDS } from '../src/requirements.js';
import { t } from '../src/i18n/index.js';

const NOW = new Date('2026-10-20T10:00:00Z');
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** A plan that is valid: every field maDMP requires filled, nothing answered. */
function valid() {
  const p = createPlan({ title: 'DMP for Example', now: NOW, uuid: 'u-plan', datasetUuid: 'u-ds' });
  Object.assign(p.dmp.contact, { name: 'Josiah Carberry', mbox: 'j@example.org' });
  p.dmp.contact.contact_id.identifier = '0000-0002-1825-0097';
  p.dmp.dataset[0].title = 'Readings';
  return p;
}

const codes = (plan, severity = 'error') => validatePlan(plan).filter((p) => p.severity === severity).map((p) => `${p.path} ${p.code}`);

test('a new plan carries every question unanswered, one dataset and local identifiers', () => {
  const p = createPlan({ now: NOW, uuid: 'a', datasetUuid: 'b' });
  assert.deepEqual(Object.keys(p.dmp.actionable_dmp.answers), [...QUESTION_IDS]);
  assert.equal(QUESTION_IDS.length, 15);
  assert.deepEqual(p.dmp.dmp_id, { identifier: 'urn:uuid:a', type: 'other' });
  assert.deepEqual(p.dmp.dataset[0].dataset_id, { identifier: 'urn:uuid:b', type: 'other' });
  assert.equal(p.dmp.created, '2026-10-20T10:00:00Z');
  assert.equal(p.dmp.actionable_dmp.guide.doi, '10.5281/zenodo.4915861');
});

test('a blank plan fails exactly on what a person has to type', () => {
  assert.deepEqual(codes(createPlan({ now: NOW })), [
    'dmp.title val.required', 'dmp.contact.contact_id val.required', 'dmp.contact.mbox val.required',
    'dmp.contact.name val.required', 'dmp.dataset[0].title val.required',
  ]);
});

test('unanswered questions are warnings, not errors, and one answer removes one', () => {
  const p = valid();
  assert.equal(isValid(p), true);
  assert.equal(codes(p, 'warning').length, 15);
  p.dmp.actionable_dmp.answers['1a'] = 'New data from field stations.';
  assert.equal(codes(p, 'warning').length, 14);
});

test('the written file is a valid maDMP: blanks dropped, required defaults filled', () => {
  const p = valid();
  const x = p.dmp.dataset[0].distribution[0];
  x.issued = '2027-06-30';
  x.license[0].license_ref = 'https://creativecommons.org/licenses/by/4.0/';
  const out = finalisePlan(p);
  const dist = out.dmp.dataset[0].distribution[0];
  assert.equal(dist.title, 'Readings', 'a distribution takes its dataset’s title');
  assert.deepEqual(dist.license, [{ license_ref: 'https://creativecommons.org/licenses/by/4.0/', start_date: '2027-06-30' }]);
  assert.equal('host' in dist, false, 'a blank host is dropped, not written half-filled');
  assert.equal('project' in out.dmp, false, 'a project without a title is dropped');
  assert.equal(out.dmp.actionable_dmp.answers['6b'], '', 'empty answers stay as slots');
  // With no issued date the licence starts on the day the plan was created.
  x.issued = '';
  assert.equal(finalisePlan(p).dmp.dataset[0].distribution[0].license[0].start_date, '2026-10-20');
});

test('a funding entry needs a funder; a half-filled host is an error, not dropped', () => {
  const p = valid();
  p.dmp.project[0].title = 'P';
  p.dmp.project[0].funding[0].grant_id.identifier = '123';
  assert.equal('funding' in finalisePlan(p).dmp.project[0], false);
  p.dmp.dataset[0].distribution[0].host.title = 'Zenodo';
  assert.deepEqual(codes(p), ['dmp.dataset[0].distribution[0].host.url val.required']);
  p.dmp.dataset[0].distribution[0].host.url = 'zenodo.org';
  assert.deepEqual(codes(p), ['dmp.dataset[0].distribution[0].host.url val.format.url']);
});

test('identifiers are held to the form their type names', () => {
  const p = valid();
  p.dmp.contact.contact_id.identifier = '0000-0002-1825-0098';
  p.dmp.dmp_id = { identifier: 'not-a-doi', type: 'doi' };
  assert.deepEqual(codes(p), ['dmp.dmp_id.identifier val.doi', 'dmp.contact.contact_id.identifier val.orcid']);
});

test('the ORCID check digit, including X', () => {
  assert.equal(orcidChecksumOk('0000-0002-1825-0097'), true);
  assert.equal(orcidChecksumOk('https://orcid.org/0000-0002-1825-0097'), true);
  assert.equal(orcidChecksumOk('0000-0002-1694-233X'), true);
  assert.equal(orcidChecksumOk('0000-0002-1825-0098'), false);
  assert.equal(orcidChecksumOk('0000-0000-0000-0000'), false, 'the all-zero placeholder is not an iD');
});

test('the same DOI on two datasets is an error naming the first', () => {
  const p = valid();
  p.dmp.dataset.push(createDataset({ uuid: 'two' }));
  p.dmp.dataset[1].title = 'Copy';
  setDatasetDoi(p.dmp.dataset[0], 'https://doi.org/10.5281/zenodo.1');
  setDatasetDoi(p.dmp.dataset[1], '10.5281/ZENODO.1');
  assert.deepEqual(codes(p), ['dmp.dataset[1].dataset_id.identifier val.duplicateDoi']);
  assert.equal(datasetDoi(p.dmp.dataset[0]), '10.5281/zenodo.1');
  // The local identifier is kept while the DOI is set, and comes back when it is cleared.
  assert.deepEqual(p.dmp.dataset[1].alternate_identifier, [{ identifier: 'urn:uuid:two', type: 'other' }]);
  setDatasetDoi(p.dmp.dataset[1], '', 'fresh');
  assert.deepEqual(p.dmp.dataset[1].dataset_id, { identifier: 'urn:uuid:two', type: 'other' });
  assert.equal('alternate_identifier' in p.dmp.dataset[1], false);
});

test('coherence the guide asks for: personal data, ethics, open personal data', () => {
  const p = valid();
  p.dmp.dataset[0].personal_data = 'yes';
  p.dmp.ethical_issues_exist = 'yes';
  const w = codes(p, 'warning').filter((c) => !c.endsWith('val.unanswered'));
  assert.deepEqual(w, [
    'dmp.dataset[0].personal_data val.openPersonal',
    'dmp.actionable_dmp.answers.4a val.personalNeeds4a',
    'dmp.actionable_dmp.answers.4c val.ethicsNeeds4c',
  ]);
  p.dmp.dataset[0].distribution[0].data_access = 'shared';
  p.dmp.actionable_dmp.answers['4a'] = 'Consent and pseudonymisation.';
  p.dmp.ethical_issues_description = 'Human participants.';
  // A description of the issues is detail; the question itself still needs its answer.
  assert.deepEqual(codes(p, 'warning').filter((c) => !c.endsWith('val.unanswered')), ['dmp.actionable_dmp.answers.4c val.ethicsNeeds4c']);
  p.dmp.actionable_dmp.answers['4c'] = 'Reviewed by the ethics committee.';
  assert.deepEqual(codes(p, 'warning').filter((c) => !c.endsWith('val.unanswered')), []);
});

test('the extension rejects unknown questions and a foreign schema version', () => {
  const p = valid();
  p.dmp.actionable_dmp.answers['7a'] = 'x';
  p.dmp.actionable_dmp.schema_version = '9.9.9';
  assert.deepEqual(codes(p), ['dmp.actionable_dmp.schema_version val.schemaVersion', 'dmp.actionable_dmp.answers.7a val.unknownQuestion']);
});

test('a maDMP from another tool opens, gains the editor slots and loses nothing', () => {
  const rda = JSON.parse(read('fixtures/rda/ex9-dmp-long.json'));
  const e = editable(rda);
  assert.equal(Object.keys(e.dmp.actionable_dmp.answers).length, 15);
  assert.deepEqual(e.dmp.dataset.map((d) => d.title), rda.dmp.dataset.map((d) => d.title));
  assert.deepEqual(e.dmp.dataset[0].distribution.slice(1), rda.dmp.dataset[0].distribution.slice(1));
  // Without its extension a foreign plan is not wrong, only unanswered. The one error here is
  // the example's own placeholder ORCID iD, whose check digit does not hold.
  assert.deepEqual(codes(rda), ['dmp.contributor[0].contributor_id.identifier val.orcid']);
});

test('the RDA examples: one schema error in ten, and placeholder ORCID iDs in all', () => {
  // Pinned so a change in what is checked shows up here as a change in what these find.
  const found = {};
  for (const f of readdirSync(fileURLToPath(new URL('fixtures/rda/', import.meta.url))).sort())
    found[f] = codes(JSON.parse(read(`fixtures/rda/${f}`))).map((c) => c.split(' ')[1]);
  assert.equal(Object.keys(found).length, 10);
  assert.deepEqual(found['ex10-fairsharing.json'], ['val.format.url', 'val.orcid', 'val.modifiedBeforeCreated']);
  for (const [f, c] of Object.entries(found)) if (f !== 'ex10-fairsharing.json') assert.deepEqual(c, ['val.orcid'], f);
});

test('parsePlan never throws', () => {
  assert.deepEqual(parsePlan('{'), { error: 'val.notJson' });
  assert.deepEqual(parsePlan('{"smp":{}}'), { error: 'val.noRoot' });
  assert.ok(parsePlan('{"dmp":{}}').plan);
});

test('stamp moves modified and keeps created', () => {
  const p = stamp(valid(), new Date('2026-10-21T08:00:00Z'));
  assert.equal(p.dmp.created, '2026-10-20T10:00:00Z');
  assert.equal(p.dmp.modified, '2026-10-21T08:00:00Z');
  p.dmp.modified = '2026-10-19T00:00:00Z';
  assert.deepEqual(codes(p), ['dmp.modified val.modifiedBeforeCreated']);
});

test('licence URLs compare however Creative Commons is spelled', () => {
  for (const u of ['https://creativecommons.org/licenses/by/4.0/', 'http://www.creativecommons.org/licenses/by/4.0',
    'https://creativecommons.org/licenses/by/4.0/legalcode', 'https://creativecommons.org/licenses/by/4.0/legalcode.de'])
    assert.equal(licenceSpdx(u), 'CC-BY-4.0', u);
  assert.equal(licenceKey('https://creativecommons.org/licenses/by/4.0/legalcode'), 'creativecommons.org/licenses/by/4.0');
  assert.equal(licenceSpdx('https://example.org/my-licence'), null);
});

test('funder ids: type by shape, number by Crossref id', () => {
  assert.equal(funderIdType('501100000780'), 'fundref');
  assert.equal(funderIdType('10.13039/501100000780'), 'fundref');
  assert.equal(funderIdType('https://doi.org/10.13039/501100000780'), 'fundref');
  assert.equal(funderIdType('https://ror.org/00k4n6c32'), 'url');
  assert.equal(funderIdType('EC'), 'other');
  assert.equal(fundrefNumber('https://doi.org/10.13039/501100000780'), '501100000780');
  assert.equal(normaliseDoi('doi: 10.1/x'), '10.1/x');
});

test('JSON and Markdown out', () => {
  const p = valid();
  p.dmp.actionable_dmp.answers['5d'] = 'Zenodo assigns DOIs.';
  const json = JSON.parse(planToJson(p));
  assert.equal(json.$schema, 'https://rijdho.github.io/dmp-template/schema/dmp.schema.json');
  const md = planToMarkdown(p, t);
  assert.match(md, /^# DMP for Example/);
  assert.match(md, /## 5\. Data sharing and long-term preservation/);
  assert.match(md, /### 5d\. How will the application.*\n\nZenodo assigns DOIs\./);
  assert.match(md, /\| Readings \| {2}\| Open \|/);
  assert.equal((md.match(/_Not answered yet\._/g) ?? []).length, 14);
});

test('Markdown in Horizon Europe sections carries the same answers under the template headings', () => {
  const p = valid();
  p.dmp.actionable_dmp.answers['5d'] = 'Zenodo assigns DOIs.';
  const md = planToMarkdown(p, t, { layout: 'horizon' });
  assert.match(md, /## 1\. Data summary/);
  assert.match(md, /## 2\. FAIR data\n\n### 2\.1\. Making data findable, including provisions for metadata/);
  assert.match(md, /### 2\.1\. [^\n]+\n\n(?:[^#][^\n]*\n|\n|####[^\n]*\n)*#### 5d\. How will the application.*\n\nZenodo assigns DOIs\./);
  assert.match(md, /### 2\.3\. Making data interoperable\n\n_No question of Science Europe/);
  assert.match(md, /## 7\. Other issues/);
  for (const id of QUESTION_IDS) assert.equal((md.match(new RegExp(`#+ ${id}\\. `, 'g')) ?? []).length, 1, id);
  assert.equal((md.match(/_Not answered yet\._/g) ?? []).length, 14);
});

test('the two examples are valid plans with every question answered', () => {
  for (const f of ['open-data.json', 'personal-data.json']) {
    const { plan } = parsePlan(read(`../examples/${f}`));
    assert.deepEqual(validatePlan(plan), [], f);
  }
});

test('the plan’s identifier: any PID is recognised, and a chosen type wins', () => {
  assert.deepEqual(typedIdentifier('https://doi.org/10.48321/D1X'), { identifier: '10.48321/D1X', type: 'doi' });
  assert.deepEqual(typedIdentifier('10.1038/nature12373'), { identifier: '10.1038/nature12373', type: 'doi' });
  assert.deepEqual(typedIdentifier('hdl:11353/10.923628'), { identifier: '11353/10.923628', type: 'handle' });
  assert.deepEqual(typedIdentifier('https://hdl.handle.net/11353/10.923628'), { identifier: '11353/10.923628', type: 'handle' });
  assert.deepEqual(typedIdentifier('https://n2t.net/ark:/13030/m5br8st1'), { identifier: 'ark:/13030/m5br8st1', type: 'ark' });
  assert.deepEqual(typedIdentifier('https://dmponline.example.org/plans/42'), { identifier: 'https://dmponline.example.org/plans/42', type: 'url' });
  assert.deepEqual(typedIdentifier('PLAN-42'), { identifier: 'PLAN-42', type: 'other' });
  assert.equal(typedIdentifier('  '), null);
  // A person who knows better: the value is tidied for the type they chose.
  assert.deepEqual(identifierAs('https://doi.org/10.1/x', 'doi'), { identifier: '10.1/x', type: 'doi' });
  assert.deepEqual(identifierAs('https://doi.org/10.1/x', 'url'), { identifier: 'https://doi.org/10.1/x', type: 'url' });
  assert.deepEqual(identifierAs('hdl:1/2', 'handle'), { identifier: '1/2', type: 'handle' });
  assert.deepEqual(identifierAs('x', ''), { identifier: 'x', type: 'other' });
});

test('a chosen type is held to its form: a DOI must be one, a URL must be one', () => {
  const p = valid();
  p.dmp.dmp_id = identifierAs('PLAN-42', 'doi');
  assert.deepEqual(codes(p), ['dmp.dmp_id.identifier val.doi']);
  p.dmp.dmp_id = identifierAs('dmponline/plans/42', 'url');
  assert.deepEqual(codes(p), ['dmp.dmp_id.identifier val.format.url']);
  p.dmp.dmp_id = identifierAs('11353/10.923628', 'handle');
  assert.deepEqual(codes(p), []);
});
