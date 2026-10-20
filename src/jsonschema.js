// A JSON Schema validator for exactly the keywords the RDA DMP Common Standard v1.2 uses.
//
// Why not a library: the repository has no dependencies, so the page, the CLI and the Action
// run on what a browser and GitHub's runners already have. The standard's schema uses a small,
// fixed set of keywords, and `KEYWORDS` below is that set. A keyword outside it makes
// `validate` throw rather than pass in silence; tests/schema.test.mjs walks the vendored schema
// and fails the day a new version of the standard needs one this file does not know.
//
// One deliberate strictness: JSON Schema 2020-12 treats `format` as an annotation, so most
// validators accept "next Tuesday" as a date. Here `format` is asserted, because a plan whose
// dates cannot be compared cannot be checked. `url` is not a standard format; the maDMP schema
// uses it, and it is read here as an absolute http(s) or ftp URL.
//
// Pure. Errors come back as `{ path, code, vars }`, with `path` in dotted form
// (`dmp.dataset[0].title`) and `code` an i18n key under `val.`.

export const KEYWORDS = Object.freeze([
  '$schema', '$id', '$defs', '$ref', 'title', 'description', 'examples',
  'type', 'properties', 'required', 'items', 'enum', 'format', 'minItems', 'uniqueItems', 'oneOf',
]);

const RX = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  uri: /^[a-z][a-z0-9+.-]*:\S+$/i,
  url: /^(https?|ftp):\/\/[^\s/$.?#][^\s]*$/i,
};

/** A calendar date that exists: 2026-02-30 matches the pattern and is still not a date. */
export function realDate(s) {
  if (!RX.date.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function formatOk(format, value) {
  if (format === 'date') return realDate(value);
  if (format === 'date-time') return RX['date-time'].test(value) && realDate(value.slice(0, 10)) && !Number.isNaN(Date.parse(value));
  if (!RX[format]) throw new Error(`format ${format} is not supported`);
  return RX[format].test(value);
}

const typeOf = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
};

const typeOk = (want, v) => {
  const got = typeOf(v);
  return want === got || (want === 'number' && got === 'integer');
};

const join = (path, key) => (typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key);

/**
 * Validate `value` against `schema` (whose `$defs` resolve `#/$defs/...` references).
 * Returns every error found, in document order; an empty array means valid.
 */
export function validate(schema, value) {
  const errors = [];
  const resolve = (ref) => {
    const m = /^#\/\$defs\/(.+)$/.exec(ref);
    const target = m && schema.$defs?.[m[1]];
    if (!target) throw new Error(`cannot resolve $ref ${ref}`);
    return target;
  };

  const walk = (node, v, path, out) => {
    for (const k of Object.keys(node)) if (!KEYWORDS.includes(k)) throw new Error(`keyword ${k} is not supported`);
    if (node.$ref) return walk(resolve(node.$ref), v, path, out);
    if (node.type && !typeOk(node.type, v)) {
      out.push({ path, code: 'val.type', vars: { want: node.type } });
      return;
    }
    if (node.enum && !node.enum.includes(v)) out.push({ path, code: 'val.enum', vars: { allowed: node.enum.length > 12 ? `${node.enum.slice(0, 12).join(', ')}, …` : node.enum.join(', ') } });
    if (node.format && typeof v === 'string' && !formatOk(node.format, v)) out.push({ path, code: `val.format.${node.format}` });
    if (node.oneOf) {
      const passing = node.oneOf.map((sub) => { const e = []; walk(sub, v, path, e); return e; });
      const ok = passing.filter((e) => e.length === 0).length;
      if (ok !== 1) {
        // Report the branch whose type matched, which is the one the author meant.
        const typeOfBranch = (sub) => (sub.$ref ? resolve(sub.$ref) : sub).type;
        const meant = passing.find((e, i) => !typeOfBranch(node.oneOf[i]) || typeOk(typeOfBranch(node.oneOf[i]), v)) ?? passing[0];
        out.push(...(ok === 0 ? meant : [{ path, code: 'val.oneOf' }]));
      }
    }
    if (typeOf(v) === 'object') {
      for (const r of node.required ?? []) if (!(r in v)) out.push({ path: join(path, r), code: 'val.required' });
      for (const [k, sub] of Object.entries(node.properties ?? {})) if (k in v) walk(sub, v[k], join(path, k), out);
    }
    if (Array.isArray(v)) {
      if (node.minItems !== undefined && v.length < node.minItems) out.push({ path, code: 'val.minItems', vars: { n: node.minItems } });
      if (node.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) out.push({ path, code: 'val.uniqueItems' });
      if (node.items) v.forEach((item, i) => walk(node.items, item, join(path, i), out));
    }
  };

  walk(schema, value, '', errors);
  return errors;
}

/** Every keyword a schema uses, at any depth, for the test that pins the supported set. */
export function keywordsUsed(schema) {
  const found = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      found.add(k);
      if (k === 'properties' || k === '$defs') Object.values(v).forEach(visit);
      else if (k !== 'enum' && k !== 'examples' && k !== 'required') visit(v);
    }
  };
  visit(schema);
  return found;
}
