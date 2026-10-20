// A plan: how it is created, what makes it valid, and how it is written out.
//
// Pure: no DOM, no network, no clock except where a caller passes one in. The page, the CLI
// and the tests all go through these functions, which is what lets the tests pin behaviour
// with exact expected values.
//
// The file IS a machine-actionable DMP: `dmp.json` validates against the RDA DMP Common
// Standard v1.2 as published, so any tool that reads maDMP reads it, and any maDMP exported by
// another tool can be opened and checked here. The standard says further fields "can be added
// in specific deployments", and the one this tool adds is `dmp.actionable_dmp`: the answers to
// the guide's fifteen questions and the plan's version history, which maDMP has no place for,
// and the version of this extension. Everything a machine can act on stays in the standard's
// own fields.

import { GUIDE, HE_SECTIONS, LICENCES, QUESTIONS, QUESTION_IDS, requiredQuestions } from './requirements.js?v=21';
import { MADMP_SCHEMA } from './madmp-schema.js?v=21';
import { realDate, validate } from './jsonschema.js?v=21';

export const SCHEMA_VERSION = '0.1.0';
export const SCHEMA_ID = 'https://rijdho.github.io/dmp-template/schema/dmp.schema.json';
export const EXTENSION = 'actionable_dmp';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** An empty string is how a blank form field arrives, and it means "not given". */
const given = (v) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

const DOI = /^10\.\d{4,9}\/\S+$/;

/** Strip a resolver prefix, so `https://doi.org/10.5281/x` and `10.5281/x` compare equal. */
export function normaliseDoi(value) {
  if (!given(value)) return '';
  return String(value).trim().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/i, '');
}

export const isDoi = (value) => DOI.test(normaliseDoi(value));

/** An ORCID iD without its resolver prefix, or '' when it is not one. */
export function normaliseOrcid(value) {
  const s = String(value ?? '').trim().replace(/^https?:\/\/(www\.)?orcid\.org\//i, '');
  return /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(s) ? s : '';
}

/** The ISO 7064 11,2 check digit ORCID uses, so a mistyped iD is caught before it is published. */
export function orcidChecksumOk(value) {
  const id = normaliseOrcid(value);
  if (!id) return false;
  const digits = id.replace(/-/g, '');
  let total = 0;
  for (const c of digits.slice(0, 15)) total = (total + Number(c)) * 2;
  const r = (12 - (total % 11)) % 11;
  return digits[15] === (r === 10 ? 'X' : String(r));
}

const stampOf = (now) => now.toISOString().replace(/\.\d{3}Z$/, 'Z');
const dayOf = (now) => now.toISOString().slice(0, 10);

/** A local identifier for something that has no persistent one yet, as maDMP requires one. */
const localId = (uuid) => ({ identifier: `urn:uuid:${uuid}`, type: 'other' });

const newUuid = () => globalThis.crypto.randomUUID();

/** A blank dataset with one distribution, which is what the editor shows. */
export function createDataset({ uuid = newUuid() } = {}) {
  return {
    title: '',
    type: 'dataset',
    description: '',
    dataset_id: localId(uuid),
    personal_data: 'unknown',
    sensitive_data: 'unknown',
    distribution: [{
      title: '',
      data_access: 'open',
      issued: '',
      host: { title: '', url: '' },
      license: [{ license_ref: '', start_date: '' }],
      format: [],
    }],
  };
}

/** A blank plan: the fifteen questions unanswered, one dataset, no project yet. */
export function createPlan({ title = '', now = new Date(), uuid = newUuid(), datasetUuid = newUuid() } = {}) {
  const stamp = stampOf(now);
  return {
    $schema: SCHEMA_ID,
    dmp: {
      title,
      description: '',
      language: 'eng',
      created: stamp,
      modified: stamp,
      dmp_id: localId(uuid),
      contact: { name: '', mbox: '', contact_id: { identifier: '', type: 'orcid' } },
      ethical_issues_exist: 'unknown',
      project: [{ title: '', start: '', end: '', funding: [{ funder_id: { identifier: '', type: 'fundref' }, grant_id: { identifier: '', type: 'other' }, funding_status: 'granted' }] }],
      dataset: [createDataset({ uuid: datasetUuid })],
      [EXTENSION]: {
        schema_version: SCHEMA_VERSION,
        guide: { title: GUIDE.title, doi: GUIDE.conceptDoi },
        answers: Object.fromEntries(QUESTION_IDS.map((id) => [id, ''])),
        versions: [],
      },
    },
  };
}

/**
 * The maDMP type of a funder id, from its shape. The standard suggests `fundref` (the Crossref
 * Funder Registry, as a bare number like its own example or as a 10.13039 DOI) and `url`, which
 * is what a ROR id is.
 */
export function funderIdType(identifier) {
  const s = String(identifier ?? '').trim();
  if (/^\d{6,}$/.test(s) || /^(https?:\/\/(dx\.)?doi\.org\/)?10\.13039\/\d+$/i.test(s)) return 'fundref';
  return /^https?:\/\//i.test(s) ? 'url' : 'other';
}

/** The number a Crossref Funder id comes down to, so `10.13039/501100000780` matches `501100000780`. */
export const fundrefNumber = (s) => /(?:10\.13039\/)?(\d{6,})\s*$/.exec(String(s ?? '').trim())?.[1] ?? null;

/**
 * The plan as it is written out: blank strings and empty objects dropped, and the few values
 * maDMP requires but a person should not have to type filled in from what they did type.
 *
 *  - A distribution's title defaults to its dataset's title.
 *  - A licence's start date defaults to the distribution's issued date, then the dataset's,
 *    then the day the plan was created: maDMP requires one, and "from publication" is what
 *    nearly every plan means.
 *  - A project without a title, a funding entry without a funder, and a host without a URL
 *    are dropped rather than written half-filled, because maDMP requires those fields.
 *
 * The answers to the questions stay even when empty: an unanswered question is information,
 * and the next editor should see the slot rather than wonder whether it was deleted.
 */
export function finalisePlan(plan) {
  const p = structuredClone(plan);
  const d = p.dmp ?? {};
  const created = typeof d.created === 'string' ? d.created.slice(0, 10) : '';

  for (const ds of Array.isArray(d.dataset) ? d.dataset : []) {
    if (Array.isArray(ds.metadata)) ds.metadata = ds.metadata.filter((m) => given(m?.metadata_standard_id?.identifier));
    for (const dist of Array.isArray(ds.distribution) ? ds.distribution : []) {
      if (!given(dist.title) && given(ds.title)) dist.title = ds.title;
      if (isObj(dist.host) && Object.keys(compact(dist.host)).length === 0) delete dist.host;
      if (Array.isArray(dist.license)) {
        dist.license = dist.license.filter((l) => given(l?.license_ref));
        for (const l of dist.license) if (!given(l.start_date)) l.start_date = dist.issued || ds.issued || created;
      }
    }
  }
  if (Array.isArray(d.project)) {
    for (const pr of d.project)
      if (Array.isArray(pr.funding)) pr.funding = pr.funding.filter((f) => given(f?.funder_id?.identifier));
    d.project = d.project.filter((pr) => given(pr?.title));
  }
  if (isObj(d.contact?.contact_id) && !given(d.contact.contact_id.identifier)) delete d.contact.contact_id;
  // A contributor or cost row left blank in the form is no entry at all.
  const filled = (row, keys) => keys.some((k) => given(getIn(row, k)) && !(Array.isArray(getIn(row, k)) && !getIn(row, k).length));
  if (Array.isArray(d.contributor)) {
    d.contributor = d.contributor.filter((c) => filled(c, [['name'], ['mbox'], ['role'], ['contributor_id', 'identifier']]));
    for (const c of d.contributor) if (isObj(c.contributor_id) && !given(c.contributor_id.identifier)) delete c.contributor_id;
  }
  if (Array.isArray(d.cost)) d.cost = d.cost.filter((c) => filled(c, [['title'], ['value'], ['currency_code'], ['description']]));

  const answers = d[EXTENSION]?.answers;
  const out = compact(p);
  if (isObj(answers) && isObj(out.dmp?.[EXTENSION])) out.dmp[EXTENSION].answers = { ...answers };
  // A contact left blank stays as an empty object, so validation names each missing field
  // instead of the contact as a whole.
  if (isObj(out.dmp) && isObj(d.contact) && !out.dmp.contact) out.dmp.contact = {};
  return out;
}

/** Blank strings, empty arrays and empty objects removed, at any depth. */
function compact(v) {
  if (Array.isArray(v)) return v.map(compact).filter((x) => given(x) && !(isObj(x) && !Object.keys(x).length) && !(Array.isArray(x) && !x.length));
  if (!isObj(v)) return v;
  const o = {};
  for (const [k, val] of Object.entries(v)) {
    const w = compact(val);
    if (!given(w)) continue;
    if (isObj(w) && Object.keys(w).length === 0) continue;
    if (Array.isArray(w) && w.length === 0 && k !== 'dataset') continue;
    o[k] = w;
  }
  return o;
}

/** The date a dataset is planned to be (or was) published: its distribution's, else its own. */
export const issuedOf = (ds) => ds?.distribution?.find?.((x) => given(x?.issued))?.issued ?? (given(ds?.issued) ? ds.issued : null);

/**
 * Every problem with a plan, as `{ severity, path, code, vars }`. `code` is an i18n key under
 * `val.` so the page and the CLI can both say it in words. Errors make a plan invalid;
 * warnings are what a draft normally has (an unanswered question) and do not.
 *
 * Validates the plan as it would be written out, so what the page reports is what the
 * downloaded file is.
 */
export function validatePlan(plan) {
  if (!isObj(plan) || !isObj(plan.dmp)) return [{ severity: 'error', path: 'dmp', code: 'val.noRoot', vars: {} }];
  const p = finalisePlan(plan);
  const d = p.dmp;
  const schemaErrors = validate(MADMP_SCHEMA, p);
  // A distribution's title is filled from its dataset's, so when the dataset has none the
  // distribution's absence is the same problem said twice.
  const untitled = new Set(schemaErrors.filter((e) => e.code === 'val.required' && /^dmp\.dataset\[\d+\]\.title$/.test(e.path)).map((e) => e.path.slice(0, -'.title'.length)));
  const out = schemaErrors
    .filter((e) => !(e.code === 'val.required' && /\.distribution\[\d+\]\.title$/.test(e.path) && untitled.has(e.path.replace(/\.distribution\[\d+\]\.title$/, ''))))
    .map((e) => ({ severity: 'error', vars: {}, ...e }));
  const err = (path, code, vars = {}) => out.push({ severity: 'error', path, code, vars });
  const warn = (path, code, vars = {}) => out.push({ severity: 'warning', path, code, vars });

  // Identifiers the standard leaves as free strings, held to the form their type names.
  const typed = (path, id, kinds) => {
    if (!isObj(id) || !given(id.identifier)) return;
    if (id.type === 'doi' && !isDoi(id.identifier)) err(`${path}.identifier`, 'val.doi');
    if (id.type === 'orcid' && kinds.includes('orcid') && !orcidChecksumOk(id.identifier)) err(`${path}.identifier`, 'val.orcid');
  };
  typed('dmp.dmp_id', d.dmp_id, []);
  if (d.dmp_id?.type === 'url' && given(d.dmp_id.identifier) && validate({ type: 'string', format: 'url' }, d.dmp_id.identifier).length)
    err('dmp.dmp_id.identifier', 'val.format.url');
  typed('dmp.contact.contact_id', d.contact?.contact_id, ['orcid']);
  (Array.isArray(d.contributor) ? d.contributor : []).forEach((c, i) => typed(`dmp.contributor[${i}].contributor_id`, c?.contributor_id, ['orcid']));

  if (given(d.created) && given(d.modified) && Date.parse(d.modified) < Date.parse(d.created)) err('dmp.modified', 'val.modifiedBeforeCreated');

  const datasets = Array.isArray(d.dataset) ? d.dataset : [];
  if (datasets.length === 0) warn('dmp.dataset', 'val.noDatasets');
  const seen = new Map();
  datasets.forEach((ds, i) => {
    const at = `dmp.dataset[${i}]`;
    typed(`${at}.dataset_id`, ds?.dataset_id, []);
    (Array.isArray(ds?.creator) ? ds.creator : []).forEach((c, j) => typed(`${at}.creator[${j}].creator_id`, c?.creator_id, ['orcid']));
    if (ds?.dataset_id?.type === 'doi' && isDoi(ds.dataset_id.identifier)) {
      const key = normaliseDoi(ds.dataset_id.identifier).toLowerCase();
      if (seen.has(key)) err(`${at}.dataset_id.identifier`, 'val.duplicateDoi', { n: seen.get(key) + 1 });
      else seen.set(key, i);
    }
    const dists = Array.isArray(ds?.distribution) ? ds.distribution : [];
    if (ds?.personal_data === 'yes' && dists.some((x) => x?.data_access === 'open')) warn(`${at}.personal_data`, 'val.openPersonal');
    dists.forEach((x, j) => (Array.isArray(x?.license) ? x.license : []).forEach((l, k) => {
      if (given(l?.start_date) && given(x.issued) && realDate(l.start_date) && realDate(x.issued) && l.start_date < x.issued)
        warn(`${at}.distribution[${j}].license[${k}].start_date`, 'val.licenceBeforeIssued');
    }));
  });

  // The extension.
  const ext = d[EXTENSION];
  if (ext !== undefined) {
    if (!isObj(ext)) err(`dmp.${EXTENSION}`, 'val.type', { want: 'object' });
    else {
      if (given(ext.schema_version) && ext.schema_version !== SCHEMA_VERSION) err(`dmp.${EXTENSION}.schema_version`, 'val.schemaVersion', { want: SCHEMA_VERSION });
      const answers = isObj(ext.answers) ? ext.answers : {};
      for (const [k, v] of Object.entries(answers)) {
        if (!QUESTION_IDS.includes(k)) err(`dmp.${EXTENSION}.answers.${k}`, 'val.unknownQuestion');
        else if (typeof v !== 'string') err(`dmp.${EXTENSION}.answers.${k}`, 'val.type', { want: 'string' });
      }
      // Every required question unanswered is one warning. 4a and 4c say why they are required.
      const required = requiredQuestions(p);
      for (const q of QUESTIONS) {
        if (given(answers[q.id]) || !required.includes(q.id)) continue;
        const code = q.id === '4a' ? 'val.personalNeeds4a' : q.id === '4c' ? 'val.ethicsNeeds4c' : 'val.unanswered';
        warn(`dmp.${EXTENSION}.answers.${q.id}`, code);
      }
      validateVersions(ext.versions, `dmp.${EXTENSION}.versions`, err);
    }
  }
  return out;
}

export const isValid = (plan) => validatePlan(plan).every((p) => p.severity !== 'error');

/**
 * How far the plan is from complete in the guide's terms: the required questions (see
 * requiredQuestions) and how many have an answer. Separate from validity on purpose: a draft
 * is a valid maDMP long before every question is answered, and should download as one.
 */
export function completeness(plan) {
  const answers = plan?.dmp?.[EXTENSION]?.answers ?? {};
  const required = requiredQuestions(plan);
  const answered = required.filter((id) => given(answers[id]));
  return { required: required.length, answered: answered.length, complete: answered.length === required.length, missing: required.filter((id) => !given(answers[id])) };
}

// ── versions ────────────────────────────────────────────────────────────────

/**
 * The plan's version history, kept in the extension as `versions`: one entry per saved version,
 * `{ version, date, note }`, numbered from 1. maDMP has no version field (it says `modified`
 * "indicates a DMP version"); the history adds the number and the note a person needs to say
 * "version 3, after the mid-term review". The file in the editor is always the latest version
 * plus whatever was changed since it was saved.
 */
export const versionsOf = (plan) => (Array.isArray(plan?.dmp?.[EXTENSION]?.versions) ? plan.dmp[EXTENSION].versions : []);

export const currentVersion = (plan) => versionsOf(plan).reduce((n, v) => Math.max(n, Number(v?.version) || 0), 0);

/** A copy of the plan saved as the next version, with `note`, at `now`. */
export function saveVersion(plan, note = '', now = new Date()) {
  const next = stamp(plan, now);
  const ext = next.dmp[EXTENSION] ??= { schema_version: SCHEMA_VERSION, answers: {} };
  ext.versions = [...versionsOf(next), { version: currentVersion(next) + 1, date: next.dmp.modified, note: String(note).trim() }];
  return next;
}

function validateVersions(versions, at, err) {
  if (versions === undefined) return;
  if (!Array.isArray(versions)) return err(at, 'val.type', { want: 'array' });
  let last = 0;
  versions.forEach((v, i) => {
    if (!isObj(v) || !Number.isInteger(v.version) || v.version <= last) err(`${at}[${i}].version`, 'val.versionOrder');
    else last = v.version;
    if (!isObj(v) || !given(v.date) || validate({ type: 'string', format: 'date-time' }, v.date).length) err(`${at}[${i}].date`, 'val.format.date-time');
  });
}

/** Touch `modified`, keeping `created`, as maDMP asks. */
export function stamp(plan, now = new Date()) {
  const next = structuredClone(plan);
  next.dmp.modified = stampOf(now);
  return next;
}

export const planToJson = (plan) => `${JSON.stringify(finalisePlan(plan), null, 2)}\n`;

/**
 * Parse text as a plan. Returns `{ plan }` or `{ error }` with an i18n key; never throws, so a
 * pasted or uploaded file cannot take the page down. A maDMP from another tool has no
 * extension; it gets an empty one, so its questions show as unanswered rather than missing.
 */
export function parsePlan(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'val.notJson' };
  }
  if (!isObj(data) || !isObj(data.dmp)) return { error: 'val.noRoot' };
  return { plan: data };
}

/**
 * The plan in the shape the editor works on: whatever it was, plus the slots the form binds to
 * (one project with one funding entry, one distribution per dataset with a host and a licence,
 * the extension with every question). Nothing the plan already carries is changed or dropped.
 */
export function editable(plan) {
  const p = structuredClone(plan);
  const d = p.dmp;
  if (!isObj(d.contact)) d.contact = { name: '', mbox: '' };
  if (!isObj(d.contact.contact_id)) d.contact.contact_id = { identifier: '', type: 'orcid' };
  if (!Array.isArray(d.project) || !d.project.length) d.project = [{ title: '' }];
  const pr = d.project[0];
  if (!Array.isArray(pr.funding) || !pr.funding.length) pr.funding = [{ funding_status: 'granted' }];
  const f = pr.funding[0];
  if (!isObj(f.funder_id)) f.funder_id = { identifier: '', type: 'fundref' };
  if (!isObj(f.grant_id)) f.grant_id = { identifier: '', type: 'other' };
  if (!Array.isArray(d.dataset)) d.dataset = [];
  for (const ds of d.dataset) {
    if (!Array.isArray(ds.distribution) || !ds.distribution.length) ds.distribution = [{ title: '', data_access: 'open' }];
    const x = ds.distribution[0];
    if (!isObj(x.host)) x.host = { title: '', url: '' };
    if (!Array.isArray(x.license) || !x.license.length) x.license = [{ license_ref: '', start_date: '' }];
    if (!Array.isArray(x.format)) x.format = [];
    if (!isObj(ds.dataset_id)) ds.dataset_id = localId(newUuid());
  }
  if (!isObj(d[EXTENSION])) d[EXTENSION] = { schema_version: SCHEMA_VERSION, guide: { title: GUIDE.title, doi: GUIDE.conceptDoi } };
  const ext = d[EXTENSION];
  if (!isObj(ext.answers)) ext.answers = {};
  for (const id of QUESTION_IDS) if (typeof ext.answers[id] !== 'string') ext.answers[id] = ext.answers[id] == null ? '' : String(ext.answers[id]);
  return p;
}

/**
 * A persistent identifier typed by a person, as maDMP's typed identifier. maDMP suggests doi,
 * handle, ark and url for a plan (DMPTool registers DataCite DOIs, a plan published in a
 * journal may carry a Crossref DOI, DMPonline gives URLs). A DOI is recognised in any of its
 * spellings and stored bare; an `ark:` or a Handle (`hdl:` or hdl.handle.net) keeps its
 * scheme's form; any other http(s) address is a URL.
 */
export function typedIdentifier(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (isDoi(s)) return { identifier: normaliseDoi(s), type: 'doi' };
  const ark = /(?:^|\/)(ark:\/?\d{5,}\/\S+)$/i.exec(s);
  if (ark) return { identifier: ark[1], type: 'ark' };
  const hdl = /^(?:hdl:\s*|https?:\/\/hdl\.handle\.net\/)(\S+\/\S+)$/i.exec(s);
  if (hdl) return { identifier: hdl[1], type: 'handle' };
  if (/^https?:\/\//i.test(s)) return { identifier: s, type: 'url' };
  return { identifier: s, type: 'other' };
}

/** The identifier types the editor offers for a plan, as maDMP suggests them, plus `other`. */
export const ID_TYPES = Object.freeze(['doi', 'handle', 'ark', 'url', 'other']);

/**
 * A typed identifier with the type a person chose rather than the one recognised: the value is
 * still tidied for that type (a DOI loses its resolver, a Handle its `hdl:`), so choosing
 * `doi` for `https://doi.org/10.1/x` stores `10.1/x`. An empty `type` means recognise it.
 */
export function identifierAs(value, type) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (!type) return typedIdentifier(s);
  if (type === 'doi') return { identifier: normaliseDoi(s), type };
  if (type === 'handle') return { identifier: s.replace(/^(?:hdl:\s*|https?:\/\/hdl\.handle\.net\/)/i, ''), type };
  if (type === 'ark') return { identifier: /(ark:\/?\S+)$/i.exec(s)?.[1] ?? s, type };
  return { identifier: s, type };
}

/** Whether an identifier is the local one this tool gives a plan or dataset without a PID. */
export const isLocalId = (id) => id?.type === 'other' && /^urn:uuid:/.test(id?.identifier ?? '');

/** A dataset's DOI, when its identifier is one. */
export const datasetDoi = (ds) => (ds?.dataset_id?.type === 'doi' && isDoi(ds.dataset_id.identifier) ? normaliseDoi(ds.dataset_id.identifier) : null);

/**
 * Set or clear a dataset's DOI. The local identifier a dataset had before its DOI moves to
 * `alternate_identifier`, and comes back when the DOI is cleared, so the same dataset can be
 * recognised in every version of the plan (see diff.js) whatever its identifier is now.
 */
export function setDatasetDoi(ds, value, uuid = newUuid()) {
  const local = (id) => id?.type === 'other' && /^urn:uuid:/.test(id.identifier ?? '');
  const alt = Array.isArray(ds.alternate_identifier) ? ds.alternate_identifier : [];
  if (local(ds.dataset_id) && !alt.some((a) => a?.identifier === ds.dataset_id.identifier)) alt.push({ ...ds.dataset_id });
  if (given(value)) {
    ds.dataset_id = { identifier: normaliseDoi(value), type: 'doi' };
    ds.alternate_identifier = alt;
  } else {
    const kept = alt.find(local);
    ds.dataset_id = kept ? { ...kept } : localId(uuid);
    ds.alternate_identifier = alt.filter((a) => a !== kept);
  }
  if (!ds.alternate_identifier.length) delete ds.alternate_identifier;
}

// ── fields by path ──────────────────────────────────────────────────────────

/** The value at `path` (keys and array indices) inside `obj`, or undefined. */
export const getIn = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** Set the value at `path`, creating objects and arrays on the way as the next key asks. */
export function setIn(obj, path, value) {
  let o = obj;
  path.slice(0, -1).forEach((k, i) => {
    const next = path[i + 1];
    if (o[k] == null || typeof o[k] !== 'object') o[k] = typeof next === 'number' ? [] : {};
    o = o[k];
  });
  o[path.at(-1)] = value;
}

const splitList = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const splitLines = (v) => String(v ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

/** A field's value as a form shows it: always a string. */
export function fieldValue(obj, fd) {
  const v = getIn(obj, fd.path);
  switch (fd.type) {
    case 'doi': return datasetDoi(obj) ?? (v?.type === 'doi' ? v.identifier ?? '' : '');
    case 'bool': return v === true ? 'yes' : v === false ? 'no' : '';
    case 'integer': case 'number': return v == null ? '' : String(v);
    case 'list': return Array.isArray(v) ? v.join(', ') : '';
    case 'lines': return Array.isArray(v) ? v.join('\n') : '';
    case 'objlist': return Array.isArray(v) ? v.map((x) => x?.[fd.prop] ?? '').filter(Boolean).join('\n') : '';
    case 'personid': return v?.identifier ?? '';
    default: return v ?? '';
  }
}

/** The maDMP type of a person's identifier, from its shape. */
export const personIdType = (s) => (normaliseOrcid(s) ? 'orcid' : /^https?:\/\//i.test(String(s).trim()) ? 'url' : 'other');

/**
 * Write a value typed into a form back into the plan, in the shape maDMP wants. A blank value
 * is written blank; finalisePlan drops it on the way out.
 */
export function setFieldValue(obj, fd, value, { language = 'eng' } = {}) {
  switch (fd.type) {
    case 'doi': return setDatasetDoi(obj, value);
    case 'bool': return setIn(obj, fd.path, value === 'yes' ? true : value === 'no' ? false : '');
    case 'integer': case 'number': {
      const n = fd.type === 'integer' ? Number.parseInt(value, 10) : Number.parseFloat(value);
      return setIn(obj, fd.path, given(value) && Number.isFinite(n) ? n : '');
    }
    case 'list': return setIn(obj, fd.path, splitList(value));
    case 'lines': return setIn(obj, fd.path, splitLines(value));
    case 'objlist': {
      // Keep whatever else each entry carries (a description), matched by position.
      const old = getIn(obj, fd.path);
      return setIn(obj, fd.path, splitLines(value).map((line, i) => ({ ...(Array.isArray(old) && isObj(old[i]) ? old[i] : {}), [fd.prop]: line })));
    }
    case 'metadata': {
      setIn(obj, fd.path, value);
      const entry = getIn(obj, fd.path.slice(0, 2));
      entry.metadata_standard_id.type = 'url';
      if (!given(entry.language)) entry.language = language;
      return undefined;
    }
    case 'personid': return setIn(obj, fd.path, { identifier: String(value).trim(), type: personIdType(value) });
    default: return setIn(obj, fd.path, value);
  }
}

/** The SPDX id of a licence URL this tool knows, or null. */
export function licenceSpdx(url) {
  const want = licenceKey(url);
  return LICENCES.find((l) => licenceKey(l.url) === want)?.spdx ?? null;
}

/**
 * A licence URL reduced to what identifies the licence: no scheme, no www, no trailing
 * `legalcode` (with or without a language), no trailing slash, lower case. Creative Commons and
 * the repositories that cite it write the same licence half a dozen ways.
 */
export function licenceKey(url) {
  return String(url ?? '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '')
    .replace(/\/legalcode(\.[a-z-]+)?(\.(html?|txt))?$/, '')
    .replace(/\/+$/, '');
}

const mdEscape = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/**
 * The plan as Markdown, for a funder that wants a document, a review, or a project wiki.
 * `t` is the translator, passed in so this module needs no i18n state of its own.
 * `layout: 'horizon'` files the same answers under the sections of the Horizon Europe template.
 */
export function planToMarkdown(plan, t, { layout = 'science-europe' } = {}) {
  const p = finalisePlan(plan);
  const d = p.dmp;
  const answers = d[EXTENSION]?.answers ?? {};
  const lines = [];
  lines.push(`# ${d.title || t('md.untitled')}`, '');
  lines.push(`| ${t('md.field')} | ${t('md.value')} |`, '|---|---|');
  const pr = d.project?.[0];
  if (pr?.title) lines.push(`| ${t('md.project')} | ${mdEscape(pr.title)} |`);
  const f = pr?.funding?.[0];
  if (f?.grant_id?.identifier) lines.push(`| ${t('md.grant')} | ${mdEscape(f.grant_id.identifier)} |`);
  lines.push(`| ${t('md.contact')} | ${mdEscape(d.contact?.name)} |`);
  if (d.dmp_id?.identifier) lines.push(`| ${t('md.dmpId')} | ${mdEscape(d.dmp_id.identifier)} |`);
  lines.push(`| ${t('md.created')} | ${mdEscape(d.created)} |`);
  lines.push(`| ${t('md.modified')} | ${mdEscape(d.modified)} |`);
  lines.push('');
  const answer = (id) => [`### ${id}. ${t(`q.${id}`)}`, '',
    given(answers[id]) ? String(answers[id]).trim() : `_${t('md.unanswered')}_`, ''];
  if (layout === 'horizon') {
    lines.push(`_${t('md.he.note')}_`, '');
    let parent = null;
    for (const s of HE_SECTIONS) {
      if (s.parent && s.parent !== parent) lines.push(`## ${s.parent}. ${t(`he.${s.parent}`)}`, '');
      parent = s.parent ?? null;
      lines.push(`${s.parent ? '###' : '##'} ${s.id}. ${t(`he.${s.id}`)}`, '');
      if (!s.questions.length) lines.push(`_${t('md.he.none')}_`, '');
      for (const id of s.questions) lines.push(...answer(id).map((l) => (s.parent && l.startsWith('### ') ? `#${l}` : l)));
    }
  } else {
    let section = null;
    for (const q of QUESTIONS) {
      if (q.section !== section) {
        section = q.section;
        lines.push(`## ${q.section}. ${t(`sec.${q.section}`)}`, '');
      }
      lines.push(...answer(q.id));
    }
  }
  const datasets = d.dataset ?? [];
  if (datasets.length) {
    lines.push(`## ${t('md.datasets')}`, '');
    lines.push(`| ${t('md.ds.title')} | ${t('md.ds.id')} | ${t('md.ds.access')} | ${t('md.ds.issued')} | ${t('md.ds.licence')} | ${t('md.ds.host')} |`, '|---|---|---|---|---|---|');
    for (const ds of datasets) {
      const x = ds.distribution?.[0] ?? {};
      const lic = x.license?.[0]?.license_ref;
      lines.push(`| ${mdEscape(ds.title)} | ${mdEscape(datasetDoi(ds) ?? '')} | ${x.data_access ? t(`opt.data_access.${x.data_access}`) : ''} | ${mdEscape(issuedOf(ds) ?? '')} | ${mdEscape(lic ? licenceSpdx(lic) ?? lic : '')} | ${mdEscape(x.host?.title ?? '')} |`);
    }
    lines.push('');
  }
  lines.push('---', '', t('md.footer', { guide: GUIDE.title, doi: GUIDE.versionDoi }), '');
  return lines.join('\n');
}
