// The DataCite registry view, driven by a fake fetch: which URLs it asks for, what it makes of
// the answers, and how it fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AWARD_PAGE, DATACITE_API, DOI_ORG, RegistryError, dataciteRegistry, recordOf } from '../src/datacite.js';

/** A fetch that answers from a table of URL → { status, body } and records what was asked. */
function fakeFetch(table) {
  const asked = [];
  const fn = async (url) => {
    asked.push(url);
    const hit = table[url];
    if (hit instanceof Error) throw hit;
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    const { status = 200, body = {} } = hit;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fn, asked };
}

const ITEM = {
  id: '10.5281/zenodo.1',
  relationships: { client: { data: { id: 'cern.zenodo' } } },
  attributes: { doi: '10.5281/ZENODO.1', url: 'https://zenodo.org/doi/10.5281/zenodo.1', publisher: { name: 'Zenodo' }, state: 'findable' },
};

test('a DOI is fetched once, however often it is asked for', async () => {
  const { fn, asked } = fakeFetch({ [`${DATACITE_API}/dois/10.5281%2Fzenodo.1`]: { body: { data: ITEM } } });
  const reg = dataciteRegistry({ fetchImpl: fn });
  const [a, b] = await Promise.all([reg.record('10.5281/zenodo.1'), reg.record('10.5281/ZENODO.1')]);
  assert.equal(a, b);
  assert.equal(asked.length, 1);
  assert.equal(a.doi, '10.5281/zenodo.1', 'DOIs are compared in lower case');
  assert.equal(a.publisher, 'Zenodo', 'publisher as an object (DataCite 4.5) is read too');
  assert.equal(a.client, 'cern.zenodo');
  assert.deepEqual([a.rights, a.funding, a.formats], [[], [], []], 'absent lists come back empty, never undefined');
});

test('a DOI DataCite does not hold is null, not an error', async () => {
  const { fn } = fakeFetch({});
  assert.equal(await dataciteRegistry({ fetchImpl: fn }).record('10.1234/none'), null);
});

test('deposits under a grant: one quoted query, total kept', async () => {
  const url = `${DATACITE_API}/dois?query=${encodeURIComponent('fundingReferences.awardNumber:"101039426"')}&page%5Bsize%5D=${AWARD_PAGE}`;
  const { fn, asked } = fakeFetch({ [url]: { body: { data: [ITEM], meta: { total: 140 } } } });
  const res = await dataciteRegistry({ fetchImpl: fn }).byAward('101039426');
  assert.deepEqual(asked, [url]);
  assert.equal(res.total, 140);
  assert.equal(res.records.length, 1);
});

test('a grant number cannot break out of its quotes', async () => {
  const { fn, asked } = fakeFetch({});
  await dataciteRegistry({ fetchImpl: fn }).byAward('1" OR "x');
  assert.match(decodeURIComponent(asked[0]), /awardNumber:"1\\" OR \\"x"/);
});

test('failures a person can act on carry a code', async () => {
  const fail = async (table, code) => {
    const { fn } = fakeFetch(table);
    await assert.rejects(dataciteRegistry({ fetchImpl: fn }).record('10.1234/x'), (e) => e instanceof RegistryError && e.code === code);
  };
  const url = `${DATACITE_API}/dois/10.1234%2Fx`;
  await fail({ [url]: { status: 429 } }, 'err.rateLimit');
  await fail({ [url]: { status: 500 } }, 'err.http');
  await fail({ [url]: new TypeError('Failed to fetch') }, 'err.network');
});

test('recordOf takes a missing attributes block', () => {
  const r = recordOf({ id: '10.1234/X' });
  assert.equal(r.doi, '10.1234/x');
  assert.equal(r.url, null);
});

test('the registration agency comes from doi.org, and an unknown DOI is null', async () => {
  // The two answer shapes doi.org/ra gave on 2026-10-20 for a Crossref DOI and an unknown one.
  const { fn, asked } = fakeFetch({
    [`${DOI_ORG}/ra/10.1038%2Fnature12373`]: { body: [{ DOI: '10.1038/nature12373', RA: 'Crossref' }] },
    [`${DOI_ORG}/ra/10.9999%2Fnone`]: { body: [{ DOI: '10.9999/none', status: 'DOI does not exist' }] },
  });
  const reg = dataciteRegistry({ fetchImpl: fn });
  assert.equal(await reg.agency('10.1038/nature12373'), 'Crossref');
  assert.equal(await reg.agency('10.9999/none'), null);
  await reg.agency('10.1038/NATURE12373');
  assert.equal(asked.length, 2, 'asked once per DOI');
});
