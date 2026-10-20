// Holding a plan to the registry its datasets are deposited in.
//
// A plan says what will be shared, when, under what licence and with what identifier; the
// DOI registry shows what was. This module reads a "registry view" and reports, per dataset,
// whether each machine-checkable statement in the plan is visible in the dataset's DOI record.
// It is the distinction the maDMP literature draws between a plan that *mentions* something
// and one that expresses it in a form a machine can act on, taken one step further: whether
// the thing expressed exists.
//
// What is a claim and what is only a plan is decided by the plan's own dates, not by a status
// this tool invents. A dataset whose `issued` date has passed is said to be published, so its
// DOI must resolve and its record must agree with the plan; a dataset whose date is in the
// future, or that has none, is planned, and the same checks are reported without failing.
//
// A registry view is anything with this shape, which is what lets the same checks run in the
// browser and the CLI against DataCite (datacite.js) and in the tests against fixtures:
//
//   {
//     source:  'datacite' | 'fixture',
//     record:  async (doi) => record | null        record: see recordOf() in datacite.js
//     byAward: async (award) => { records, total }
//     agency:  async (doi) => 'Crossref' | 'DataCite' | … | null    null: the DOI does not exist
//   }
//
// Pure apart from the view. `today` is passed in, never taken from the clock, so a test of a
// date means the same thing next year.

import { requiredQuestions } from './requirements.js?v=21';
import { datasetDoi, fundrefNumber, isLocalId, issuedOf, licenceKey, licenceSpdx, normaliseDoi, normaliseOrcid } from './plan.js?v=21';

/** What a single check found. `declared`: the plan says it, the record cannot confirm or refute it. */
export const OUTCOMES = Object.freeze(['evidenced', 'missing', 'pending', 'declared']);

/** The verdict for a whole dataset, from its checks. */
export const VERDICTS = Object.freeze(['evidenced', 'missing', 'pending', 'declared']);

/** Whether a dataset's statements are claims (published per the plan) or intentions. */
export const PHASES = Object.freeze(['published', 'planned', 'undated']);

const given = (v) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
const lower = (s) => String(s ?? '').toLowerCase();

export function phaseOf(ds, today) {
  const issued = issuedOf(ds);
  if (!issued) return 'undated';
  return issued <= today ? 'published' : 'planned';
}

// ── reading a record ────────────────────────────────────────────────────────

/** The access a record states, from the info:eu-repo vocabulary DataCite records carry. */
export function recordAccess(record) {
  for (const r of record.rights) {
    const m = /info:eu-repo\/semantics\/(open|embargoed|restricted|closed|metadataOnly)Access/i.exec(r?.rightsUri ?? '');
    if (m) return m[1].toLowerCase().replace('metadataonly', 'closed');
  }
  return null;
}

/** The licences a record states, as comparable keys and SPDX ids. */
export function recordLicences(record) {
  const out = [];
  for (const r of record.rights) {
    if (/info:eu-repo/i.test(r?.rightsUri ?? '')) continue;
    const spdx = given(r?.rightsIdentifier) ? String(r.rightsIdentifier) : licenceSpdx(r?.rightsUri);
    out.push({ key: given(r?.rightsUri) ? licenceKey(r.rightsUri) : null, spdx: spdx ? spdx.toLowerCase() : null, label: r?.rightsIdentifier || r?.rightsUri || r?.rights });
  }
  return out.filter((l) => l.key || l.spdx);
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
};

/** File-extension and MIME spellings of a format, so `text/csv` and `CSV` compare equal. */
export function formatKey(s) {
  const v = lower(s).trim().replace(/;.*$/, '');
  const ALIASES = {
    csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', xml: 'application/xml',
    txt: 'text/plain', pdf: 'application/pdf', zip: 'application/zip', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    parquet: 'application/vnd.apache.parquet', nc: 'application/x-netcdf', netcdf: 'application/x-netcdf',
    tif: 'image/tiff', tiff: 'image/tiff', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  };
  const bare = v.replace(/^\./, '');
  return ALIASES[bare] ?? v;
}

// ── the checks ──────────────────────────────────────────────────────────────

/**
 * Each check returns `{ outcome, detail, vars }` or null when it does not apply to what the
 * plan says. `detail` is an i18n key under `det.`. A check sees the dataset, its record (null
 * when the DOI did not resolve), the plan, and today.
 */
const ok = (detail, vars = {}) => ({ outcome: 'evidenced', detail, vars });
const miss = (detail, vars = {}) => ({ outcome: 'missing', detail, vars });
const said = (detail, vars = {}) => ({ outcome: 'declared', detail, vars });

const firstDist = (ds) => (Array.isArray(ds.distribution) ? ds.distribution[0] : null) ?? {};

/** Grant numbers and funder ids the plan's projects declare. */
export function planGrants(plan) {
  const out = [];
  for (const pr of plan?.dmp?.project ?? [])
    for (const f of pr?.funding ?? [])
      if (given(f?.grant_id?.identifier)) out.push({ grant: String(f.grant_id.identifier).trim(), funder: f?.funder_id?.identifier ?? null });
  return out;
}

/** Whether a record's funding names a grant: by award number, or by award URI. */
function fundingNames(record, grant) {
  const g = lower(grant).replace(/\/+$/, '');
  return record.funding.some((f) => {
    const n = lower(f?.awardNumber).trim();
    const uri = lower(f?.awardUri).replace(/\/+$/, '');
    return (n && (n === g || g.endsWith(`/${n}`))) || (uri && uri === g);
  });
}

export const DATASET_CHECKS = [
  ['ds.pid', (ds, rec, ctx) => {
    if (ctx.closed && !datasetDoi(ds)) return said('det.closedNoDoi');
    if (!datasetDoi(ds)) {
      const type = ds.dataset_id?.type;
      if (given(type) && type !== 'other' && given(ds.dataset_id.identifier)) return said('det.notDoi', { type });
      return miss('det.noDoi');
    }
    // Not at DataCite: registered elsewhere is not missing, but its record is not read.
    if (!rec && ctx.agency) return said('det.doiElsewhere', { doi: datasetDoi(ds), agency: ctx.agency });
    if (!rec) return miss('det.doiNotFound', { doi: datasetDoi(ds) });
    if (rec.state && rec.state !== 'findable') return miss('det.doiNotFindable', { doi: rec.doi, state: rec.state });
    return ok('det.doiFound', { doi: rec.doi, publisher: rec.publisher ?? rec.client ?? '?' });
  }],

  ['ds.access', (ds, rec, ctx) => {
    const planned = firstDist(ds).data_access;
    if (!given(planned) || !rec) return null;
    const found = recordAccess(rec);
    if (!found) return said('det.accessUnstated', { planned });
    // shared in maDMP is access on conditions: restricted, or open after an embargo.
    const fits = { open: ['open'], shared: ['restricted', 'embargoed'], closed: ['closed', 'restricted'] }[planned] ?? [];
    if (fits.includes(found)) return ok('det.accessMatch', { found });
    if (planned === 'open' && found === 'embargoed') {
      // Only an Available date says when an embargo ends; the issue date does not.
      const until = rec.dates.find((d) => lower(d?.dateType) === 'available')?.date?.slice(0, 10);
      return miss(until ? 'det.embargoed' : 'det.embargoedOpen', until ? { until } : {});
    }
    return miss('det.accessMismatch', { planned, found });
  }],

  ['ds.licence', (ds, rec) => {
    const lic = (firstDist(ds).license ?? []).find((l) => given(l?.license_ref));
    if (!lic || !rec) return null;
    const found = recordLicences(rec);
    if (!found.length) return miss('det.noLicenceOnRecord', { planned: licenceSpdx(lic.license_ref) ?? lic.license_ref });
    const key = licenceKey(lic.license_ref);
    const spdx = lower(licenceSpdx(lic.license_ref));
    const hit = found.find((f) => f.key === key || (spdx && f.spdx === spdx));
    return hit
      ? ok('det.licenceMatch', { found: hit.label })
      : miss('det.licenceMismatch', { planned: licenceSpdx(lic.license_ref) ?? lic.license_ref, found: found.map((f) => f.label).join(', ') });
  }],

  ['ds.host', (ds, rec) => {
    const url = firstDist(ds).host?.url;
    if (!given(url) || !rec) return null;
    const want = hostOf(url);
    const got = rec.url ? hostOf(rec.url) : null;
    if (!want) return said('det.hostUnreadable', { url });
    if (!got) return said('det.noLandingPage');
    return got === want || got.endsWith(`.${want}`) ? ok('det.hostMatch', { host: got }) : miss('det.hostMismatch', { planned: want, found: got });
  }],

  ['ds.format', (ds, rec) => {
    const formats = (firstDist(ds).format ?? []).filter(given);
    if (!formats.length || !rec) return null;
    if (!rec.formats.length) return said('det.formatsUnstated');
    const have = new Set(rec.formats.map(formatKey));
    const lacking = formats.filter((f) => !have.has(formatKey(f)));
    return lacking.length ? miss('det.formatsMissing', { formats: lacking.join(', '), found: rec.formats.join(', ') }) : ok('det.formatsMatch', { formats: formats.join(', ') });
  }],

  ['ds.funding', (ds, rec, ctx) => {
    if (!ctx.grants.length || !rec) return null;
    const named = ctx.grants.filter((g) => fundingNames(rec, g.grant));
    if (named.length) return ok('det.grantNamed', { grant: named.map((g) => g.grant).join(', ') });
    if (!rec.funding.length) return miss('det.noFunding', { grant: ctx.grants.map((g) => g.grant).join(', ') });
    // The record names a funder of the plan, but not the grant: worth saying apart.
    const funders = ctx.grants.map((g) => fundrefNumber(g.funder)).filter(Boolean);
    const sameFunder = rec.funding.some((f) => funders.includes(fundrefNumber(f?.funderIdentifier)));
    return miss(sameFunder ? 'det.grantNotNamed' : 'det.otherFunding', { grant: ctx.grants.map((g) => g.grant).join(', '), found: rec.funding.map((f) => f?.awardNumber || f?.funderName).filter(Boolean).join(', ') });
  }],

  ['ds.creators', (ds, rec) => {
    const orcids = (ds.creator ?? []).flatMap((c) => [c?.creator_id].flat()).filter((id) => id?.type === 'orcid').map((id) => normaliseOrcid(id.identifier)).filter(Boolean);
    if (!orcids.length || !rec) return null;
    const have = new Set(rec.creators.flatMap((c) => (c?.nameIdentifiers ?? []).map((n) => normaliseOrcid(n?.nameIdentifier))).filter(Boolean));
    const lacking = orcids.filter((o) => !have.has(o));
    return lacking.length ? miss('det.creatorsMissing', { orcids: lacking.join(', ') }) : ok('det.creatorsMatch', { n: orcids.length });
  }],
];

export const PLAN_CHECKS = [
  ['dmp.id', async (plan, view) => {
    const id = plan?.dmp?.dmp_id;
    if (!given(id?.identifier) || isLocalId(id)) return null;
    if (id.type !== 'doi') return said('det.dmpIdNotDoi', { type: id.type });
    const doi = normaliseDoi(id.identifier);
    const rec = await view.record(doi);
    if (rec) return ok('det.dmpDoiFound', { doi: rec.doi, type: rec.resourceTypeGeneral ?? '?' });
    const agency = view.agency ? await view.agency(doi) : null;
    return agency ? ok('det.dmpDoiElsewhere', { doi, agency }) : miss('det.dmpDoiNotFound', { doi });
  }],
];

export const CHECK_IDS = Object.freeze([...PLAN_CHECKS, ...DATASET_CHECKS].map(([id]) => id));

/** Combine a dataset's check results into one verdict. */
export function verdictOf(results) {
  const outs = results.map((r) => r.outcome);
  if (outs.includes('missing')) return 'missing';
  if (outs.includes('pending')) return 'pending';
  if (outs.includes('evidenced')) return 'evidenced';
  return 'declared';
}

/**
 * Deposits that cite one of the plan's grants and that the plan does not list: outputs the
 * plan has fallen behind. A deposit counts as listed when its DOI, or a DOI it is a version
 * of, is in the plan; versions of one unlisted deposit are reported once, by their concept.
 * Informative only: a plan is not wrong for a deposit someone else made under the same grant.
 */
export async function unlistedDeposits(plan, view) {
  const listed = new Set((plan?.dmp?.dataset ?? []).map(datasetDoi).filter(Boolean).map(lower));
  const out = [];
  for (const { grant } of planGrants(plan)) {
    const { records, total } = await view.byAward(grant);
    const groups = depositGroups(records);
    const deposits = groups
      .filter((g) => !g.members.some((d) => listed.has(d)))
      .map(({ head: r }) => ({ doi: r.doi, type: r.resourceTypeGeneral, year: r.publicationYear, publisher: r.publisher }));
    out.push({ grant, total, read: records.length, deposits });
  }
  return out;
}

/**
 * Records grouped into deposits: versions of one work and identical copies of it are one
 * deposit. Repositories say so differently (Zenodo with IsVersionOf and HasVersion, Figshare
 * with IsIdenticalTo between a DOI and its .v1), so all three link records here. Each group
 * keeps every DOI it touches, including related ones outside the result, so that a plan that
 * lists any version counts as listing the deposit; its `head` is the record nothing else in the
 * group is a version or copy of, which is the concept DOI where there is one.
 */
export function depositGroups(records) {
  const LINKS = new Set(['IsVersionOf', 'HasVersion', 'IsIdenticalTo']);
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
  const union = (a, b) => { add(a); add(b); parent.set(find(a), find(b)); };
  const links = (r) => r.related.filter((x) => LINKS.has(x?.relationType) && given(x?.relatedIdentifier));
  for (const r of records) {
    add(r.doi);
    for (const x of links(r)) union(r.doi, lower(x.relatedIdentifier));
  }
  const byRoot = new Map();
  for (const x of parent.keys()) {
    const root = find(x);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(x);
  }
  const groups = [];
  for (const members of byRoot.values()) {
    const inResult = records.filter((r) => members.includes(r.doi));
    if (!inResult.length) continue;
    const isChild = (r) => r.related.some((x) => (x?.relationType === 'IsVersionOf' || x?.relationType === 'IsIdenticalTo') && members.includes(lower(x.relatedIdentifier)));
    groups.push({ head: inResult.find((r) => !isChild(r)) ?? inResult[0], members });
  }
  return groups;
}

/**
 * Check every dataset in the plan, and the plan's own identifier, against the registry view.
 * Returns `{ plan: [...checks], datasets: [{ index, title, doi, phase, issued, verdict, checks }], unlisted, summary }`.
 */
export async function checkPlan(plan, view, { today = new Date().toISOString().slice(0, 10), unlisted = true } = {}) {
  const planChecks = [];
  for (const [id, fn] of PLAN_CHECKS) {
    const res = await fn(plan, view);
    if (res) planChecks.push({ id, ...res });
  }
  const grants = planGrants(plan);
  const datasets = [];
  for (const [index, ds] of (plan?.dmp?.dataset ?? []).entries()) {
    const phase = phaseOf(ds, today);
    const doi = datasetDoi(ds);
    const rec = doi ? await view.record(doi) : null;
    const agency = doi && !rec && view.agency ? await view.agency(doi) : null;
    const ctx = { today, grants, agency, closed: firstDist(ds).data_access === 'closed' };
    const checks = [];
    for (const [id, fn] of DATASET_CHECKS) {
      const res = fn(ds, rec, ctx);
      if (!res) continue;
      // A dataset that is not yet due is reported, not failed: the plan is allowed to be ahead
      // of the registry, and an undated one has made no claim about when.
      const outcome = res.outcome === 'missing' && phase !== 'published' ? 'pending' : res.outcome;
      checks.push({ id, outcome, detail: res.detail, vars: res.vars });
    }
    datasets.push({ index, title: ds?.title ?? '', doi, phase, issued: issuedOf(ds), verdict: verdictOf(checks), checks });
  }
  const extra = unlisted ? await unlistedDeposits(plan, view) : [];
  return { plan: planChecks, datasets, unlisted: extra, summary: summarise(plan, planChecks, datasets, extra) };
}

/**
 * The headline numbers. `answered` is the plan-as-text level (a question has an answer);
 * `evidenced` is the plan-as-fact level (every check on a dataset passed). The distance between
 * them is the point of the tool.
 */
export function summarise(plan, planChecks, datasets, unlisted = []) {
  const answers = plan?.dmp?.actionable_dmp?.answers ?? {};
  const required = requiredQuestions(plan);
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
  for (const d of datasets) counts[d.verdict]++;
  return {
    questions: required.length,
    answered: required.filter((id) => given(answers[id])).length,
    datasets: datasets.length,
    published: datasets.filter((d) => d.phase === 'published').length,
    ...counts,
    // What a CI gate fails on: a statement about a published dataset that the registry does not show.
    failing: datasets.filter((d) => d.verdict === 'missing').length + planChecks.filter((c) => c.outcome === 'missing').length,
    unlisted: unlisted.reduce((n, g) => n + g.deposits.length, 0),
  };
}
