// The six core requirements and fifteen questions of Science Europe's Practical Guide to the
// International Alignment of Research Data Management (Extended Edition, 2021,
// https://doi.org/10.5281/zenodo.4915862, CC BY 4.0), and where each one's machine-actionable
// part lives in the RDA DMP Common Standard v1.2.
//
// This file is the single source of truth. The extension schema in schema/ is GENERATED from
// it (scripts/build-schema.mjs), the form on the page is built from it, and the i18n test
// enumerates keys from it. tests/schema.test.mjs fails if the committed schema and this file
// disagree, and tests/requirements.test.mjs fails if a maDMP path named here does not exist
// in the vendored standard.
//
// The guide states its questions twice: as the core requirements (pp. 8-9) and again in the
// example template (pp. 16-25). Seven of the fifteen are worded differently in the template
// (1b, 2a, 3a, 4a, 4c, 5b, 5c), and 4c asks a different question: "What ethical issues and
// codes of conduct are there" against "How will possible ethical issues be taken into
// account". The core list is the requirement and the template is offered as one example of
// it, so the questions here are the core list, word for word. Checked against the rendered
// pages, not only the extracted text.

export const GUIDE = Object.freeze({
  title: 'Practical Guide to the International Alignment of Research Data Management',
  edition: 'Extended Edition',
  publisher: 'Science Europe',
  year: 2021,
  conceptDoi: '10.5281/zenodo.4915861',
  versionDoi: '10.5281/zenodo.4915862',
  license: 'CC-BY-4.0',
});

/** The RDA DMP Common Standard version the plan file follows, vendored in schema/. */
export const MADMP = Object.freeze({
  version: '1.2',
  schemaFile: 'schema/maDMP-schema-1.2.json',
  repository: 'https://github.com/RDA-DMP-Common/RDA-DMP-Common-Standard',
});

/** The six core requirements, in the guide's order. */
export const SECTIONS = Object.freeze(['1', '2', '3', '4', '5', '6']);

/**
 * The fifteen questions. `madmp` lists the maDMP v1.2 fields that carry the structured part of
 * an answer, as paths through the standard's tree (arrays are not marked). They are what the
 * How it works view shows, and the fields the check reads are among them.
 */
export const QUESTIONS = Object.freeze([
  { id: '1a', section: '1', madmp: ['/dmp/dataset/is_reused', '/dmp/dataset/description'] },
  { id: '1b', section: '1', madmp: ['/dmp/dataset/type', '/dmp/dataset/distribution/format', '/dmp/dataset/distribution/byte_size'] },
  { id: '2a', section: '2', madmp: ['/dmp/dataset/metadata/metadata_standard_id', '/dmp/dataset/metadata/language', '/dmp/dataset/keyword'] },
  { id: '2b', section: '2', madmp: ['/dmp/dataset/data_quality_assurance'] },
  { id: '3a', section: '3', madmp: ['/dmp/dataset/distribution/host/storage_type', '/dmp/dataset/distribution/host/backup_type', '/dmp/dataset/distribution/host/backup_frequency'] },
  { id: '3b', section: '3', madmp: ['/dmp/dataset/sensitive_data', '/dmp/dataset/security_and_privacy'] },
  { id: '4a', section: '4', madmp: ['/dmp/dataset/personal_data', '/dmp/dataset/security_and_privacy'] },
  { id: '4b', section: '4', madmp: ['/dmp/dataset/distribution/license/license_ref', '/dmp/dataset/rights'] },
  { id: '4c', section: '4', madmp: ['/dmp/ethical_issues_exist', '/dmp/ethical_issues_description', '/dmp/ethical_issues_report'] },
  { id: '5a', section: '5', madmp: ['/dmp/dataset/distribution/data_access', '/dmp/dataset/distribution/issued', '/dmp/dataset/issued', '/dmp/dataset/distribution/license/start_date'] },
  { id: '5b', section: '5', madmp: ['/dmp/dataset/preservation_statement', '/dmp/dataset/distribution/host/url', '/dmp/dataset/distribution/host/certified_with', '/dmp/dataset/distribution/available_until'] },
  { id: '5c', section: '5', madmp: ['/dmp/dataset/technical_resource'] },
  { id: '5d', section: '5', madmp: ['/dmp/dataset/dataset_id', '/dmp/dataset/distribution/host/pid_system'] },
  { id: '6a', section: '6', madmp: ['/dmp/contact', '/dmp/contributor/role'] },
  { id: '6b', section: '6', madmp: ['/dmp/cost'] },
].map((q) => Object.freeze({ ...q, madmp: Object.freeze(q.madmp) })));

/**
 * The sections of the Horizon Europe DMP template (v1.0, 2021), and which of the fifteen questions
 * this tool files under each, for a DMP.md laid out as Horizon Europe plans are. The headings are
 * the template's; the assignment of questions to them is this tool's reading, and DMP.md says so.
 * Three sections have no question here: interoperability, other research outputs and other issues.
 * tests/requirements.test.mjs checks that every question appears exactly once. Added 2026-10-20
 * for IT:U, whose own template follows these sections.
 */
export const HE_SECTIONS = Object.freeze([
  { id: '1', questions: ['1a', '1b'] },
  { id: '2.1', parent: '2', questions: ['2a', '5d'] },
  { id: '2.2', parent: '2', questions: ['5a', '5b', '5c'] },
  { id: '2.3', parent: '2', questions: [] },
  { id: '2.4', parent: '2', questions: ['2b', '4b'] },
  { id: '3', questions: [] },
  { id: '4', questions: ['6a', '6b'] },
  { id: '5', questions: ['3a', '3b'] },
  { id: '6', questions: ['4a', '4c'] },
  { id: '7', questions: [] },
].map((s) => Object.freeze({ ...s, questions: Object.freeze(s.questions) })));

export const QUESTION_IDS = Object.freeze(QUESTIONS.map((q) => q.id));

export const questionById = (id) => QUESTIONS.find((q) => q.id === id) ?? null;

export const questionsIn = (section) => QUESTIONS.filter((q) => q.section === section);

/**
 * The questions every plan answers. All fifteen apply (the guide: "all six core requirements
 * need to be addressed in a DMP"), but two are asked only of some plans in their own words:
 * 4a "If personal data are processed", and 4c about ethical issues. They are required when a
 * dataset holds personal data, or the plan says there are ethical issues, and also when either
 * is still `unknown`, since then the question is open; otherwise an answer is welcome and its
 * absence is not a gap.
 */
export function requiredQuestions(plan) {
  const d = plan?.dmp ?? {};
  const datasets = Array.isArray(d.dataset) ? d.dataset : [];
  const personal = datasets.some((ds) => ds?.personal_data === 'yes' || ds?.personal_data === 'unknown');
  const ethics = d.ethical_issues_exist === 'yes' || d.ethical_issues_exist === 'unknown' || d.ethical_issues_exist === undefined;
  return QUESTION_IDS.filter((id) => (id === '4a' ? personal : id === '4c' ? ethics : true));
}

const DIST = ['distribution', 0];
const HOST = [...DIST, 'host'];

/**
 * The maDMP fields the editor offers for each dataset, each with its path inside the dataset.
 * `tier: 'core'` fields are always shown; `tier: 'detail'` fields are optional, folded away,
 * and grouped under the question (`q`) whose structured part they carry. Each filled one is
 * more for a machine to read and, for some, more for the check to compare. Everything else a
 * plan carries (from another tool, or written by hand) is kept untouched and still checked.
 *
 * Types, read and written by fieldValue and setFieldValue in plan.js:
 *   text, textarea, url, date   a string
 *   enum                        a string from `options`
 *   bool                        true or false (a yes/no select)
 *   integer                     a whole number
 *   list                        an array of strings, typed comma-separated
 *   lines                       an array of strings, typed one per line
 *   objlist                     an array of objects, one per line, the line in `prop`
 *   doi, licence, metadata      their own rules (an identifier object, a licence entry, a
 *                               metadata standard entry)
 */
export const DATASET_FIELDS = Object.freeze([
  { key: 'title', tier: 'core', type: 'text', path: ['title'] },
  { key: 'type', tier: 'core', type: 'text', path: ['type'] },
  { key: 'description', tier: 'core', type: 'textarea', path: ['description'] },
  { key: 'doi', tier: 'core', type: 'doi', path: ['dataset_id'] },
  { key: 'personal_data', tier: 'core', type: 'enum', options: ['yes', 'no', 'unknown'], path: ['personal_data'] },
  { key: 'sensitive_data', tier: 'core', type: 'enum', options: ['yes', 'no', 'unknown'], path: ['sensitive_data'] },
  { key: 'data_access', tier: 'core', type: 'enum', options: ['open', 'shared', 'closed'], path: [...DIST, 'data_access'] },
  { key: 'issued', tier: 'core', type: 'date', path: [...DIST, 'issued'] },
  { key: 'host_title', tier: 'core', type: 'text', path: [...HOST, 'title'] },
  { key: 'host_url', tier: 'core', type: 'url', path: [...HOST, 'url'] },
  { key: 'license_ref', tier: 'core', type: 'licence', path: [...DIST, 'license', 0, 'license_ref'] },
  { key: 'format', tier: 'core', type: 'list', path: [...DIST, 'format'] },

  { key: 'is_reused', tier: 'detail', q: '1a', type: 'bool', path: ['is_reused'] },
  { key: 'byte_size', tier: 'detail', q: '1b', type: 'integer', path: [...DIST, 'byte_size'] },
  { key: 'keyword', tier: 'detail', q: '2a', type: 'list', path: ['keyword'] },
  { key: 'metadata_standard', tier: 'detail', q: '2a', type: 'metadata', path: ['metadata', 0, 'metadata_standard_id', 'identifier'] },
  // The language of that metadata (ISO 639-3); left empty, the plan's language. Added 2026-10-20 from
  // the IT:U template, which asks for it.
  { key: 'metadata_language', tier: 'detail', q: '2a', type: 'text', path: ['metadata', 0, 'language'] },
  { key: 'data_quality_assurance', tier: 'detail', q: '2b', type: 'lines', path: ['data_quality_assurance'] },
  { key: 'storage_type', tier: 'detail', q: '3a', type: 'text', path: [...HOST, 'storage_type'] },
  { key: 'backup_type', tier: 'detail', q: '3a', type: 'text', path: [...HOST, 'backup_type'] },
  { key: 'backup_frequency', tier: 'detail', q: '3a', type: 'text', path: [...HOST, 'backup_frequency'] },
  { key: 'security_and_privacy', tier: 'detail', q: '3b', type: 'objlist', prop: 'title', path: ['security_and_privacy'] },
  { key: 'rights', tier: 'detail', q: '4b', type: 'textarea', path: ['rights'] },
  // The licence's start date: "If date is set in the future, it indicates embargo period" (maDMP
  // v1.2). Left empty, the publication date. Added 2026-10-20 from the IT:U template (Embargo).
  { key: 'license_start', tier: 'detail', q: '5a', type: 'date', path: [...DIST, 'license', 0, 'start_date'] },
  { key: 'preservation_statement', tier: 'detail', q: '5b', type: 'textarea', path: ['preservation_statement'] },
  { key: 'certified_with', tier: 'detail', q: '5b', type: 'enum', options: ['coretrustseal', 'din31644', 'dini-zertifikat', 'dsa', 'iso16363', 'iso16919', 'trac', 'wds'], path: [...HOST, 'certified_with'] },
  { key: 'available_until', tier: 'detail', q: '5b', type: 'date', path: [...DIST, 'available_until'] },
  { key: 'technical_resource', tier: 'detail', q: '5c', type: 'objlist', prop: 'name', path: ['technical_resource'] },
  { key: 'pid_system', tier: 'detail', q: '5d', type: 'list', path: [...HOST, 'pid_system'] },
].map((f) => Object.freeze({ ...f, path: Object.freeze(f.path), options: f.options ? Object.freeze(f.options) : undefined })));

/**
 * Optional plan-level detail, shown folded under the question it belongs to. `rows` fields are
 * repeatable entries (contributors, costs), each column with its own path inside an entry.
 */
export const PLAN_FIELDS = Object.freeze([
  { key: 'ethical_issues_description', q: '4c', type: 'textarea', path: ['ethical_issues_description'] },
  { key: 'ethical_issues_report', q: '4c', type: 'url', path: ['ethical_issues_report'] },
  {
    key: 'contributor', q: '6a', type: 'rows', path: ['contributor'],
    columns: [
      { key: 'name', type: 'text', path: ['name'] },
      { key: 'role', type: 'list', path: ['role'] },
      { key: 'id', type: 'personid', path: ['contributor_id'] },
      { key: 'mbox', type: 'text', path: ['mbox'] },
    ],
  },
  {
    key: 'cost', q: '6b', type: 'rows', path: ['cost'],
    columns: [
      { key: 'title', type: 'text', path: ['title'] },
      { key: 'value', type: 'number', path: ['value'] },
      { key: 'currency_code', type: 'text', path: ['currency_code'] },
      { key: 'description', type: 'text', path: ['description'] },
    ],
  },
].map((f) => Object.freeze(f)));

/** Licences offered in the editor, by the URL maDMP records. Any other URL can be typed. */
export const LICENCES = Object.freeze([
  { spdx: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
  { spdx: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { spdx: 'CC-BY-SA-4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  { spdx: 'CC-BY-NC-4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/' },
  { spdx: 'CC-BY-NC-SA-4.0', url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/' },
  { spdx: 'CC-BY-ND-4.0', url: 'https://creativecommons.org/licenses/by-nd/4.0/' },
  { spdx: 'CC-BY-NC-ND-4.0', url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/' },
  { spdx: 'ODbL-1.0', url: 'https://opendatacommons.org/licenses/odbl/1-0/' },
  { spdx: 'ODC-By-1.0', url: 'https://opendatacommons.org/licenses/by/1-0/' },
  { spdx: 'PDDL-1.0', url: 'https://opendatacommons.org/licenses/pddl/1-0/' },
].map((l) => Object.freeze(l)));
