#!/usr/bin/env node
// Check a data management plan against the DOI records of its datasets.
//
//   node bin/dmp-check.mjs [dmp.json] [--strict] [--offline] [--no-unlisted] [--today YYYY-MM-DD] [--format text|md|json]
//
// Exit codes, which are what CI reads:
//   0  the plan is a valid maDMP, and every dataset due by today matches its DOI record
//   1  the plan is invalid, or a record does not match (with --strict, planned ones count too)
//   2  usage error: no plan file, unreadable JSON, unknown option
//   3  DataCite could not be read, so nothing was decided either way
//
// --offline validates the plan and asks nothing of DataCite: for CI that must not depend on a
// network, and for plans not yet due. Dependency-free, like the rest of the repository: it runs
// on the Node that GitHub's runners already have, so the Action needs no install step.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { checkPlan } from '../src/evidence.js';
import { completeness, parsePlan, validatePlan } from '../src/plan.js';
import { RegistryError, dataciteRegistry } from '../src/datacite.js';
import { t } from '../src/i18n/index.js';
import { formatReport as formatReportWith } from '../src/report.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseArgs(argv) {
  const opts = { plan: 'dmp.json', strict: false, offline: false, unlisted: true, format: 'text', today: null };
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift();
    if (a === '--strict') opts.strict = true;
    else if (a === '--offline') opts.offline = true;
    else if (a === '--no-unlisted') opts.unlisted = false;
    else if (a === '--format') opts.format = rest.shift();
    else if (a === '--today') opts.today = rest.shift();
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('-')) return { error: `unknown option ${a}` };
    else opts.plan = a;
  }
  if (!['text', 'md', 'json'].includes(opts.format)) return { error: `unknown format ${opts.format}` };
  if (opts.today !== null && !DATE.test(opts.today ?? '')) return { error: '--today needs a date as YYYY-MM-DD' };
  return opts;
}

/** The report, in the CLI's language. The formatting itself lives in src/report.js, shared with the page. */
export const formatReport = (result, problems, opts = {}) => formatReportWith(result, problems, { ...opts, t });

/** Whether the run should fail CI. */
export function failed(result, problems, strict) {
  if (problems.some((p) => p.severity === 'error')) return true;
  if (result.summary.failing > 0) return true;
  return strict && result.summary.pending > 0;
}

/** A result with no registry behind it: what --offline reports, so the output keeps one shape. */
function offlineResult(plan) {
  const c = completeness(plan);
  return {
    plan: [], datasets: [], unlisted: [],
    summary: { questions: c.required, answered: c.answered, datasets: 0, published: 0, evidenced: 0, missing: 0, pending: 0, declared: 0, failing: 0, unlisted: 0 },
  };
}

export async function main(argv, { log = console.log, err = console.error, registry = null } = {}) {
  const opts = parseArgs(argv);
  if (opts.error) {
    err(`dmp-check: ${opts.error}`);
    return 2;
  }
  if (opts.help) {
    log('usage: dmp-check [dmp.json] [--strict] [--offline] [--no-unlisted] [--today YYYY-MM-DD] [--format text|md|json]');
    return 0;
  }
  const planFile = resolve(opts.plan);
  if (!existsSync(planFile)) {
    err(`dmp-check: ${opts.plan} not found`);
    return 2;
  }
  const parsed = parsePlan(readFileSync(planFile, 'utf8'));
  if (parsed.error) {
    err(`dmp-check: ${opts.plan}: ${t(parsed.error)}`);
    return 2;
  }
  const problems = validatePlan(parsed.plan);
  let result;
  if (opts.offline) result = offlineResult(parsed.plan);
  else {
    try {
      result = await checkPlan(parsed.plan, registry ?? dataciteRegistry(), {
        unlisted: opts.unlisted, ...(opts.today ? { today: opts.today } : {}),
      });
    } catch (e) {
      if (!(e instanceof RegistryError)) throw e;
      err(`dmp-check: ${t(e.code, e.vars)}`);
      return 3;
    }
  }

  if (opts.format === 'json') log(JSON.stringify({ file: opts.plan, problems, ...result }, null, 2));
  else log(formatReport(result, problems, { format: opts.format, planPath: opts.plan }));

  // In a GitHub Actions job, also leave the Markdown report on the run's summary page.
  if (process.env.GITHUB_STEP_SUMMARY && opts.format !== 'md') {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, formatReport(result, problems, { format: 'md', planPath: opts.plan }));
    } catch { /* a summary is a courtesy, never a reason to fail */ }
  }
  return failed(result, problems, opts.strict) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
