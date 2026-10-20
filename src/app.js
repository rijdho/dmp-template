// UI wiring. Every decision lives in requirements.js, plan.js and evidence.js; this file only
// moves values between the DOM and those modules, which is what keeps the behaviour testable in
// Node without a browser. Only datacite.js touches the network.

import { DATASET_FIELDS, LICENCES, PLAN_FIELDS, QUESTIONS, QUESTION_IDS, SECTIONS, requiredQuestions } from './requirements.js?v=19';
import {
  completeness, createDataset, createPlan, currentVersion, editable, fieldValue, funderIdType, getIn, licenceKey,
  ID_TYPES, identifierAs, isLocalId, parsePlan, planToJson, planToMarkdown, saveVersion, setFieldValue, stamp, typedIdentifier,
  validatePlan, versionsOf,
} from './plan.js?v=19';
import { changeText, delays, diffPlans, diffToMarkdown } from './diff.js?v=19';
import { checkPlan } from './evidence.js?v=19';
import { MARK, formatReport } from './report.js?v=19';
import { RegistryError, dataciteRegistry } from './datacite.js?v=19';
import { LANGS, getLang, resolveLang, setLang, t } from './i18n/index.js?v=19';

const $ = (id) => document.getElementById(id);
const KEY = { draft: 'dmp-template:draft', lang: 'dmp-template:lang', theme: 'dmp-template:theme' };

const VIEWS = ['plan', 'check', 'compare', 'how', 'caveats', 'about'];
const VIEW_TITLE = { plan: 'nav.plan', check: 'nav.check', compare: 'nav.compare', how: 'how.title', caveats: 'caveats.title', about: 'about.title' };

let view = 'plan';
let plan = loadDraft() ?? editable(createPlan());
let lastCheck = null;
let controller = null;
let confirmNew = false;
let confirmToEditor = false;
let confirmRemove = null;
let lastDiff = null;
let dmpIdChosen = null;

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Translate with every interpolated value escaped, for strings that are inserted as HTML. */
const tHtml = (key, vars = {}) => t(key, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, escapeHtml(v)])));

const today = () => new Date().toISOString().slice(0, 10);

// ── storage (a per-browser convenience; never required for the page to work) ──

function loadDraft() {
  try {
    const raw = localStorage.getItem(KEY.draft);
    const parsed = raw ? parsePlan(raw).plan : null;
    return parsed ? editable(parsed) : null;
  } catch {
    return null;
  }
}

let saveTimer = null;
function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY.draft, JSON.stringify(plan)); } catch { /* private mode */ }
  }, 300);
}

// ── views ─────────────────────────────────────────────────────────────────────

function showView(next, { push = true } = {}) {
  view = VIEWS.includes(next) ? next : 'plan';
  for (const node of document.querySelectorAll('.view')) node.hidden = node.dataset.view !== view;
  for (const b of document.querySelectorAll('.nav-item')) b.classList.toggle('active', b.dataset.view === view);
  $('cmd-title').textContent = t(VIEW_TITLE[view]);
  closeRail();
  if (push) writeUrl();
}

function writeUrl() {
  const q = new URLSearchParams();
  if (view !== 'plan') q.set('view', view);
  if (getLang() !== 'en') q.set('lang', getLang());
  const s = q.toString();
  history.replaceState(null, '', s ? `?${s}` : location.pathname);
}

function openRail() {
  $('app').classList.add('rail-open');
  $('menu').setAttribute('aria-expanded', 'true');
}
function closeRail() {
  $('app').classList.remove('rail-open');
  $('menu').setAttribute('aria-expanded', 'false');
}

// ── i18n and theme ────────────────────────────────────────────────────────────

function applyI18n() {
  document.documentElement.lang = getLang();
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-html]')) node.innerHTML = t(node.dataset.i18nHtml);
  for (const node of document.querySelectorAll('[data-i18n-attr]'))
    for (const pair of node.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      if (attr && key) node.setAttribute(attr.trim(), t(key.trim()));
    }
  for (const b of $('lang').querySelectorAll('button')) b.setAttribute('aria-current', String(b.dataset.code === getLang()));
  $('cmd-title').textContent = t(VIEW_TITLE[view]);
  // Everything drawn from data carries translated labels, so it is redrawn.
  renderSelects();
  fillMeta();
  renderQuestions();
  renderDatasets();
  renderValidity();
  renderVersions();
  renderQuestionTable();
  if (lastCheck) renderCheck(lastCheck);
  if (lastDiff) renderDiff(lastDiff);
}

function initLang() {
  // One language needs no switcher; the slot stays for when a second one arrives.
  $('lang').hidden = LANGS.length < 2;
  $('lang').innerHTML = LANGS.map(
    (l) => `<button type="button" data-code="${l.code}" aria-current="false" title="${escapeHtml(l.label)}">${l.code.toUpperCase()}</button>`,
  ).join('');
  $('lang').addEventListener('click', (e) => {
    const code = e.target.closest('button')?.dataset.code;
    if (!code) return;
    setLang(code);
    try { localStorage.setItem(KEY.lang, code); } catch { /* private mode */ }
    applyI18n();
    writeUrl();
  });
  let stored = null;
  try { stored = localStorage.getItem(KEY.lang); } catch { /* private mode */ }
  const fromUrl = new URLSearchParams(location.search).get('lang');
  setLang(resolveLang(fromUrl || stored, navigator.languages ?? [navigator.language]));
}

function initTheme() {
  $('theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY.theme, next); } catch { /* private mode */ }
  });
}

// ── the plan: metadata and project ────────────────────────────────────────────

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[keys.at(-1)] = value;
}

const options = (values, labelKey, current) =>
  values.map((v) => `<option value="${v}" ${current === v ? 'selected' : ''}>${escapeHtml(t(labelKey(v)))}</option>`).join('');

function renderSelects() {
  $('ethics').innerHTML = options(['yes', 'no', 'unknown'], (v) => `opt.${v}`, plan.dmp.ethical_issues_exist);
  $('funding-status').innerHTML = options(['planned', 'applied', 'granted', 'rejected'], (v) => `opt.funding_status.${v}`,
    plan.dmp.project[0].funding[0].funding_status);
}

function fillMeta() {
  for (const input of document.querySelectorAll('[data-bind]')) {
    const bind = input.dataset.bind;
    if (bind === 'dmp_id') input.value = isLocalId(plan.dmp.dmp_id) ? '' : plan.dmp.dmp_id?.identifier ?? '';
    else if (bind === 'dmp_id_type') continue;
    else input.value = getPath(plan.dmp, bind) ?? '';
  }
  renderDmpIdType();
}

/**
 * The type next to the plan's identifier: "recognise" by default, whose label says what it
 * recognised, or a type the person chose, which then wins over the recognition.
 */
function renderDmpIdType() {
  const id = plan.dmp.dmp_id;
  const value = isLocalId(id) ? '' : id?.identifier ?? '';
  // Recognise what was typed, not what was stored: `hdl:1/2` is stored as `1/2`.
  const recognised = typedIdentifier($('dmp-id').value || value)?.type;
  const chosen = dmpIdChosen ?? (value && id?.type !== recognised ? id?.type : '');
  $('dmp-id-type').innerHTML = [
    `<option value="">${escapeHtml(recognised ? t('opt.idtype.auto.as', { type: t(`opt.idtype.${recognised}`) }) : t('opt.idtype.auto'))}</option>`,
    ...ID_TYPES.map((x) => `<option value="${x}">${escapeHtml(t(`opt.idtype.${x}`))}</option>`),
  ].join('');
  $('dmp-id-type').value = chosen;
}

/** The plan's identifier from the field and the type select, or a local one when blank. */
function updateDmpId() {
  const chosen = $('dmp-id-type').value;
  dmpIdChosen = chosen;
  plan.dmp.dmp_id = identifierAs($('dmp-id').value, chosen) ?? createPlan().dmp.dmp_id;
}

function onMetaInput(e) {
  const input = e.target.closest('[data-bind]');
  if (!input) return;
  const bind = input.dataset.bind;
  const value = input.value;
  if (bind === 'dmp_id') {
    // A DOI for the plan replaces the local identifier; clearing it brings a local one back.
    // A persistent identifier replaces the local one; clearing it brings a local one back.
    updateDmpId();
    renderDmpIdType();
  } else if (bind === 'dmp_id_type') {
    updateDmpId();
    renderDmpIdType();
  } else setPath(plan.dmp, bind, value);
  const funding = plan.dmp.project[0].funding[0];
  if (bind.endsWith('funder_id.identifier')) funding.funder_id.type = funderIdType(value);
  if (bind === 'ethical_issues_exist') renderQuestionCount();
  if (bind.endsWith('grant_id.identifier')) funding.grant_id.type = /^https?:\/\//i.test(value.trim()) ? 'url' : 'other';
  changed();
}

function changed() {
  plan = stamp(plan);
  saveDraft();
  renderValidity();
  renderVersions();
}

// ── the plan: optional detail, shared by questions and datasets ──────────────

/** The label of a field: its own key, else the column key of a row field. */
const fieldLabel = (fd, prefix = 'field') => t(`${prefix}.${fd.key}`);
const placeholder = (key) => (t(key) !== key ? ` placeholder="${escapeHtml(t(key))}"` : '');

/**
 * One form control for a field spec (see DATASET_FIELDS in requirements.js). `attrs` carries
 * the data attributes that say where the value goes; `value` is what fieldValue read.
 */
function control(fd, value, attrs, { label = fieldLabel(fd), phKey = `field.${fd.key}.ph` } = {}) {
  const lab = escapeHtml(label);
  if (fd.type === 'enum' || fd.type === 'bool') {
    const opts = fd.type === 'bool' ? ['yes', 'no'] : fd.options;
    const key = fd.type === 'bool' ? (v) => `opt.${v}` : fd.key === 'data_access' ? (v) => `opt.data_access.${v}`
      : fd.key === 'certified_with' ? (v) => `opt.certified_with.${v}` : (v) => `opt.${v}`;
    const unset = fd.tier === 'core' && fd.type === 'enum' ? '' : `<option value="">${escapeHtml(t('opt.unset'))}</option>`;
    return `<label class="field"><span>${lab}</span><select class="input" ${attrs}>${unset}${options(opts, key, value)}</select></label>`;
  }
  if (fd.type === 'textarea' || fd.type === 'lines' || fd.type === 'objlist')
    return `<label class="field span2"><span>${lab}</span><textarea class="input" rows="2" ${attrs}>${escapeHtml(value)}</textarea></label>`;
  const type = fd.type === 'date' ? 'date' : fd.type === 'url' || fd.type === 'metadata' ? 'url' : fd.type === 'integer' || fd.type === 'number' ? 'number' : 'text';
  const wide = fd.key === 'title' && fd.tier === 'core' ? ' span2' : '';
  return `<label class="field${wide}"><span>${lab}</span>
    <input class="input" type="${type}" ${attrs} value="${escapeHtml(value)}" autocomplete="off" spellcheck="false"${placeholder(phKey)} /></label>`;
}

const detailBlock = (inner, open) => `<details class="commit detail" ${open ? 'open' : ''}><summary>${escapeHtml(t('plan.detail.toggle'))}</summary>
  <p class="hint">${escapeHtml(t('plan.detail.hint'))}</p>${inner}</details>`;

// ── the plan: questions ───────────────────────────────────────────────────────

function guideList(id) {
  // One line per bullet; a line starting with › is a sub-bullet of the one before it.
  const items = [];
  for (const line of t(`q.${id}.guide`).split('\n')) {
    if (line.startsWith('› ') && items.length) items.at(-1).subs.push(line.slice(2));
    else items.push({ text: line, subs: [] });
  }
  return `<ul class="guide">${items.map((i) => `<li>${escapeHtml(i.text)}${i.subs.length
    ? `<ul>${i.subs.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>`;
}

/** The rows of a repeatable plan field (contributors, costs) and their add button. */
function rowsControl(fd) {
  const list = getIn(plan.dmp, fd.path);
  const rows = Array.isArray(list) ? list : [];
  const body = rows.map((row, r) => `<div class="row-entry">
    <div class="grid4">${fd.columns.map((c) => control(c, fieldValue(row, c), `data-pf="${fd.key}" data-row="${r}" data-col="${c.key}"`,
      { label: t(`col.${fd.key}.${c.key}`), phKey: `col.${fd.key}.${c.key}.ph` })).join('')}</div>
    <button class="btn ghost small danger-quiet" type="button" data-row-remove="${fd.key}" data-row="${r}">${escapeHtml(t('plan.rows.remove'))}</button>
  </div>`).join('');
  return `<div class="rows"><p class="field-title">${escapeHtml(fieldLabel(fd))}</p>${body}
    <button class="btn ghost small" type="button" data-row-add="${fd.key}">${escapeHtml(t('plan.rows.add'))}</button></div>`;
}

function planDetail(q) {
  const fields = PLAN_FIELDS.filter((f) => f.q === q.id);
  if (!fields.length) return '';
  const filled = fields.some((f) => (f.type === 'rows' ? (getIn(plan.dmp, f.path) ?? []).length : fieldValue(plan.dmp, f)));
  const inner = fields.map((f) => (f.type === 'rows' ? rowsControl(f) : `<div class="grid2">${control(f, fieldValue(plan.dmp, f), `data-pf="${f.key}"`)}</div>`)).join('');
  return detailBlock(inner, filled);
}

function renderQuestions() {
  const answers = plan.dmp.actionable_dmp.answers;
  $('questions').innerHTML = SECTIONS.map((sec) => `
    <section class="qsection">
      <h3 class="qsection-h"><span class="mono">${sec}</span> ${escapeHtml(t(`sec.${sec}`))}</h3>
      ${QUESTIONS.filter((q) => q.section === sec).map((q) => `
        <article class="req" id="q-${q.id}" data-answered="${Boolean(answers[q.id]?.trim())}">
          <p class="eyebrow">${escapeHtml(q.id)}</p>
          <p class="question">${escapeHtml(t(`q.${q.id}`))}</p>
          ${q.id === '4a' || q.id === '4c' ? `<p class="hint when" id="when-${q.id}"></p>` : ''}
          <details class="commit"><summary>${escapeHtml(t('plan.guide.toggle'))}</summary>${guideList(q.id)}</details>
          <label class="field"><span>${escapeHtml(t('plan.answer.label'))}</span>
            <textarea class="input" rows="3" data-q="${q.id}"
              placeholder="${escapeHtml(t('plan.answer.ph'))}">${escapeHtml(answers[q.id] ?? '')}</textarea></label>
          <p class="hint">${escapeHtml(t('plan.madmp.hint', { fields: q.madmp.map((p) => p.replace(/^\/dmp\//, '')).join(', ') }))}</p>
          <div id="pd-${q.id}">${planDetail(q)}</div>
        </article>`).join('')}
    </section>`).join('');
  renderQuestionCount();
}

/** The count, and for 4a and 4c whether this plan, as it stands, requires them. */
function renderQuestionCount() {
  const c = completeness(plan);
  $('q-count').textContent = t('plan.questions.count', { a: c.answered, n: c.required });
  const required = requiredQuestions(plan);
  for (const id of ['4a', '4c']) {
    const node = $(`when-${id}`);
    if (node) node.textContent = required.includes(id) ? t(`q.${id}.when`) : `${t(`q.${id}.when`)} ${t('q.notRequired')}`;
  }
}

function onQuestionInput(e) {
  const node = e.target.closest('[data-q]');
  if (node) {
    plan.dmp.actionable_dmp.answers[node.dataset.q] = node.value;
    $(`q-${node.dataset.q}`).dataset.answered = String(Boolean(node.value.trim()));
    renderQuestionCount();
    changed();
    return;
  }
  const pf = e.target.closest('[data-pf]');
  if (!pf) return;
  const fd = PLAN_FIELDS.find((f) => f.key === pf.dataset.pf);
  if (fd.type === 'rows') {
    const row = getIn(plan.dmp, fd.path)[Number(pf.dataset.row)];
    setFieldValue(row, fd.columns.find((c) => c.key === pf.dataset.col), pf.value);
  } else setFieldValue(plan.dmp, fd, pf.value);
  changed();
}

function onQuestionClick(e) {
  const add = e.target.closest('[data-row-add]');
  const remove = e.target.closest('[data-row-remove]');
  const key = add?.dataset.rowAdd ?? remove?.dataset.rowRemove;
  if (!key) return;
  const fd = PLAN_FIELDS.find((f) => f.key === key);
  const list = getIn(plan.dmp, fd.path);
  if (add) {
    if (!Array.isArray(list)) plan.dmp[fd.path[0]] = [];
    getIn(plan.dmp, fd.path).push({});
  } else list.splice(Number(remove.dataset.row), 1);
  $(`pd-${fd.q}`).innerHTML = planDetail(QUESTIONS.find((q) => q.id === fd.q));
  $(`pd-${fd.q}`).querySelector('details').open = true;
  changed();
}

// ── the plan: datasets ────────────────────────────────────────────────────────

const fieldByKey = (key) => DATASET_FIELDS.find((f) => f.key === key);

function dsControl(i, ds, fd) {
  const id = `ds-${i}-${fd.key}`;
  const value = fieldValue(ds, fd);
  const attrs = `id="${id}" data-ds="${i}" data-key="${fd.key}"`;
  if (fd.type === 'licence') {
    const known = LICENCES.find((l) => licenceKey(l.url) === licenceKey(value));
    const opts = [`<option value="">${escapeHtml(t('opt.unset'))}</option>`,
      ...LICENCES.map((l) => `<option value="${escapeHtml(l.url)}" ${known === l ? 'selected' : ''}>${escapeHtml(l.spdx)}</option>`),
      `<option value="other" ${value && !known ? 'selected' : ''}>${escapeHtml(t('opt.licence.other'))}</option>`];
    return `<label class="field"><span>${escapeHtml(t('field.license_ref'))}</span><select class="input" id="${id}-pick" data-ds="${i}" data-licence-pick>${opts.join('')}</select></label>
      <label class="field"><span>${escapeHtml(t('field.license_url'))}</span>
        <input class="input" type="url" ${attrs} value="${escapeHtml(value)}" autocomplete="off" spellcheck="false" /></label>`;
  }
  return control(fd, value, attrs);
}

function datasetCard(ds, i) {
  const extra = (ds.distribution?.length ?? 1) - 1;
  const core = DATASET_FIELDS.filter((f) => f.tier === 'core');
  const detail = DATASET_FIELDS.filter((f) => f.tier === 'detail');
  const groups = [...new Set(detail.map((f) => f.q))].map((q) => `<p class="field-title">${escapeHtml(t('plan.detail.for', { id: q }))}</p>
    <div class="grid2">${detail.filter((f) => f.q === q).map((f) => dsControl(i, ds, f)).join('')}</div>`).join('');
  const filled = detail.some((f) => fieldValue(ds, f) !== '');
  return `<article class="req dataset" id="ds-${i}">
    <header class="req-h ds-h">
      <p class="eyebrow">${escapeHtml(t('ds.untitled', { n: i + 1 }))}</p>
      <button class="btn ghost small danger-quiet" type="button" data-remove="${i}">${escapeHtml(t('plan.datasets.remove'))}</button>
    </header>
    <div class="grid2">${core.map((fd) => dsControl(i, ds, fd)).join('')}</div>
    ${detailBlock(groups, filled)}
    ${extra > 0 ? `<p class="hint">${escapeHtml(t('ds.extra', { n: extra }))}</p>` : ''}
  </article>`;
}

function renderDatasets() {
  confirmRemove = null;
  $('datasets').innerHTML = plan.dmp.dataset.map(datasetCard).join('');
  $('ds-count').textContent = t('plan.datasets.count', { n: plan.dmp.dataset.length });
}

function onDatasetInput(e) {
  const pick = e.target.closest('[data-licence-pick]');
  if (pick) {
    const i = Number(pick.dataset.ds);
    const urlInput = $(`ds-${i}-license_ref`);
    if (pick.value !== 'other') {
      urlInput.value = pick.value;
      setFieldValue(plan.dmp.dataset[i], fieldByKey('license_ref'), pick.value);
      changed();
    } else urlInput.focus();
    return;
  }
  const node = e.target.closest('[data-ds][data-key]');
  if (!node) return;
  const i = Number(node.dataset.ds);
  setFieldValue(plan.dmp.dataset[i], fieldByKey(node.dataset.key), node.value, { language: plan.dmp.language || 'eng' });
  if (node.dataset.key === 'license_ref') {
    const known = LICENCES.find((l) => licenceKey(l.url) === licenceKey(node.value));
    $(`ds-${i}-license_ref-pick`).value = known ? known.url : node.value.trim() ? 'other' : '';
  }
  // Personal data decides whether 4a is required.
  if (node.dataset.key === 'personal_data') renderQuestionCount();
  changed();
}

function onDatasetClick(e) {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  const i = Number(btn.dataset.remove);
  // Two clicks rather than a confirm() dialog, as for Start over.
  if (confirmRemove !== i) {
    confirmRemove = i;
    btn.textContent = t('plan.datasets.remove.confirm');
    setTimeout(() => { if (confirmRemove === i) { confirmRemove = null; btn.textContent = t('plan.datasets.remove'); } }, 4000);
    return;
  }
  plan.dmp.dataset.splice(i, 1);
  renderDatasets();
  renderQuestionCount();
  changed();
}

function onAddDataset() {
  plan.dmp.dataset.push(editable({ dmp: { dataset: [createDataset()] } }).dmp.dataset[0]);
  renderDatasets();
  renderQuestionCount();
  changed();
  $(`ds-${plan.dmp.dataset.length - 1}-title`)?.focus();
}

// ── the plan: versions ────────────────────────────────────────────────────────

function renderVersions() {
  const versions = versionsOf(plan);
  $('ver-list').innerHTML = versions.length
    ? [...versions].reverse().map((v) => `<li><b>${escapeHtml(t('ver.item', { n: v.version, date: String(v.date).slice(0, 10) }))}</b>${v.note ? ` <span class="muted">${escapeHtml(v.note)}</span>` : ''}</li>`).join('')
    : `<li class="muted">${escapeHtml(t('ver.none'))}</li>`;
  const last = versions.at(-1);
  const changedSince = last && Date.parse(plan.dmp.modified) > Date.parse(last.date);
  $('ver-changed').hidden = !changedSince;
  if (changedSince) $('ver-changed').textContent = t('ver.changedSince', { n: last.version });
  $('ver-save').textContent = t('ver.save', { n: currentVersion(plan) + 1 });
}

function onSaveVersion() {
  plan = saveVersion(plan, $('ver-note').value);
  const n = currentVersion(plan);
  saveDraft();
  download(`dmp-v${n}.json`, planToJson(plan), 'application/json');
  $('ver-note').value = '';
  renderVersions();
  renderValidity();
  $('ver-status').textContent = t('ver.saved', { n });
}

// ── the plan: validity ────────────────────────────────────────────────────────

/** A field path as validation writes it (`distribution[0].host.url`), for each dataset field. */
const dotted = (path) => path.map((k, i) => (typeof k === 'number' ? `[${k}]` : i ? `.${k}` : k)).join('');
const DS_FIELD_PATH = {
  ...Object.fromEntries(DATASET_FIELDS.map((f) => [dotted(f.path), f.key])),
  'dataset_id.identifier': 'doi', 'distribution[0].license[0].start_date': 'license_ref',
  'distribution[0].host': 'host_url', 'metadata[0]': 'metadata_standard',
};

/** A problem's path in words: the label the visitor sees next to the field. */
function problemLabel(path) {
  const META = {
    'dmp.title': 'plan.title.label', 'dmp.language': 'plan.lang.label', 'dmp.contact': 'plan.contact.label',
    'dmp.contact.name': 'plan.contact.label', 'dmp.contact.mbox': 'plan.mbox.label',
    'dmp.contact.contact_id': 'plan.orcid.label', 'dmp.contact.contact_id.identifier': 'plan.orcid.label',
    'dmp.dmp_id.identifier': 'plan.dmpId.label', 'dmp.ethical_issues_exist': 'plan.ethics.label',
    'dmp.project[0].title': 'plan.project.label', 'dmp.project[0].start': 'plan.start.label', 'dmp.project[0].end': 'plan.end.label',
    'dmp.project[0].funding[0].funder_id.identifier': 'plan.funder.label',
    'dmp.project[0].funding[0].grant_id': 'plan.grant.label', 'dmp.project[0].funding[0].grant_id.identifier': 'plan.grant.label',
    'dmp.dataset': 'plan.datasets.title', 'dmp.modified': 'md.modified', 'dmp.created': 'md.created',
  };
  if (META[path]) return t(META[path]);
  const q = /^dmp\.actionable_dmp\.answers\.(\w+)$/.exec(path);
  if (q && QUESTION_IDS.includes(q[1])) return q[1];
  const pf = /^dmp\.(contributor|cost)\[(\d+)\](?:\.(\w+))?/.exec(path);
  if (pf) return `${t(`field.${pf[1]}`)} ${Number(pf[2]) + 1}${pf[3] ? `: ${pf[3]}` : ''}`;
  const top = PLAN_FIELDS.find((f) => path === `dmp.${f.key}`);
  if (top) return t(`field.${top.key}`);
  const m = /^dmp\.dataset\[(\d+)\](?:\.(.+))?$/.exec(path);
  if (m) {
    const n = t('ds.untitled', { n: Number(m[1]) + 1 });
    const field = m[2] && DS_FIELD_PATH[m[2]];
    return field ? `${n}: ${t(`field.${field}`)}` : m[2] ? `${n}: ${m[2]}` : n;
  }
  return path;
}

function problemItems(problems) {
  return problems.map((p) => `<li class="${p.severity}"><b>${escapeHtml(problemLabel(p.path))}</b> ${escapeHtml(t(p.code, p.vars))}</li>`).join('');
}

function renderValidity() {
  const problems = validatePlan(plan);
  const errors = problems.filter((p) => p.severity === 'error');
  const warnings = problems.filter((p) => p.severity === 'warning');
  const parts = [errors.length ? t('plan.valid.errors', { n: errors.length }) : t('plan.valid.ok')];
  if (warnings.length) parts.push(t('plan.valid.warnings', { n: warnings.length }));
  const box = $('validity');
  box.textContent = parts.join(' ');
  box.dataset.state = errors.length ? 'error' : 'ok';
  // Warnings that are not unanswered questions are worth reading; the count of those is not.
  const shown = [...errors, ...warnings.filter((w) => w.code !== 'val.unanswered')];
  $('problems').innerHTML = problemItems(shown);
  $('problems').hidden = shown.length === 0;
  const c = completeness(plan);
  $('completeness').textContent = c.complete
    ? t('plan.complete.ok', { n: c.required })
    : t('plan.complete.missing', { a: c.answered, n: c.required, ids: c.missing.join(', ') });
  $('completeness').dataset.state = c.complete ? 'ok' : 'open';
}

// ── the plan: files ───────────────────────────────────────────────────────────

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadIntoEditor(next) {
  plan = editable(next);
  dmpIdChosen = null;
  saveDraft();
  renderSelects();
  fillMeta();
  renderQuestions();
  renderDatasets();
  renderValidity();
  renderVersions();
}

async function onImport(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const parsed = parsePlan(await file.text());
  if (parsed.error) {
    $('import-status').textContent = t('plan.importFailed', { reason: t(parsed.error) });
    return;
  }
  loadIntoEditor(parsed.plan);
  // The button is at the top and the validity box at the bottom, so say it next to the button.
  $('import-status').textContent = `${t('plan.imported')} ${$('validity').textContent}`;
}

function onNew() {
  // Two clicks rather than a confirm() dialog: a modal dialog blocks the page, and a draft is
  // one keystroke from being recoverable only if it was downloaded.
  if (!confirmNew) {
    confirmNew = true;
    $('new-plan').textContent = t('plan.new.confirm');
    setTimeout(() => { confirmNew = false; $('new-plan').textContent = t('plan.new'); }, 4000);
    return;
  }
  confirmNew = false;
  $('new-plan').textContent = t('plan.new');
  loadIntoEditor(createPlan());
  $('import-status').textContent = '';
}

// ── the check ─────────────────────────────────────────────────────────────────

function showError(key, vars) {
  const box = $('check-error');
  box.textContent = t(key, vars);
  box.hidden = false;
}

function onSourceChange() {
  const source = document.querySelector('input[name="source"]:checked')?.value ?? 'editor';
  $('check-file-field').hidden = source !== 'file';
}

async function onCheck(e) {
  e.preventDefault();
  $('check-error').hidden = true;
  // A result stays on screen only while it answers the question being asked: left under the
  // error of a new check, it reads as the result for the new plan.
  $('check-results').hidden = true;
  lastCheck = null;
  const source = document.querySelector('input[name="source"]:checked')?.value ?? 'editor';
  let checked = plan;
  if (source === 'file') {
    const file = $('check-file').files?.[0];
    if (!file) return showError('check.noFile');
    const parsed = parsePlan(await file.text());
    if (parsed.error) return showError('err.badPlan', { reason: t(parsed.error) });
    checked = parsed.plan;
  }
  controller?.abort();
  controller = new AbortController();
  $('check-go').disabled = true;
  $('check-status').textContent = t('check.running');
  try {
    const day = today();
    const result = await checkPlan(checked, dataciteRegistry({ signal: controller.signal }), { today: day });
    // `plan` in a result is the list of plan-level checks; the checked plan travels as `doc`.
    lastCheck = { ...result, problems: validatePlan(checked), doc: checked, source, today: day };
    renderCheck(lastCheck);
  } catch (err) {
    if (err?.name === 'AbortError') return;
    if (err instanceof RegistryError) showError(err.code, err.vars);
    else showError('err.network');
  } finally {
    $('check-go').disabled = false;
    $('check-status').textContent = '';
  }
}

const doiLink = (doi) => (doi
  ? ` <a class="file-link mono" href="https://doi.org/${escapeHtml(doi)}" target="_blank" rel="noreferrer" title="${escapeHtml(t('check.openRecord'))}">${escapeHtml(doi)} ↗</a>`
  : '');

const checkItems = (checks) => `<ul class="checks">${checks.map((k) => `
  <li data-outcome="${k.outcome}"><span class="mark" aria-hidden="true">${MARK[k.outcome]}</span>
    <span class="chk-name">${escapeHtml(t(`chk.${k.id}`))}</span>
    <span class="chk-out mono">${escapeHtml(t(`out.${k.outcome}`))}</span>
    <span class="chk-det">${escapeHtml(t(k.detail, k.vars))}</span></li>`).join('')}</ul>`;

function renderCheck(c) {
  const s = c.summary;
  $('check-results').hidden = false;
  $('check-of').textContent = t('check.of', { title: c.doc?.dmp?.title || t('md.untitled'), today: c.today });
  $('to-editor').hidden = c.source !== 'file';
  confirmToEditor = false;
  $('to-editor').textContent = t('check.toEditor');
  $('check-stats').innerHTML = [
    ['answered', tHtml('sum.answered', { a: s.answered, n: s.questions })],
    ['evidenced', tHtml('sum.evidenced', { e: s.evidenced, n: s.datasets, p: s.published })],
    ['failing', tHtml('sum.failing', { m: s.failing })],
  ].map(([k, html]) => `<div class="stat" data-k="${k}">${html}</div>`).join('');

  const errors = c.problems.filter((p) => p.severity === 'error');
  $('check-notes').innerHTML = errors.length ? `<p class="hint">${escapeHtml(t('check.plan.invalid', { n: errors.length }))}</p>` : '';
  $('check-problems').innerHTML = problemItems(errors);
  $('check-problems').hidden = errors.length === 0;

  $('check-plan').innerHTML = c.plan.length ? `
    <div class="verdict" data-verdict="${c.plan.some((k) => k.outcome === 'missing') ? 'missing' : 'evidenced'}">
      <div class="verdict-h"><span class="verdict-title">${escapeHtml(t('check.planLevel'))}</span></div>
      ${checkItems(c.plan)}
    </div>` : '';

  $('check-list').innerHTML = c.datasets.map((d) => `
    <div class="verdict" data-verdict="${d.verdict}">
      <div class="verdict-h">
        <span class="verdict-title">${escapeHtml(d.title || t('ds.untitled', { n: d.index + 1 }))}</span>
        <span class="tag" data-verdict="${d.verdict}">${escapeHtml(t(`verdict.${d.verdict}`))}</span>
        <span class="muted mono">${escapeHtml(t(`phase.${d.phase}`, { date: d.issued ?? '' }))}</span>
        ${doiLink(d.doi)}
      </div>
      ${d.checks.length ? checkItems(d.checks) : ''}
    </div>`).join('');

  $('check-unlisted').innerHTML = c.unlisted.map((g) => `
    <div class="unlisted">
      <h3 class="panel-title">${escapeHtml(t('unlisted.title', { grant: g.grant }))}</h3>
      ${g.deposits.length ? `<p class="hint">${escapeHtml(t('unlisted.lede'))}</p>
      <ul class="deposits">${g.deposits.map((dep) => `<li>${doiLink(dep.doi)} <span class="muted">${escapeHtml([dep.type, dep.year].filter(Boolean).join(', '))}</span></li>`).join('')}
        ${g.total > g.read ? `<li class="muted">${escapeHtml(t('unlisted.more', { n: g.total - g.read }))}</li>` : ''}</ul>`
        : `<p class="hint">${escapeHtml(t('unlisted.none', { grant: g.grant }))}</p>`}
    </div>`).join('');
}

function onDownloadReport() {
  if (!lastCheck) return;
  const text = formatReport(lastCheck, lastCheck.problems, { format: 'md', t, planPath: lastCheck.doc?.dmp?.title || 'dmp.json' });
  download(`dmp-report-${lastCheck.today}.md`, text, 'text/markdown');
}

function onToEditor() {
  if (!lastCheck || lastCheck.source !== 'file') return;
  // Two clicks, as for Start over: this replaces whatever is in the editor.
  if (!confirmToEditor) {
    confirmToEditor = true;
    $('to-editor').textContent = t('check.toEditor.confirm');
    setTimeout(() => { confirmToEditor = false; $('to-editor').textContent = t('check.toEditor'); }, 4000);
    return;
  }
  confirmToEditor = false;
  loadIntoEditor(structuredClone(lastCheck.doc));
  showView('plan');
  $('import-status').textContent = `${t('plan.imported')} ${$('validity').textContent}`;
}

// ── comparing versions ────────────────────────────────────────────────────────

async function readPlanFile(input) {
  const file = input.files?.[0];
  if (!file) return { missing: true };
  return parsePlan(await file.text());
}

function cmpError(key, vars) {
  $('cmp-error').textContent = t(key, vars);
  $('cmp-error').hidden = false;
}

async function onCompare(e) {
  e.preventDefault();
  $('cmp-error').hidden = true;
  $('cmp-results').hidden = true;
  lastDiff = null;
  const before = await readPlanFile($('cmp-before'));
  if (before.missing) return cmpError('cmp.noFile');
  if (before.error) return cmpError('err.badPlan', { reason: t(before.error) });
  let after = { plan };
  const fromEditor = document.querySelector('input[name="cmp-after"]:checked')?.value !== 'file';
  if (!fromEditor) {
    after = await readPlanFile($('cmp-after-file'));
    if (after.missing) return cmpError('cmp.noAfter');
    if (after.error) return cmpError('err.badPlan', { reason: t(after.error) });
  }
  lastDiff = diffPlans(before.plan, after.plan);
  // The editor holds the latest version plus whatever changed since; it is not that version.
  lastDiff.fromLabel = versionLabel(lastDiff.from);
  lastDiff.toLabel = fromEditor ? t('cmp.editor') : versionLabel(lastDiff.to);
  renderDiff(lastDiff);
}

const versionLabel = (n) => (n ? t('cmp.version', { n }) : t('cmp.unversioned'));

function renderDiff(d) {
  $('cmp-results').hidden = false;
  $('cmp-of').textContent = `${t('cmp.of', { from: d.fromLabel, to: d.toLabel })} · ${t('cmp.count', { n: d.changes.length })}`;
  const late = delays(d);
  $('cmp-delays').innerHTML = late.length ? `<div class="verdict" data-verdict="pending">
    <div class="verdict-h"><span class="verdict-title">${escapeHtml(t('cmp.delays', { n: late.length }))}</span></div>
    <ul class="changes">${late.map((c) => `<li>${escapeHtml(t('cmp.delay', { title: c.title, before: c.before, after: c.after, days: c.days }))}</li>`).join('')}</ul></div>` : '';
  $('cmp-list').innerHTML = d.changes.length
    ? d.changes.map((c) => `<li data-kind="${c.kind}">${escapeHtml(changeText(c, t))}</li>`).join('')
    : `<li class="muted">${escapeHtml(t('cmp.none'))}</li>`;
}

function onDownloadDiff() {
  if (!lastDiff) return;
  download(`dmp-changes-v${lastDiff.from}-v${lastDiff.to}.md`, diffToMarkdown(lastDiff, t, { fromLabel: lastDiff.fromLabel, toLabel: lastDiff.toLabel }), 'text/markdown');
}

// ── how it works: the questions table ────────────────────────────────────────

/** Which checks read the fields that carry each question's structured part. */
const CHECKS_BY_QUESTION = {
  '1b': ['ds.format'], '4b': ['ds.licence'], '5a': ['ds.access'], '5b': ['ds.host'], '5d': ['ds.pid'],
};

function renderQuestionTable() {
  const head = `<thead><tr><th>${escapeHtml(t('how.th.q'))}</th><th class="src">${escapeHtml(t('how.th.madmp'))}</th><th>${escapeHtml(t('how.th.checks'))}</th></tr></thead>`;
  const rows = QUESTIONS.map((q) => `<tr>
    <td><b>${q.id}</b> ${escapeHtml(t(`q.${q.id}`))}</td>
    <td class="xw">${q.madmp.map((p) => `<code>${escapeHtml(p.replace(/^\/dmp\//, ''))}</code>`).join('<br>')}</td>
    <td>${escapeHtml((CHECKS_BY_QUESTION[q.id] ?? []).map((id) => t(`chk.${id}`)).join(', ') || t('how.none'))}</td></tr>`).join('');
  $('q-table').innerHTML = head + `<tbody>${rows}</tbody>`;
}

// ── start ─────────────────────────────────────────────────────────────────────

function init() {
  initLang();
  initTheme();

  document.querySelector('.rail nav').addEventListener('click', (e) => {
    const next = e.target.closest('.nav-item')?.dataset.view;
    if (next) showView(next);
  });
  $('menu').addEventListener('click', () => ($('app').classList.contains('rail-open') ? closeRail() : openRail()));
  $('rail-backdrop').addEventListener('click', closeRail);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRail(); });

  for (const id of ['meta', 'project']) {
    $(id).addEventListener('input', onMetaInput);
    $(id).addEventListener('change', onMetaInput);
  }
  $('questions').addEventListener('input', onQuestionInput);
  $('questions').addEventListener('change', onQuestionInput);
  $('questions').addEventListener('click', onQuestionClick);
  $('ver-save').addEventListener('click', onSaveVersion);
  $('cmp-form').addEventListener('submit', onCompare);
  $('cmp-dl').addEventListener('click', onDownloadDiff);
  for (const r of document.querySelectorAll('input[name="cmp-after"]'))
    r.addEventListener('change', () => { $('cmp-after-field').hidden = document.querySelector('input[name="cmp-after"]:checked')?.value !== 'file'; });
  $('datasets').addEventListener('input', onDatasetInput);
  $('datasets').addEventListener('change', onDatasetInput);
  $('datasets').addEventListener('click', onDatasetClick);
  $('add-dataset').addEventListener('click', onAddDataset);
  $('dl-json').addEventListener('click', () => download('dmp.json', planToJson(plan), 'application/json'));
  $('dl-md').addEventListener('click', () => download('DMP.md', planToMarkdown(plan, t), 'text/markdown'));
  $('dl-md-he').addEventListener('click', () => download('DMP-horizon-europe.md', planToMarkdown(plan, t, { layout: 'horizon' }), 'text/markdown'));
  $('import-file').addEventListener('change', onImport);
  $('new-plan').addEventListener('click', onNew);
  $('to-check').addEventListener('click', () => {
    document.querySelector('input[name="source"][value="editor"]').checked = true;
    onSourceChange();
    showView('check');
  });
  for (const r of document.querySelectorAll('input[name="source"]')) r.addEventListener('change', onSourceChange);
  $('check-form').addEventListener('submit', onCheck);
  $('dl-report').addEventListener('click', onDownloadReport);
  $('to-editor').addEventListener('click', onToEditor);

  applyI18n();
  showView(new URLSearchParams(location.search).get('view') ?? 'plan', { push: false });
}

init();
