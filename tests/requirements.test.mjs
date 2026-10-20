// The catalogue: fifteen questions in six sections, and every maDMP path it names exists in the
// vendored standard.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DATASET_FIELDS, HE_SECTIONS, LICENCES, PLAN_FIELDS, QUESTIONS, SECTIONS, questionsIn } from '../src/requirements.js';
import { MADMP_SCHEMA } from '../src/madmp-schema.js';
import { licenceSpdx } from '../src/plan.js';

/** Follow a /dmp/a/b path through the schema, through arrays and $refs. */
function resolvePath(path) {
  const deref = (n) => (n?.$ref ? MADMP_SCHEMA.$defs[n.$ref.split('/').pop()] : n);
  const down = (n) => {
    n = deref(n);
    if (n?.type === 'array') return deref(n.items);
    if (n?.oneOf) return deref(n.oneOf[0]);
    return n;
  };
  let node = MADMP_SCHEMA;
  for (const key of path.split('/').filter(Boolean)) {
    node = down(node);
    node = node?.properties?.[key];
    if (!node) return null;
  }
  return node;
}

test('six sections, with the guide’s count of questions in each', () => {
  assert.deepEqual(SECTIONS.map((s) => questionsIn(s).map((q) => q.id)), [
    ['1a', '1b'], ['2a', '2b'], ['3a', '3b'], ['4a', '4b', '4c'], ['5a', '5b', '5c', '5d'], ['6a', '6b'],
  ]);
});

test('every maDMP path the catalogue names exists in the standard', () => {
  const paths = QUESTIONS.flatMap((q) => q.madmp);
  assert.ok(paths.length >= 25);
  for (const p of paths) assert.ok(resolvePath(p), `${p} is not a field of maDMP v1.2`);
  assert.equal(resolvePath('/dmp/dataset/distribution/colour'), null, 'the resolver can say no');
});

test('the enum fields offer what the standard allows', () => {
  for (const fd of DATASET_FIELDS.filter((f) => f.type === 'enum')) {
    const path = `/dmp/dataset/${fd.path.filter((k) => typeof k === 'string').join('/')}`;
    const node = resolvePath(path);
    const allowed = node.enum ?? MADMP_SCHEMA.$defs[node.$ref?.split('/').pop()]?.enum;
    assert.deepEqual([...fd.options].sort(), [...allowed].sort(), fd.key);
  }
});

test('every dataset and plan field the editor offers is a field of the standard', () => {
  const tail = (p) => p.filter((k) => typeof k === 'string').join('/');
  for (const fd of DATASET_FIELDS) assert.ok(resolvePath(`/dmp/dataset/${tail(fd.path)}`), fd.key);
  for (const fd of PLAN_FIELDS) {
    assert.ok(resolvePath(`/dmp/${tail(fd.path)}`), fd.key);
    for (const c of fd.columns ?? []) assert.ok(resolvePath(`/dmp/${tail(fd.path)}/${tail(c.path)}`), `${fd.key}.${c.key}`);
  }
  // Detail fields belong to a question; core fields to none.
  for (const fd of DATASET_FIELDS) assert.equal(Boolean(fd.q), fd.tier === 'detail', fd.key);
  for (const fd of [...DATASET_FIELDS, ...PLAN_FIELDS]) if (fd.q) assert.ok(QUESTIONS.some((q) => q.id === fd.q), fd.key);
});

test('every licence on offer is recognised back from its URL', () => {
  for (const l of LICENCES) assert.equal(licenceSpdx(l.url), l.spdx);
  assert.equal(new Set(LICENCES.map((l) => l.spdx)).size, LICENCES.length);
});

test('the Horizon Europe layout files every question exactly once', () => {
  const filed = HE_SECTIONS.flatMap((s) => s.questions);
  assert.deepEqual([...filed].sort(), QUESTIONS.map((q) => q.id).sort());
  assert.equal(new Set(filed).size, filed.length, 'a question is filed twice');
  // The template's ten headings: 1, 2.1 to 2.4 under 2, and 3 to 7.
  assert.deepEqual(HE_SECTIONS.map((s) => s.id), ['1', '2.1', '2.2', '2.3', '2.4', '3', '4', '5', '6', '7']);
});
