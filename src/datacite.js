// A registry view (see evidence.js) over the DataCite REST API, for the page and the CLI.
//
// Two hosts, named in the page's Content-Security-Policy and nowhere else:
//   api.datacite.org   /dois/{doi}           one record per DOI the plan names
//                      /dois?query=...        the deposits that cite a grant, one request each
//   doi.org            /ra/{doi}             who registered a DOI, asked only for one DataCite
//                                            does not hold (a Crossref DOI, say), so that a DOI
//                                            that exists elsewhere is not reported as missing
//
// DataCite registers the DOIs of Zenodo, Figshare, Dryad, most institutional repositories and
// most DMP tools, so it is where a dataset's DOI, licence, access and funding can be read back.
// It answers browsers directly (it sends Access-Control-Allow-Origin), needs no key, and is
// asked politely: every record is fetched at most once per check.
//
// `fetchImpl` is injected so the tests can drive this module without a network.

export const DATACITE_API = 'https://api.datacite.org';
export const DOI_ORG = 'https://doi.org';

/** Error with a code the page and the CLI can translate. */
export class RegistryError extends Error {
  constructor(code, vars = {}) {
    super(code);
    this.code = code;
    this.vars = vars;
  }
}

async function getJson(fetchImpl, url, signal) {
  // Errors name the host that failed: a check talks to DataCite and, now and then, to doi.org.
  const host = new URL(url).hostname;
  let res;
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/vnd.api+json' }, signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new RegistryError('err.network', { host });
  }
  if (res.status === 404) return null;
  if (res.status === 429) throw new RegistryError('err.rateLimit', { host });
  if (!res.ok) throw new RegistryError('err.http', { host, status: res.status });
  return res.json();
}

/** The fields of a DataCite record the checks read, in one flat shape. */
export function recordOf(item) {
  const a = item?.attributes ?? {};
  return {
    doi: String(a.doi ?? item?.id ?? '').toLowerCase(),
    url: a.url ?? null,
    publisher: typeof a.publisher === 'string' ? a.publisher : a.publisher?.name ?? null,
    client: item?.relationships?.client?.data?.id ?? null,
    resourceTypeGeneral: a.types?.resourceTypeGeneral ?? null,
    publicationYear: a.publicationYear ?? null,
    dates: Array.isArray(a.dates) ? a.dates : [],
    rights: Array.isArray(a.rightsList) ? a.rightsList : [],
    formats: Array.isArray(a.formats) ? a.formats : [],
    funding: Array.isArray(a.fundingReferences) ? a.fundingReferences : [],
    creators: Array.isArray(a.creators) ? a.creators : [],
    related: Array.isArray(a.relatedIdentifiers) ? a.relatedIdentifiers : [],
    state: a.state ?? null,
  };
}

/** Lucene escaping for a value inside a quoted DataCite query term. */
const quote = (s) => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;

/** The most deposits read back for one grant. Enough for a project; documented in Caveats. */
export const AWARD_PAGE = 100;

/**
 * A registry view: `record(doi)` resolves to a record or null when DataCite has no such DOI;
 * `byAward(number)` resolves to `{ records, total }`. Both throw RegistryError for the cases a
 * person can do something about.
 */
export function dataciteRegistry({ fetchImpl = globalThis.fetch, signal } = {}) {
  const cache = new Map();
  const once = (key, fn) => {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  };
  return {
    source: 'datacite',
    record: (doi) => once(`doi:${doi.toLowerCase()}`, async () => {
      const body = await getJson(fetchImpl, `${DATACITE_API}/dois/${encodeURIComponent(doi)}`, signal);
      return body?.data ? recordOf(body.data) : null;
    }),
    byAward: (award) => once(`award:${award}`, async () => {
      const q = `fundingReferences.awardNumber:${quote(award)}`;
      const body = await getJson(fetchImpl, `${DATACITE_API}/dois?query=${encodeURIComponent(q)}&page%5Bsize%5D=${AWARD_PAGE}`, signal);
      const items = Array.isArray(body?.data) ? body.data : [];
      return { records: items.map(recordOf), total: Number(body?.meta?.total ?? items.length) };
    }),
    // The registration agency of a DOI ('Crossref', 'DataCite', 'mEDRA'…), or null when the
    // DOI does not exist. doi.org answers 200 with a status for an unknown DOI.
    agency: (doi) => once(`ra:${doi.toLowerCase()}`, async () => {
      const body = await getJson(fetchImpl, `${DOI_ORG}/ra/${encodeURIComponent(doi)}`, signal);
      const entry = Array.isArray(body) ? body[0] : null;
      return entry?.RA ?? null;
    }),
  };
}
