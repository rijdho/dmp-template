// Every check against a registry held in memory, with exact expected outcomes. The records are
// synthetic but take the shape api.datacite.org returned for Zenodo and Figshare deposits on
// 2026-10-20 (licence as an SPDX rightsIdentifier plus a legalcode URI, access as an
// info:eu-repo term when the repository gives one, funding with a Crossref Funder ID).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkPlan, depositGroups, formatKey, phaseOf, recordAccess, unlistedDeposits, verdictOf } from '../src/evidence.js';
import { recordOf } from '../src/datacite.js';
import { createDataset, createPlan, setDatasetDoi } from '../src/plan.js';

const TODAY = '2026-10-20';

/** A DataCite API item, as /dois/{doi} returns it under `data`. */
function item(doi, a = {}) {
  return {
    id: doi,
    relationships: { client: { data: { id: a.client ?? 'cern.zenodo' } } },
    attributes: {
      doi, state: a.state ?? 'findable', url: a.url ?? `https://zenodo.org/doi/${doi}`, publisher: a.publisher ?? 'Zenodo',
      types: { resourceTypeGeneral: a.type ?? 'Dataset' }, publicationYear: a.year ?? 2026,
      dates: a.dates ?? [{ date: '2026-10-15', dateType: 'Issued' }],
      rightsList: a.rights ?? [{ rightsIdentifier: 'cc-by-4.0', rightsUri: 'https://creativecommons.org/licenses/by/4.0/legalcode', rightsIdentifierScheme: 'SPDX' }],
      formats: a.formats ?? [], fundingReferences: a.funding ?? [], creators: a.creators ?? [], relatedIdentifiers: a.related ?? [],
    },
  };
}

/** DOIs other agencies registered, as doi.org/ra would report them. */
const AGENCIES = { '10.1038/nature12373': 'Crossref', '10.48321/d1x': 'DataCite' };

const EC = { funderIdentifierType: 'Crossref Funder ID', funderName: 'European Commission', funderIdentifier: '10.13039/501100000780', awardNumber: '101039426' };

/** A registry view over a list of items, recording what it was asked. */
function registry(items, awards = {}) {
  const byDoi = new Map(items.map((i) => [i.id.toLowerCase(), recordOf(i)]));
  const asked = [];
  return {
    asked,
    source: 'fixture',
    record: async (doi) => { asked.push(doi); return byDoi.get(doi.toLowerCase()) ?? null; },
    byAward: async (award) => { asked.push(`award:${award}`); const list = (awards[award] ?? []).map(recordOf); return { records: list, total: list.length }; },
    agency: async (doi) => { asked.push(`ra:${doi}`); return AGENCIES[doi.toLowerCase()] ?? null; },
  };
}

/** A plan with one dataset, filled as `ds` says, and the EC grant when `grant` is true. */
function planWith(ds = {}, { grant = true } = {}) {
  const p = createPlan({ title: 'T', uuid: 'p', datasetUuid: 'd' });
  if (grant) {
    p.dmp.project[0].title = 'Project';
    p.dmp.project[0].funding[0].funder_id = { identifier: '10.13039/501100000780', type: 'fundref' };
    p.dmp.project[0].funding[0].grant_id = { identifier: '101039426', type: 'other' };
  } else delete p.dmp.project;
  const d = p.dmp.dataset[0];
  d.title = 'Readings';
  if (ds.doi) setDatasetDoi(d, ds.doi);
  const x = d.distribution[0];
  Object.assign(x, { issued: ds.issued ?? '2026-10-15', data_access: ds.access ?? 'open', format: ds.format ?? [] });
  x.license[0].license_ref = ds.licence ?? 'https://creativecommons.org/licenses/by/4.0/';
  x.host = ds.host === undefined ? { title: 'Zenodo', url: 'https://zenodo.org' } : ds.host;
  if (ds.creator) d.creator = ds.creator;
  return p;
}

const outcomes = (result, i = 0) => Object.fromEntries(result.datasets[i].checks.map((c) => [c.id, `${c.outcome} ${c.detail}`]));

test('a published dataset whose record agrees on everything is confirmed', async () => {
  const r = await checkPlan(planWith({ doi: '10.5281/zenodo.1' }), registry([item('10.5281/zenodo.1', { funding: [EC] })]), { today: TODAY });
  assert.deepEqual(outcomes(r), {
    'ds.pid': 'evidenced det.doiFound',
    'ds.access': 'declared det.accessUnstated',
    'ds.licence': 'evidenced det.licenceMatch',
    'ds.host': 'evidenced det.hostMatch',
    'ds.funding': 'evidenced det.grantNamed',
  });
  assert.equal(r.datasets[0].verdict, 'evidenced');
  assert.equal(r.datasets[0].phase, 'published');
  assert.equal(r.summary.failing, 0);
});

test('each disagreement is named, and fails a published dataset', async () => {
  const rec = item('10.5281/zenodo.2', {
    url: 'https://figshare.com/x', rights: [{ rightsUri: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode', rightsIdentifier: 'cc0-1.0' }, { rightsUri: 'info:eu-repo/semantics/closedAccess' }],
    formats: ['application/json'], funding: [{ ...EC, awardNumber: '999' }],
  });
  const r = await checkPlan(planWith({ doi: '10.5281/zenodo.2', format: ['text/csv'] }), registry([rec]), { today: TODAY });
  assert.deepEqual(outcomes(r), {
    'ds.pid': 'evidenced det.doiFound',
    'ds.access': 'missing det.accessMismatch',
    'ds.licence': 'missing det.licenceMismatch',
    'ds.host': 'missing det.hostMismatch',
    'ds.format': 'missing det.formatsMissing',
    'ds.funding': 'missing det.grantNotNamed',
  });
  assert.equal(r.summary.failing, 1, 'one dataset failing, however many checks it fails');
});

test('the same disagreements on a planned dataset are pending, not failures', async () => {
  const rec = item('10.5281/zenodo.2', { url: 'https://figshare.com/x' });
  const r = await checkPlan(planWith({ doi: '10.5281/zenodo.2', issued: '2027-01-01' }), registry([rec]), { today: TODAY });
  assert.equal(outcomes(r)['ds.host'], 'pending det.hostMismatch');
  assert.equal(r.datasets[0].verdict, 'pending');
  assert.equal(r.datasets[0].phase, 'planned');
  assert.equal(r.summary.failing, 0);
});

test('the date decides: due today is a claim, tomorrow is a plan, none is undated', () => {
  const ds = (issued) => planWith({ issued }).dmp.dataset[0];
  assert.equal(phaseOf(ds('2026-10-20'), TODAY), 'published');
  assert.equal(phaseOf(ds('2026-10-21'), TODAY), 'planned');
  assert.equal(phaseOf(ds(''), TODAY), 'undated');
  // The dataset's own issued date counts when its distribution has none.
  const d = ds('');
  d.issued = '2025-01-01';
  assert.equal(phaseOf(d, TODAY), 'published');
});

test('identifiers: no DOI, an unknown DOI, a Handle, a draft, and closed data', async () => {
  const run = async (ds, items = []) => outcomes(await checkPlan(planWith(ds, { grant: false }), registry(items), { today: TODAY }))['ds.pid'];
  assert.equal(await run({}), 'missing det.noDoi');
  assert.equal(await run({ issued: '2027-01-01' }), 'pending det.noDoi');
  assert.equal(await run({ doi: '10.5281/zenodo.404' }), 'missing det.doiNotFound');
  // A DOI another agency registered exists; its record is just not one this tool reads.
  assert.equal(await run({ doi: '10.1038/nature12373' }), 'declared det.doiElsewhere');
  assert.equal(await run({ doi: '10.5281/zenodo.3' }, [item('10.5281/zenodo.3', { state: 'draft' })]), 'missing det.doiNotFindable');
  assert.equal(await run({ access: 'closed' }), 'declared det.closedNoDoi');
  const p = planWith({}, { grant: false });
  p.dmp.dataset[0].dataset_id = { identifier: '11353/10.923628', type: 'handle' };
  assert.equal(outcomes(await checkPlan(p, registry([]), { today: TODAY }))['ds.pid'], 'declared det.notDoi');
});

test('access: the maDMP terms against the info:eu-repo ones', async () => {
  const run = async (access, term) => outcomes(await checkPlan(planWith({ doi: '10.1231/a', access }, { grant: false }),
    registry([item('10.1231/a', { rights: [{ rightsUri: `info:eu-repo/semantics/${term}Access` }, { rightsIdentifier: 'cc-by-4.0' }], dates: [{ date: '2027-03-01', dateType: 'Available' }] })]), { today: TODAY }))['ds.access'];
  assert.equal(await run('open', 'open'), 'evidenced det.accessMatch');
  assert.equal(await run('open', 'embargoed'), 'missing det.embargoed');
  assert.equal(await run('shared', 'restricted'), 'evidenced det.accessMatch');
  assert.equal(await run('shared', 'embargoed'), 'evidenced det.accessMatch');
  assert.equal(await run('closed', 'closed'), 'evidenced det.accessMatch');
  assert.equal(await run('closed', 'open'), 'missing det.accessMismatch');
  assert.equal(recordAccess(recordOf(item('x', { rights: [{ rightsUri: 'info:eu-repo/semantics/metadataOnlyAccess' }] }))), 'closed');
  // An embargo with no Available date has no known end; the issue date is not one.
  const noEnd = await checkPlan(planWith({ doi: '10.1231/e' }, { grant: false }),
    registry([item('10.1231/e', { rights: [{ rightsUri: 'info:eu-repo/semantics/embargoedAccess' }, { rightsIdentifier: 'cc-by-4.0' }] })]), { today: TODAY });
  assert.equal(outcomes(noEnd)['ds.access'], 'missing det.embargoedOpen');
});

test('licence: a record with none, and one written another way', async () => {
  const none = item('10.1231/b', { rights: [{ rightsUri: 'info:eu-repo/semantics/openAccess' }] });
  const r1 = await checkPlan(planWith({ doi: '10.1231/b' }, { grant: false }), registry([none]), { today: TODAY });
  assert.equal(outcomes(r1)['ds.licence'], 'missing det.noLicenceOnRecord');
  const other = item('10.1231/c', { rights: [{ rightsUri: 'http://creativecommons.org/licenses/by/4.0' }] });
  const r2 = await checkPlan(planWith({ doi: '10.1231/c' }, { grant: false }), registry([other]), { today: TODAY });
  assert.equal(outcomes(r2)['ds.licence'], 'evidenced det.licenceMatch');
});

test('funding: no funding on the record, another funder, and a grant given as a URL', async () => {
  const run = async (funding, grant) => {
    const p = planWith({ doi: '10.1231/f' });
    if (grant) p.dmp.project[0].funding[0].grant_id = { identifier: grant, type: 'url' };
    return outcomes(await checkPlan(p, registry([item('10.1231/f', { funding })]), { today: TODAY }))['ds.funding'];
  };
  assert.equal(await run([]), 'missing det.noFunding');
  assert.equal(await run([{ funderIdentifier: '10.13039/100000001', awardNumber: '1234' }]), 'missing det.otherFunding');
  assert.equal(await run([EC], 'https://cordis.europa.eu/project/id/101039426'), 'evidenced det.grantNamed');
});

test('formats and creators compare by meaning, not spelling', async () => {
  assert.equal(formatKey('CSV'), formatKey('text/csv'));
  assert.equal(formatKey('.json'), 'application/json');
  const p = planWith({ doi: '10.1231/g', format: ['text/csv'] }, { grant: false });
  p.dmp.dataset[0].creator = [{ name: 'J', creator_id: { identifier: 'https://orcid.org/0000-0002-1825-0097', type: 'orcid' } }];
  const rec = item('10.1231/g', { formats: ['CSV'], creators: [{ name: 'J', nameIdentifiers: [{ nameIdentifier: 'https://orcid.org/0000-0002-1825-0097', nameIdentifierScheme: 'ORCID' }] }] });
  const o = outcomes(await checkPlan(p, registry([rec]), { today: TODAY }));
  assert.equal(o['ds.format'], 'evidenced det.formatsMatch');
  assert.equal(o['ds.creators'], 'evidenced det.creatorsMatch');
});

test('the plan’s own DOI is looked up when it has one', async () => {
  const p = planWith({ doi: '10.1231/a' }, { grant: false });
  p.dmp.dmp_id = { identifier: '10.48321/D1X', type: 'doi' };
  const r = await checkPlan(p, registry([item('10.1231/a'), item('10.48321/D1X', { type: 'OutputManagementPlan' })]), { today: TODAY });
  assert.deepEqual(r.plan.map((c) => `${c.id} ${c.outcome} ${c.detail}`), ['dmp.id evidenced det.dmpDoiFound']);
  p.dmp.dmp_id.identifier = '10.48321/NOPE';
  const r2 = await checkPlan(p, registry([item('10.1231/a')]), { today: TODAY });
  assert.equal(r2.summary.failing, 1);
  // A plan DOI from Crossref, a Handle, and no identifier at all.
  p.dmp.dmp_id = { identifier: '10.1038/nature12373', type: 'doi' };
  assert.equal((await checkPlan(p, registry([item('10.1231/a')]), { today: TODAY })).plan[0].detail, 'det.dmpDoiElsewhere');
  p.dmp.dmp_id = { identifier: '11353/10.923628', type: 'handle' };
  assert.equal((await checkPlan(p, registry([item('10.1231/a')]), { today: TODAY })).plan[0].detail, 'det.dmpIdNotDoi');
  p.dmp.dmp_id = { identifier: 'urn:uuid:x', type: 'other' };
  assert.deepEqual((await checkPlan(p, registry([item('10.1231/a')]), { today: TODAY })).plan, []);
});

test('every record is asked for once, and nothing is asked without a DOI or a grant', async () => {
  const p = planWith({ doi: '10.1231/a' }, { grant: false });
  p.dmp.dataset.push(createDataset({ uuid: 'x' }));
  const reg = registry([item('10.1231/a')]);
  await checkPlan(p, reg, { today: TODAY });
  assert.deepEqual(reg.asked, ['10.1231/a']);
  // doi.org is asked only about a DOI DataCite does not hold.
  const reg2 = registry([]);
  await checkPlan(planWith({ doi: '10.1038/nature12373' }, { grant: false }), reg2, { today: TODAY });
  assert.deepEqual(reg2.asked, ['10.1038/nature12373', 'ra:10.1038/nature12373']);
});

test('unlisted deposits: versions and identical copies count once, a listed version covers its deposit', async () => {
  const records = [
    item('10.5281/zenodo.10', { related: [{ relationType: 'HasVersion', relatedIdentifier: '10.5281/zenodo.11' }] }),
    item('10.5281/zenodo.11', { related: [{ relationType: 'IsVersionOf', relatedIdentifier: '10.5281/zenodo.10' }] }),
    item('10.6084/m9.figshare.7', {}),
    item('10.6084/m9.figshare.7.v1', { related: [{ relationType: 'IsIdenticalTo', relatedIdentifier: '10.6084/m9.figshare.7' }] }),
    item('10.5281/zenodo.21', { related: [{ relationType: 'IsVersionOf', relatedIdentifier: '10.5281/zenodo.20' }] }),
  ].map(recordOf);
  assert.deepEqual(depositGroups(records).map((g) => g.head.doi), ['10.5281/zenodo.10', '10.6084/m9.figshare.7', '10.5281/zenodo.21']);

  const p = planWith({ doi: '10.5281/zenodo.11' });
  const reg = registry([], { 101039426: [
    item('10.5281/zenodo.10', { related: [{ relationType: 'HasVersion', relatedIdentifier: '10.5281/zenodo.11' }] }),
    item('10.5281/zenodo.11', { related: [{ relationType: 'IsVersionOf', relatedIdentifier: '10.5281/zenodo.10' }] }),
    item('10.6084/m9.figshare.7', {}),
    item('10.6084/m9.figshare.7.v1', { related: [{ relationType: 'IsIdenticalTo', relatedIdentifier: '10.6084/m9.figshare.7' }] }),
  ] });
  const [g] = await unlistedDeposits(p, reg);
  assert.deepEqual(g.deposits.map((d) => d.doi), ['10.6084/m9.figshare.7']);
  assert.equal(g.total, 4);
  // A plan that lists the concept DOI covers its versions too.
  const [g2] = await unlistedDeposits(planWith({ doi: '10.6084/m9.figshare.7.v1' }), reg);
  assert.deepEqual(g2.deposits.map((d) => d.doi), ['10.5281/zenodo.10']);
});

test('unlisted deposits never fail a check', async () => {
  const reg = registry([item('10.1231/a', { funding: [EC] })], { 101039426: [item('10.9999/other')] });
  const r = await checkPlan(planWith({ doi: '10.1231/a' }), reg, { today: TODAY });
  assert.equal(r.summary.unlisted, 1);
  assert.equal(r.summary.failing, 0);
  const off = await checkPlan(planWith({ doi: '10.1231/a' }), reg, { today: TODAY, unlisted: false });
  assert.deepEqual(off.unlisted, []);
});

test('verdicts combine missing over pending over evidenced over declared', () => {
  const v = (...outs) => verdictOf(outs.map((outcome) => ({ outcome })));
  assert.equal(v('evidenced', 'missing', 'pending'), 'missing');
  assert.equal(v('evidenced', 'pending'), 'pending');
  assert.equal(v('declared', 'evidenced'), 'evidenced');
  assert.equal(v('declared'), 'declared');
  assert.equal(v(), 'declared');
});

test('the summary counts answers out of fifteen', async () => {
  const p = planWith({ doi: '10.1231/a' }, { grant: false });
  p.dmp.actionable_dmp.answers['1a'] = 'x';
  p.dmp.actionable_dmp.answers['9z'] = 'not a question';
  const r = await checkPlan(p, registry([item('10.1231/a')]), { today: TODAY });
  assert.deepEqual([r.summary.answered, r.summary.questions, r.summary.datasets, r.summary.published], [1, 15, 1, 1]);
});
