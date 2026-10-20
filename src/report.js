// A check result as text: plain for a terminal, Markdown for a GitHub step summary, a pull
// request or a file someone downloads from the page. One function for both the CLI and the
// page, so the report a collaborator downloads is the report CI writes.
//
// Pure. `t` is passed in, so this module keeps no language state of its own.

/** One mark per verdict and outcome, the same everywhere a result is shown. */
export const MARK = Object.freeze({ evidenced: '✓', missing: '✗', pending: '…', declared: '·' });

export function formatReport(result, problems, { format = 'text', planPath = 'dmp.json', t }) {
  const { summary: s } = result;
  const md = format === 'md';
  const out = [];
  const strip = (html) => html.replace(/<\/?b>/g, md ? '**' : '');
  out.push(md ? `### ${t('check.results')}: \`${planPath}\`` : `${t('check.results')}: ${planPath}`, '');
  out.push(strip(t('sum.answered', { a: s.answered, n: s.questions })));
  out.push(strip(t('sum.evidenced', { e: s.evidenced, n: s.datasets, p: s.published })));
  out.push(strip(t('sum.failing', { m: s.failing })), '');

  const errors = problems.filter((p) => p.severity === 'error');
  if (errors.length) {
    out.push(t('plan.valid.errors', { n: errors.length }));
    for (const p of errors) out.push(`  ${md ? '- ' : ''}${p.path}: ${t(p.code, p.vars)}`);
    out.push('');
  }

  const line = (c) => `${MARK[c.outcome]} ${t(`chk.${c.id}`)}: ${t(c.detail, c.vars)}`;
  for (const c of result.plan) out.push(md ? `- ${line(c)}` : line(c));
  if (result.plan.length) out.push('');

  if (md && result.datasets.length) out.push(`| | ${t('check.th.dataset')} | ${t('check.th.phase')} | ${t('check.th.checks')} |`, '|---|---|---|---|');
  for (const d of result.datasets) {
    const title = d.title || t('ds.untitled', { n: d.index + 1 });
    const phase = t(`phase.${d.phase}`, { date: d.issued ?? '' });
    const checks = d.checks.map(line);
    if (md) out.push(`| ${MARK[d.verdict]} | ${title.replace(/\|/g, '\\|')}${d.doi ? `<br>\`${d.doi}\`` : ''} | ${phase} | ${checks.join('<br>').replace(/\|/g, '\\|') || t(`verdict.${d.verdict}`)} |`);
    else {
      out.push(`${MARK[d.verdict]} ${title}${d.doi ? ` (${d.doi})` : ''} [${phase}] ${t(`verdict.${d.verdict}`)}`);
      for (const c of checks) out.push(`    ${c}`);
    }
  }

  for (const g of result.unlisted ?? []) {
    if (!g.deposits.length) continue;
    out.push('', md ? `**${t('unlisted.title', { grant: g.grant })}**` : t('unlisted.title', { grant: g.grant }));
    for (const dep of g.deposits) out.push(`${md ? '- ' : '    '}${dep.doi} (${[dep.type, dep.year].filter(Boolean).join(', ')})`);
    if (g.total > g.read) out.push(`${md ? '- ' : '    '}${t('unlisted.more', { n: g.total - g.read })}`);
  }
  return `${out.join('\n')}\n`;
}
