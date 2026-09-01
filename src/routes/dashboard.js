const express = require('express');
const { prepare, STAGES, OPEN_STAGES, getSetting } = require('../db');
const {
  esc, inr, inrShort, fmtDateTime, layout, todayStr,
} = require('../render');

const router = express.Router();

router.get('/dashboard', async (req, res, next) => {
  try {
    const target = Number(getSetting('target_amount')) || 0;
    const targetLabel = getSetting('target_label') || 'Target';

    const byStage = await prepare(`
      SELECT stage, COUNT(*)::int AS n, COALESCE(SUM(value_inr), 0)::float8 AS total
      FROM tenders GROUP BY stage`).all();
    const stageMap = Object.fromEntries(byStage.map(r => [r.stage, r]));
    const openTotal = OPEN_STAGES.reduce((s, st) => s + (stageMap[st] ? stageMap[st].total : 0), 0);
    const openCount = OPEN_STAGES.reduce((s, st) => s + (stageMap[st] ? stageMap[st].n : 0), 0);
    const wonTotal = stageMap['Won'] ? stageMap['Won'].total : 0;
    const wonCount = stageMap['Won'] ? stageMap['Won'].n : 0;
    const lostCount = stageMap['Lost'] ? stageMap['Lost'].n : 0;
    const pct = target > 0 ? Math.min(100, Math.round((wonTotal / target) * 100)) : 0;
    const pipelinePct = target > 0 ? Math.min(100, Math.round(((wonTotal + openTotal) / target) * 100)) : 0;
    const maxStageTotal = Math.max(1, ...OPEN_STAGES.map(st => (stageMap[st] ? stageMap[st].total : 0)));

    const byDept = await prepare(`
      SELECT d.name AS dept,
        COUNT(*)::int AS n,
        SUM(CASE WHEN t.stage = 'Won' THEN 1 ELSE 0 END)::int AS won,
        SUM(CASE WHEN t.stage = 'Lost' THEN 1 ELSE 0 END)::int AS lost,
        COALESCE(SUM(CASE WHEN t.stage = 'Won' THEN t.value_inr ELSE 0 END), 0)::float8 AS won_value,
        COALESCE(SUM(CASE WHEN t.stage NOT IN ('Won','Lost') THEN t.value_inr ELSE 0 END), 0)::float8 AS open_value
      FROM tenders t LEFT JOIN departments d ON d.id = t.department_id
      GROUP BY t.department_id, d.name ORDER BY won_value DESC, open_value DESC`).all();

    const converters = await prepare(`
      SELECT o.id, o.name, o.designation, COUNT(*)::int AS wins, COALESCE(SUM(t.value_inr),0)::float8 AS value
      FROM tender_officers x JOIN tenders t ON t.id = x.tender_id AND t.stage = 'Won'
      JOIN officers o ON o.id = x.officer_id
      GROUP BY o.id, o.name, o.designation ORDER BY value DESC LIMIT 8`).all();

    const recent = await prepare(`
      SELECT a.*, u.name AS by_name, o.name AS officer_name, t.title AS tender_title
      FROM activities a LEFT JOIN users u ON u.id = a.created_by
      LEFT JOIN officers o ON o.id = a.officer_id LEFT JOIN tenders t ON t.id = a.tender_id
      ORDER BY a.created_at DESC LIMIT 12`).all();

    const activity7 = (await prepare(`SELECT COUNT(*)::int AS c FROM activities WHERE created_at >= now() - interval '7 days'`).get()).c;
    const officerCount = (await prepare('SELECT COUNT(*)::int AS c FROM officers').get()).c;
    const followupsSet = (await prepare(`SELECT COUNT(*)::int AS c FROM officers WHERE next_followup_date >= ?`).get(todayStr())).c;

    const body = `
<div class="page-head">
  <h1>Pipeline</h1>
  <p class="sub">Live view — no status calls needed</p>
</div>

<div class="stat-row">
  <div class="stat">
    <span class="k">Won vs ${esc(targetLabel)}</span>
    <b class="mono">${inrShort(wonTotal)} <em>/ ${inrShort(target)}</em></b>
    <div class="bar"><div class="bar-fill won" style="width:${pct}%"></div><div class="bar-fill pipe" style="width:${pipelinePct - pct}%"></div></div>
    <span class="sub">${pct}% won · pipeline would take it to ${pipelinePct}%</span>
  </div>
  <div class="stat"><span class="k">Open pipeline</span><b class="mono">${inrShort(openTotal)}</b><span class="sub">${openCount} active tender${openCount === 1 ? '' : 's'}</span></div>
  <div class="stat"><span class="k">Won / Lost</span><b class="mono">${wonCount} / ${lostCount}</b><span class="sub">${wonCount + lostCount > 0 ? Math.round(wonCount / (wonCount + lostCount) * 100) + '% win rate' : 'No closed tenders yet'}</span></div>
  <div class="stat"><span class="k">This week</span><b class="mono">${activity7}</b><span class="sub">interactions logged · ${followupsSet} follow-ups scheduled · ${officerCount} officers</span></div>
</div>

<div class="card">
  <h3>Pipeline by stage</h3>
  <div class="stagebars">
    ${OPEN_STAGES.map((st, i) => {
      const r = stageMap[st] || { n: 0, total: 0 };
      const w = Math.round((r.total / maxStageTotal) * 100);
      return `<a class="stagebar" href="/tenders?stage=${encodeURIComponent(st)}">
        <span class="sb-label"><i>${i + 1}</i> ${esc(st)}</span>
        <span class="sb-track"><span class="sb-fill" style="width:${Math.max(w, r.n ? 3 : 0)}%"></span></span>
        <span class="sb-val mono">${r.n ? `${inrShort(r.total)} · ${r.n}` : '—'}</span>
      </a>`;
    }).join('')}
  </div>
</div>

<div class="two-col">
  <div>
    <div class="card">
      <h3>Performance by department</h3>
      <div class="tbl-wrap plain"><table>
        <tr><th>Department</th><th>Tenders</th><th>Won</th><th>Won value</th><th>Open value</th></tr>
        ${byDept.map(r => `<tr>
          <td>${esc(r.dept || 'Unassigned')}</td>
          <td class="mono">${r.n}</td>
          <td class="mono">${r.won}${r.won + r.lost > 0 ? ` <span class="sub">(${Math.round(r.won / (r.won + r.lost) * 100)}%)</span>` : ''}</td>
          <td class="mono">${inrShort(r.won_value)}</td>
          <td class="mono">${inrShort(r.open_value)}</td>
        </tr>`).join('')}
        ${byDept.length === 0 ? '<tr><td colspan="5" class="empty">No tenders yet.</td></tr>' : ''}
      </table></div>
    </div>
    <div class="card">
      <h3>Officers who convert</h3>
      ${converters.map(c => `<div class="minirow"><a href="/officers/${c.id}">${esc(c.name)}</a> <span class="sub">${esc(c.designation)}</span> <b class="mono">${c.wins} win${c.wins === 1 ? '' : 's'} · ${inrShort(c.value)}</b></div>`).join('') || '<p class="sub">No won tenders yet — this fills in as deals close.</p>'}
    </div>
  </div>
  <div>
    <div class="card">
      <h3>Latest field activity</h3>
      <div class="timeline">
        ${recent.map(a => `<div class="tl-item">
          <div class="tl-head"><span class="badge type">${esc(a.type)}</span> <span class="sub">${fmtDateTime(a.created_at)} · ${esc(a.by_name || '')}</span></div>
          <p>${esc(a.summary)}</p>
          <p class="sub">${a.officer_name ? `Officer: <a href="/officers/${a.officer_id}">${esc(a.officer_name)}</a>` : ''}${a.officer_name && a.tender_title ? ' · ' : ''}${a.tender_title ? `Tender: <a href="/tenders/${a.tender_id}">${esc(a.tender_title)}</a>` : ''}</p>
        </div>`).join('') || '<p class="sub">No activity logged yet.</p>'}
      </div>
    </div>
  </div>
</div>`;
    res.send(layout({ user: req.user, title: 'Pipeline', active: 'dashboard', body }));
  } catch (e) { next(e); }
});

module.exports = router;
