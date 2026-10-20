// The vendored standard is the published one, the validator knows every keyword it uses and
// asserts what it should, and the generated files are what the generator produces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildSchema, moduleText, schemaText } from '../scripts/build-schema.mjs';
import { KEYWORDS, keywordsUsed, realDate, validate } from '../src/jsonschema.js';
import { MADMP_SCHEMA } from '../src/madmp-schema.js';
import { QUESTION_IDS } from '../src/requirements.js';
import { SCHEMA_ID, SCHEMA_VERSION } from '../src/plan.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('the vendored schema is byte-identical to RDA DMP Common Standard v1.2 as published', () => {
  // Compared with raw.githubusercontent.com/RDA-DMP-Common/RDA-DMP-Common-Standard/master on
  // 2026-10-20 (upstream head 76452a5). A new upstream version is a new file, not an edit.
  const sha = createHash('sha256').update(readFileSync(fileURLToPath(new URL('../schema/maDMP-schema-1.2.json', import.meta.url)))).digest('hex');
  assert.equal(sha, '474211028a990f57d079f1b5f74bc3addc1d14c28dfd4c4a6e18ff8a81fcf77a');
});

test('the generated files are what the generator produces', () => {
  assert.equal(read('../src/madmp-schema.js'), moduleText(), 'src/madmp-schema.js is stale: run node scripts/build-schema.mjs');
  assert.equal(read('../schema/dmp.schema.json'), schemaText(), 'schema/dmp.schema.json is stale: run node scripts/build-schema.mjs');
  assert.deepEqual(MADMP_SCHEMA, JSON.parse(read('../schema/maDMP-schema-1.2.json')));
});

test('the validator supports every keyword the standard uses, and refuses others', () => {
  const unknown = [...keywordsUsed(MADMP_SCHEMA)].filter((k) => !KEYWORDS.includes(k));
  assert.deepEqual(unknown, []);
  assert.throws(() => validate({ type: 'string', pattern: '^a' }, 'b'), /keyword pattern is not supported/);
  assert.throws(() => validate({ $ref: '#/$defs/Nope' }, 1), /cannot resolve/);
});

test('the validator asserts types, required, enums, formats, oneOf and items', () => {
  const S = {
    $defs: { Id: { type: 'object', required: ['identifier'], properties: { identifier: { type: 'string' } } } },
    type: 'object', required: ['a', 'd'],
    properties: {
      a: { type: 'string', enum: ['x', 'y'] }, d: { type: 'string', format: 'date' }, n: { type: 'integer' },
      id: { oneOf: [{ $ref: '#/$defs/Id' }, { type: 'array', items: { $ref: '#/$defs/Id' }, minItems: 1 }] },
      list: { type: 'array', uniqueItems: true, items: { type: 'string', format: 'url' } },
    },
  };
  const codes = (v) => validate(S, v).map((e) => `${e.path} ${e.code}`);
  assert.deepEqual(codes({ a: 'x', d: '2026-02-28' }), []);
  assert.deepEqual(codes({ a: 'z', d: '2026-02-30', n: 1.5 }), ['a val.enum', 'd val.format.date', 'n val.type']);
  assert.deepEqual(codes({ d: '2026-01-01' }), ['a val.required']);
  assert.deepEqual(codes({ a: 'x', d: '2026-01-01', id: { identifier: 'i' } }), []);
  assert.deepEqual(codes({ a: 'x', d: '2026-01-01', id: [{ identifier: 'i' }] }), []);
  assert.deepEqual(codes({ a: 'x', d: '2026-01-01', id: [] }), ['id val.minItems']);
  assert.deepEqual(codes({ a: 'x', d: '2026-01-01', id: {} }), ['id.identifier val.required']);
  assert.deepEqual(codes({ a: 'x', d: '2026-01-01', list: ['https://a.org', 'https://a.org', 'b.org'] }), ['list val.uniqueItems', 'list[2] val.format.url']);
  assert.equal(realDate('2024-02-29'), true);
  assert.equal(realDate('2025-02-29'), false);
});

test('a maDMP date-time must carry a time zone', () => {
  const S = { type: 'string', format: 'date-time' };
  assert.deepEqual(validate(S, '2026-10-20T10:00:00Z'), []);
  assert.deepEqual(validate(S, '2019-02-22T13:20:15.5Z'), []);
  assert.equal(validate(S, '2026-10-20T10:00:00').length, 1);
});

test('the extension schema names the fifteen questions and builds on the vendored standard', () => {
  const s = buildSchema();
  assert.equal(s.$id, SCHEMA_ID);
  assert.deepEqual(s.allOf, [{ $ref: 'maDMP-schema-1.2.json' }]);
  const ext = s.properties.dmp.properties.actionable_dmp;
  assert.equal(ext.properties.schema_version.const, SCHEMA_VERSION);
  assert.deepEqual(Object.keys(ext.properties.answers.properties), [...QUESTION_IDS]);
});
