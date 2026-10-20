// What changed between two versions of a plan.
//
// A plan is revised over a project's life, and what a reader of version 3 wants to know is what
// it says that version 2 did not: an answer rewritten, a dataset added or dropped, and above
// all a publication date that moved, which is how a plan admits a delay. This module compares
// two plans field by field and returns the changes as data; the page and the Markdown export
// put them into words.
//
// Datasets are matched across versions by any identifier they share (the DOI, or the local
// identifier the dataset had before it got one, which plan.js keeps in `alternate_identifier`),
// then by title. Pure.

import { DATASET_FIELDS, PLAN_FIELDS, QUESTION_IDS } from './requirements.js?v=19';
import { EXTENSION, currentVersion, fieldValue, getIn, issuedOf } from './plan.js?v=19';

/** The plan-level fields compared, with a path and a label key each. */
export const PLAN_META = Object.freeze([
  { key: 'title', path: ['title'] },
  { key: 'contact', path: ['contact', 'name'] },
  { key: 'mbox', path: ['contact', 'mbox'] },
  { key: 'orcid', path: ['contact', 'contact_id', 'identifier'] },
  { key: 'dmpId', path: ['dmp_id', 'identifier'] },
  { key: 'ethics', path: ['ethical_issues_exist'] },
  { key: 'project', path: ['project', 0, 'title'] },
  { key: 'start', path: ['project', 0, 'start'] },
  { key: 'end', path: ['project', 0, 'end'] },
  { key: 'funder', path: ['project', 0, 'funding', 0, 'funder_id', 'identifier'] },
  { key: 'grant', path: ['project', 0, 'funding', 0, 'grant_id', 'identifier'] },
]);

const str = (v) => (v == null ? '' : typeof v === 'string' ? v.trim() : JSON.stringify(v));

/** Every identifier a dataset is known by, in lower case. */
export function datasetKeys(ds) {
  const ids = [ds?.dataset_id, ...(Array.isArray(ds?.alternate_identifier) ? ds.alternate_identifier : [])];
  return ids.map((id) => String(id?.identifier ?? '').trim().toLowerCase()).filter(Boolean);
}

/** Pairs of datasets, `[before, after]`, with null for one that exists on one side only. */
export function matchDatasets(before = [], after = []) {
  const pairs = [];
  const left = new Set(after.map((_, i) => i));
  const take = (pred) => {
    for (const i of left) if (pred(after[i])) { left.delete(i); return after[i]; }
    return null;
  };
  const unmatched = [];
  for (const a of before) {
    const keys = new Set(datasetKeys(a));
    const b = take((x) => datasetKeys(x).some((k) => keys.has(k)));
    if (b) pairs.push([a, b]); else unmatched.push(a);
  }
  for (const a of unmatched) {
    const title = str(a?.title).toLowerCase();
    pairs.push([a, title ? take((x) => str(x?.title).toLowerCase() === title) : null]);
  }
  for (const i of left) pairs.push([null, after[i]]);
  return pairs;
}

const days = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/** One change: `{ area, key, kind, before, after, ... }`, `kind` added, removed or changed. */
const change = (area, key, before, after, extra = {}) => {
  const kind = before === '' ? 'added' : after === '' ? 'removed' : 'changed';
  return { area, key, kind, before, after, ...extra };
};

/** A row-list field (contributors, costs) as comparable lines. */
function rows(plan, fd) {
  const list = getIn(plan?.dmp ?? {}, fd.path);
  return (Array.isArray(list) ? list : []).map((row) => fd.columns.map((c) => fieldValue(row, c)).filter(Boolean).join(' · ')).filter(Boolean);
}

/**
 * Compare two plans. Returns `{ from, to, changes }`, where `from` and `to` are the version
 * numbers each plan carries (0 when it has none) and `changes` lists every difference, plan
 * fields first, then answers, then datasets in the later plan's order.
 */
export function diffPlans(before, after) {
  const A = before?.dmp ?? {};
  const B = after?.dmp ?? {};
  const changes = [];

  for (const f of PLAN_META) {
    const a = str(getIn(A, f.path));
    const b = str(getIn(B, f.path));
    if (a !== b) changes.push(change('plan', f.key, a, b));
  }
  for (const f of PLAN_FIELDS) {
    if (f.type === 'rows') {
      const a = rows(before, f);
      const b = rows(after, f);
      for (const line of a.filter((x) => !b.includes(x))) changes.push(change('plan', f.key, line, ''));
      for (const line of b.filter((x) => !a.includes(x))) changes.push(change('plan', f.key, '', line));
    } else {
      const a = str(getIn(A, f.path));
      const b = str(getIn(B, f.path));
      if (a !== b) changes.push(change('plan', f.key, a, b));
    }
  }

  const ansA = A[EXTENSION]?.answers ?? {};
  const ansB = B[EXTENSION]?.answers ?? {};
  for (const id of QUESTION_IDS) {
    const a = str(ansA[id]);
    const b = str(ansB[id]);
    if (a !== b) changes.push(change('answer', id, a, b));
  }

  for (const [a, b] of matchDatasets(A.dataset ?? [], B.dataset ?? [])) {
    const title = str(b?.title) || str(a?.title);
    if (!a) { changes.push({ area: 'dataset', key: 'dataset', kind: 'added', before: '', after: title, title }); continue; }
    if (!b) { changes.push({ area: 'dataset', key: 'dataset', kind: 'removed', before: title, after: '', title }); continue; }
    for (const fd of DATASET_FIELDS) {
      const va = str(fieldValue(a, fd));
      const vb = str(fieldValue(b, fd));
      if (va === vb) continue;
      const extra = { title };
      if (fd.key === 'issued' && va && vb) extra.days = days(va, vb);
      changes.push(change('dataset', fd.key, va, vb, extra));
    }
    // A dataset dated on itself rather than on its distribution: the date still counts.
    if (!fieldValue(a, DATASET_FIELDS.find((f) => f.key === 'issued')) && !fieldValue(b, DATASET_FIELDS.find((f) => f.key === 'issued'))) {
      const ia = issuedOf(a) ?? '';
      const ib = issuedOf(b) ?? '';
      if (ia !== ib) changes.push(change('dataset', 'issued', ia, ib, { title, ...(ia && ib ? { days: days(ia, ib) } : {}) }));
    }
  }
  return { from: currentVersion(before), to: currentVersion(after), changes };
}

/** Publication dates that moved later: the changes a reader of a revised plan looks for first. */
export const delays = (diff) => diff.changes.filter((c) => c.key === 'issued' && c.days > 0);

/** The comparison as Markdown, for a review, an email to a funder, or the project's records. */
export function diffToMarkdown(diff, t, { fromLabel, toLabel } = {}) {
  const label = (n) => (n ? t('cmp.version', { n }) : t('cmp.unversioned'));
  const lines = [`# ${t('cmp.md.title', { from: fromLabel ?? label(diff.from), to: toLabel ?? label(diff.to) })}`, ''];
  if (!diff.changes.length) return `${[...lines, t('cmp.none')].join('\n')}\n`;
  const late = delays(diff);
  if (late.length) {
    lines.push(`**${t('cmp.delays', { n: late.length })}**`, '');
    for (const c of late) lines.push(`- ${t('cmp.delay', { title: c.title, before: c.before, after: c.after, days: c.days })}`);
    lines.push('');
  }
  for (const c of diff.changes) lines.push(`- ${changeText(c, t)}`);
  return `${lines.join('\n')}\n`;
}

/** One change in words. */
export function changeText(c, t) {
  const what = c.area === 'answer' ? t('cmp.answer', { id: c.key })
    : c.area === 'dataset' && c.key === 'dataset' ? t('cmp.dataset')
    : c.area === 'dataset' ? `${c.title || t('cmp.untitled')}: ${t(`field.${c.key}`)}`
    : t(`cmp.field.${c.key}`);
  const short = (s) => (s.length > 120 ? `${s.slice(0, 117)}…` : s);
  if (c.area === 'dataset' && c.key === 'dataset') return `${what} ${t(`cmp.kind.${c.kind}`)}: ${c.title}`;
  if (c.kind === 'added') return `${what}: ${t('cmp.kind.added')} “${short(c.after)}”`;
  if (c.kind === 'removed') return `${what}: ${t('cmp.kind.removed')} “${short(c.before)}”`;
  return `${what}: “${short(c.before)}” → “${short(c.after)}”`;
}
