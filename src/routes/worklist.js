const express = require('express');
const { prepare, getSetting } = require('../db');
const {
  esc, inrShort, fmtDateTime, daysSince, dueBadge, stageBadge, layout, todayStr,
} = require('../render');

const router = express.Router();
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

router.get('/worklist', async (req, res, next) => {
  try {
    const today = todayStr();
    const coldDays = Number(getSetting('cold_days')) || 21;
    const soonDays = Number(getSetting('deadline_soon_days')) || 7;

    const overdue = await prepare(`
      SELECT o.*, d.name AS dept, (SELECT MAX(a.created_at) FROM activities a WHERE a.officer_id = o.id) AS last_interaction
      FROM officers o LEFT JOIN departments d ON d.id = o.department_id
      WHERE o.next_followup_date <> '' AND o.next_followup_date < ?
      ORDER BY o.next_followup_date`).all(today);

    const dueToday = await prepare(`
      SELECT o.*, d.name AS dept FROM officers o LEFT JOIN departments d ON d.id = o.department_id
      WHERE o.next_followup_date = ? ORDER BY o.name`).all(today);

    const upcoming = await prepare(`
      SELECT o.*, d.name AS dept FROM officers o LEFT JOIN departments d ON d.id = o.department_id
      WHERE o.next_followup_date > ? AND o.next_followup_date <= ?
      ORDER BY o.next_followup_date`).all(today, addDays(today, 3));

    const cold = (await prepare(`
      SELECT o.*, d.name AS dept, (SELECT MAX(a.created_at) FROM activities a WHERE a.officer_id = o.id) AS last_interaction
      FROM officers o LEFT JOIN departments d ON d.id = o.department_id
      WHERE (o.next_followup_date = '' OR o.next_followup_date < ?)
      ORDER BY last_interaction`).all(today))
      .filter(o => { const s = daysSince(o.last_interaction); return s == null || s >= coldDays; })
      .filter(o => !overdue.some(x => x.id === o.id))
      .slice(0, 20);

    const deadlines = await prepare(`
      SELECT t.*, d.name AS dept FROM tenders t LEFT JOIN departments d ON d.id = t.department_id
      WHERE t.stage NOT IN ('Won','Lost') AND t.deadline <> '' AND t.deadline <= ?
      ORDER BY t.deadline`).all(addDays(today, soonDays));

    const officerRow = o => `<div class="workrow">
      <div>
        <a href="/officers/${o.id}"><b>${esc(o.name)}</b></a>
        <span class="sub">${esc(o.designation)}${o.dept ? ' · ' + esc(o.dept) : ''}${o.district ? ' · ' + esc(o.district) : ''}</span>
        ${o.promised_next_step ? `<div class="sub">→ ${esc(o.promised_next_step)}</div>` : ''}
      </div>
      <div class="workrow-side">
        ${dueBadge(o.next_followup_date)}
        ${o.phone ? `<a class="btn small" href="tel:${esc(o.phone)}">Call</a>` : ''}
        <a class="btn small" href="/officers/${o.id}">Log</a>
      </div>
    </div>`;

    const coldRow = o => `<div class="workrow">
      <div>
        <a href="/officers/${o.id}"><b>${esc(o.name)}</b></a>
        <span class="sub">${esc(o.designation)}${o.dept ? ' · ' + esc(o.dept) : ''}</span>
        <div class="sub">${o.last_interaction ? `Last touch ${daysSince(o.last_interaction)}d ago (${fmtDateTime(o.last_interaction)})` : 'No interaction ever logged'}</div>
      </div>
      <div class="workrow-side">
        <span class="badge due-overdue">Going cold</span>
        ${o.phone ? `<a class="btn small" href="tel:${esc(o.phone)}">Call</a>` : ''}
        <a class="btn small" href="/officers/${o.id}">Log</a>
      </div>
    </div>`;

    const tenderRow = t => `<div class="workrow">
      <div>
        <a href="/tenders/${t.id}"><b>${esc(t.title)}</b></a>
        <span class="sub">${esc(t.dept || '')} · ${inrShort(t.value_inr)}</span>
        <div>${stageBadge(t.stage)}</div>
      </div>
      <div class="workrow-side">
        ${dueBadge(t.deadline)}
        <a class="btn small" href="/tenders/${t.id}">Open</a>
      </div>
    </div>`;

    const totalActions = overdue.length + dueToday.length;
    const dateLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
    const body = `
<div class="page-head">
  <div>
    <h1>Today's worklist</h1>
    <p class="sub">${esc(dateLabel)} · ${totalActions} follow-up${totalActions === 1 ? '' : 's'} need${totalActions === 1 ? 's' : ''} action${cold.length ? ` · ${cold.length} relationship${cold.length === 1 ? '' : 's'} going cold` : ''}</p>
  </div>
  <div class="head-actions">
    <a class="btn" href="/officers/new">+ Officer</a>
    <a class="btn" href="/tenders/new">+ Tender</a>
  </div>
</div>

${overdue.length ? `<section class="worksec">
  <h2 class="sec-overdue">Overdue follow-ups <span class="count">${overdue.length}</span></h2>
  ${overdue.map(officerRow).join('')}
</section>` : ''}

<section class="worksec">
  <h2>Due today <span class="count">${dueToday.length}</span></h2>
  ${dueToday.map(officerRow).join('') || '<p class="sub empty-line">Nothing due today.</p>'}
</section>

${deadlines.length ? `<section class="worksec">
  <h2 class="sec-deadline">Tender deadlines within ${soonDays} days <span class="count">${deadlines.length}</span></h2>
  ${deadlines.map(tenderRow).join('')}
</section>` : ''}

${cold.length ? `<section class="worksec">
  <h2 class="sec-cold">Going cold — no touch in ${coldDays}+ days <span class="count">${cold.length}</span></h2>
  ${cold.map(coldRow).join('')}
</section>` : ''}

<section class="worksec">
  <h2>Coming up (next 3 days) <span class="count">${upcoming.length}</span></h2>
  ${upcoming.map(officerRow).join('') || '<p class="sub empty-line">Nothing scheduled in the next 3 days.</p>'}
</section>`;
    res.send(layout({ user: req.user, title: "Today's worklist", active: 'worklist', body }));
  } catch (e) { next(e); }
});

module.exports = router;
