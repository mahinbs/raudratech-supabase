const express = require('express');
const { prepare, ACTIVITY_TYPES, ensureDepartment, getSetting } = require('../db');
const {
  esc, inrShort, fmtDate, fmtDateTime, daysSince, dueBadge, stageBadge, layout, todayStr,
} = require('../render');

const router = express.Router();

const LAST_INTERACTION_SQL = `(SELECT MAX(a.created_at) FROM activities a WHERE a.officer_id = o.id)`;
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

async function officerOptions(excludeId) {
  const rows = await prepare('SELECT id, name, designation FROM officers ORDER BY name').all();
  return rows.filter(r => r.id !== excludeId)
    .map(r => `<option value="${r.id}">${esc(r.name)}${r.designation ? ' — ' + esc(r.designation) : ''}</option>`).join('');
}
async function departmentOptions(selectedId) {
  const rows = await prepare('SELECT id, name FROM departments ORDER BY name').all();
  return rows.map(r => `<option value="${r.id}" ${r.id === selectedId ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
}

async function officerForm(o = {}, action, submitLabel) {
  const deptOpts = await departmentOptions(o.department_id);
  const offOpts = (await officerOptions(o.id)).replace(`value="${o.reports_to}"`, `value="${o.reports_to}" selected`);
  return `
<form method="post" action="${action}" class="card form-grid">
  <label>Name *<input name="name" required value="${esc(o.name)}"></label>
  <label>Designation<input name="designation" value="${esc(o.designation)}"></label>
  <label>Department
    <select name="department_id">
      <option value="">— Select —</option>
      ${deptOpts}
    </select>
  </label>
  <label>Or new department<input name="new_department" placeholder="Type to add a new department"></label>
  <label>District<input name="district" value="${esc(o.district)}"></label>
  <label>Phone<input name="phone" value="${esc(o.phone)}"></label>
  <label>Email<input name="email" type="email" value="${esc(o.email)}"></label>
  <label>Reports to
    <select name="reports_to">
      <option value="">— None / top of hierarchy —</option>
      ${offOpts}
    </select>
  </label>
  <label class="span2">Notes<textarea name="notes" rows="2">${esc(o.notes)}</textarea></label>
  <div class="span2 actions"><button class="btn primary">${submitLabel}</button></div>
</form>`;
}

async function readOfficerBody(req) {
  const b = req.body;
  let departmentId = b.department_id ? Number(b.department_id) : null;
  if (b.new_department && b.new_department.trim()) departmentId = await ensureDepartment(b.new_department);
  return {
    name: (b.name || '').trim(),
    designation: (b.designation || '').trim(),
    department_id: departmentId,
    district: (b.district || '').trim(),
    phone: (b.phone || '').trim(),
    email: (b.email || '').trim(),
    reports_to: b.reports_to ? Number(b.reports_to) : null,
    notes: (b.notes || '').trim(),
  };
}

// ---- List ----
router.get('/officers', async (req, res, next) => {
  try {
    const { q = '', department = '', district = '', due = '' } = req.query;
    const today = todayStr();
    const clauses = [];
    const params = {};
    if (q) { clauses.push(`(o.name ILIKE :q OR o.designation ILIKE :q OR o.phone ILIKE :q)`); params.q = `%${q}%`; }
    if (department) { clauses.push(`o.department_id = :department`); params.department = Number(department); }
    if (district) { clauses.push(`o.district = :district`); params.district = district; }
    if (due === 'overdue') clauses.push(`o.next_followup_date <> '' AND o.next_followup_date < '${today}'`);
    if (due === 'today') clauses.push(`o.next_followup_date = '${today}'`);
    if (due === 'week') clauses.push(`o.next_followup_date <> '' AND o.next_followup_date <= '${addDays(today, 7)}'`);
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const rows = await prepare(`
      SELECT o.*, d.name AS dept, ${LAST_INTERACTION_SQL} AS last_interaction
      FROM officers o LEFT JOIN departments d ON d.id = o.department_id
      ${where}
      ORDER BY CASE WHEN o.next_followup_date = '' THEN 1 ELSE 0 END, o.next_followup_date, o.name
    `).all(params);

    const districts = await prepare(`SELECT DISTINCT district FROM officers WHERE district <> '' ORDER BY district`).all();
    const deptOpts = await departmentOptions(Number(department));
    const body = `
<div class="page-head">
  <h1>Officers <span class="count">${rows.length}</span></h1>
  <a class="btn primary" href="/officers/new">+ Add officer</a>
</div>
<form class="filters" method="get" action="/officers">
  <input type="search" name="q" placeholder="Search name, designation, phone" value="${esc(q)}">
  <select name="department"><option value="">All departments</option>${deptOpts}</select>
  <select name="district"><option value="">All districts</option>
    ${districts.map(r => `<option ${r.district === district ? 'selected' : ''}>${esc(r.district)}</option>`).join('')}
  </select>
  <select name="due">
    <option value="">Any follow-up</option>
    <option value="overdue" ${due === 'overdue' ? 'selected' : ''}>Overdue</option>
    <option value="today" ${due === 'today' ? 'selected' : ''}>Due today</option>
    <option value="week" ${due === 'week' ? 'selected' : ''}>Due within 7 days</option>
  </select>
  <button class="btn">Filter</button>
</form>
<div class="tbl-wrap"><table>
  <tr><th>Officer</th><th>Department / District</th><th>Last interaction</th><th>Promised next step</th><th>Follow-up</th></tr>
  ${rows.map(o => `<tr class="rowlink" data-href="/officers/${o.id}">
    <td><a href="/officers/${o.id}"><b>${esc(o.name)}</b></a><br><span class="sub">${esc(o.designation)}</span></td>
    <td>${esc(o.dept || '—')}<br><span class="sub">${esc(o.district)}</span></td>
    <td>${o.last_interaction ? `${fmtDateTime(o.last_interaction)}<br><span class="sub">${daysSince(o.last_interaction)}d ago</span>` : '<span class="sub">Never</span>'}</td>
    <td class="wrapcell">${esc(o.promised_next_step || '—')}</td>
    <td>${dueBadge(o.next_followup_date)}</td>
  </tr>`).join('')}
  ${rows.length === 0 ? '<tr><td colspan="5" class="empty">No officers match. Add one or adjust filters.</td></tr>' : ''}
</table></div>
<script src="/app.js"></script>`;
    res.send(layout({ user: req.user, title: 'Officers', active: 'officers', body }));
  } catch (e) { next(e); }
});

// ---- New / create ----
router.get('/officers/new', async (req, res, next) => {
  try {
    const body = `<div class="page-head"><h1>Add officer</h1></div>${await officerForm({}, '/officers/new', 'Save officer')}`;
    res.send(layout({ user: req.user, title: 'Add officer', active: 'officers', body }));
  } catch (e) { next(e); }
});
router.post('/officers/new', async (req, res, next) => {
  try {
    const o = await readOfficerBody(req);
    if (!o.name) return res.redirect('/officers/new');
    const info = await prepare(`INSERT INTO officers (name, designation, department_id, district, phone, email, reports_to, notes)
      VALUES (:name, :designation, :department_id, :district, :phone, :email, :reports_to, :notes)`).run(o);
    res.redirect(`/officers/${info.lastInsertRowid}`);
  } catch (e) { next(e); }
});

// ---- Detail ----
router.get('/officers/:id(\\d+)', async (req, res, next) => {
  try {
    const o = await prepare(`
      SELECT o.*, d.name AS dept, ${LAST_INTERACTION_SQL} AS last_interaction
      FROM officers o LEFT JOIN departments d ON d.id = o.department_id WHERE o.id = ?`).get(req.params.id);
    if (!o) return res.status(404).send('Officer not found');
    const boss = o.reports_to ? await prepare('SELECT id, name, designation FROM officers WHERE id = ?').get(o.reports_to) : null;
    const reports = await prepare('SELECT id, name, designation FROM officers WHERE reports_to = ? ORDER BY name').all(o.id);
    const tenders = await prepare(`
      SELECT t.*, d.name AS dept FROM tenders t
      JOIN tender_officers x ON x.tender_id = t.id
      LEFT JOIN departments d ON d.id = t.department_id
      WHERE x.officer_id = ? ORDER BY t.updated_at DESC`).all(o.id);
    const acts = await prepare(`
      SELECT a.*, u.name AS by_name, t.title AS tender_title
      FROM activities a LEFT JOIN users u ON u.id = a.created_by
      LEFT JOIN tenders t ON t.id = a.tender_id
      WHERE a.officer_id = ? ORDER BY a.created_at DESC LIMIT 100`).all(o.id);
    const coldDays = Number(getSetting('cold_days'));
    const since = daysSince(o.last_interaction);
    const coldFlag = (since == null || since >= coldDays) && !o.next_followup_date
      ? `<span class="badge due-overdue">Going cold${since != null ? ` — ${since}d silent` : ' — no interactions yet'}</span>` : '';

    const body = `
<div class="page-head">
  <div>
    <h1>${esc(o.name)}</h1>
    <p class="sub">${esc(o.designation)}${o.dept ? ' · ' + esc(o.dept) : ''}${o.district ? ' · ' + esc(o.district) : ''}</p>
  </div>
  <div class="head-actions">
    <a class="btn" href="/officers/${o.id}/edit">Edit</a>
    <form method="post" action="/officers/${o.id}/delete" onsubmit="return confirm('Delete this officer and their activity history?')"><button class="btn danger">Delete</button></form>
  </div>
</div>
<div class="two-col">
  <div>
    <div class="card">
      <h3>Relationship status</h3>
      <div class="kv">
        <div><span>Last interaction</span><b>${o.last_interaction ? `${fmtDateTime(o.last_interaction)} (${since}d ago)` : 'Never'}</b></div>
        <div><span>Promised next step</span><b>${esc(o.promised_next_step || '—')}</b></div>
        <div><span>Next follow-up</span><b>${o.next_followup_date ? fmtDate(o.next_followup_date) + ' ' : '—'} ${dueBadge(o.next_followup_date)}</b></div>
      </div>
      ${coldFlag}
    </div>
    <div class="card">
      <h3>Contact & hierarchy</h3>
      <div class="kv">
        <div><span>Phone</span><b>${o.phone ? `<a href="tel:${esc(o.phone)}">${esc(o.phone)}</a>` : '—'}</b></div>
        <div><span>Email</span><b>${o.email ? `<a href="mailto:${esc(o.email)}">${esc(o.email)}</a>` : '—'}</b></div>
        <div><span>Reports to</span><b>${boss ? `<a href="/officers/${boss.id}">${esc(boss.name)}</a> <span class="sub">${esc(boss.designation)}</span>` : '—'}</b></div>
        <div><span>Direct reports</span><b>${reports.length ? reports.map(r => `<a href="/officers/${r.id}">${esc(r.name)}</a>`).join(', ') : '—'}</b></div>
      </div>
      ${o.notes ? `<p class="notes">${esc(o.notes)}</p>` : ''}
    </div>
    <div class="card">
      <h3>Linked tenders <span class="count">${tenders.length}</span></h3>
      ${tenders.map(t => `<div class="minirow"><a href="/tenders/${t.id}">${esc(t.title)}</a> ${stageBadge(t.stage)} <span class="sub">${inrShort(t.value_inr)}</span></div>`).join('') || '<p class="sub">No tenders linked yet.</p>'}
    </div>
  </div>
  <div>
    <div class="card highlight">
      <h3>Log an interaction</h3>
      <form method="post" action="/officers/${o.id}/activity" class="form-grid">
        <label>Type
          <select name="type">${ACTIVITY_TYPES.map(t => `<option>${t}</option>`).join('')}</select>
        </label>
        <label>Linked tender (optional)
          <select name="tender_id"><option value="">—</option>
            ${tenders.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join('')}
          </select>
        </label>
        <label class="span2">What was discussed *<textarea name="summary" rows="2" required placeholder="e.g. Presented solar pump range; asked for spec sheet"></textarea></label>
        <label>Promised next step<input name="promised_next_step" placeholder="e.g. Send spec sheet, visit next week"></label>
        <label>Next follow-up date<input type="date" name="next_followup_date" min="2020-01-01"></label>
        <div class="span2 actions"><button class="btn primary">Log it</button></div>
      </form>
    </div>
    <div class="card">
      <h3>Activity history <span class="count">${acts.length}</span></h3>
      <div class="timeline">
        ${acts.map(a => `<div class="tl-item">
          <div class="tl-head"><span class="badge type">${esc(a.type)}</span> <span class="sub">${fmtDateTime(a.created_at)} · ${esc(a.by_name || '')}</span></div>
          <p>${esc(a.summary)}</p>
          ${a.tender_title ? `<p class="sub">Tender: ${esc(a.tender_title)}</p>` : ''}
          ${a.promised_next_step ? `<p class="sub">Next: ${esc(a.promised_next_step)}${a.next_followup_date ? ' by ' + fmtDate(a.next_followup_date) : ''}</p>` : ''}
        </div>`).join('') || '<p class="sub">No interactions logged yet.</p>'}
      </div>
    </div>
  </div>
</div>`;
    res.send(layout({ user: req.user, title: o.name, active: 'officers', body }));
  } catch (e) { next(e); }
});

// ---- Log activity ----
router.post('/officers/:id(\\d+)/activity', async (req, res, next) => {
  try {
    const o = await prepare('SELECT id FROM officers WHERE id = ?').get(req.params.id);
    if (!o) return res.status(404).send('Officer not found');
    const b = req.body;
    if (!(b.summary || '').trim()) return res.redirect(`/officers/${o.id}`);
    await prepare(`INSERT INTO activities (officer_id, tender_id, type, summary, promised_next_step, next_followup_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(o.id, b.tender_id ? Number(b.tender_id) : null,
        ACTIVITY_TYPES.includes(b.type) ? b.type : 'Note',
        b.summary.trim(), (b.promised_next_step || '').trim(), (b.next_followup_date || '').trim(), req.user.id);
    await prepare('UPDATE officers SET promised_next_step = ?, next_followup_date = ? WHERE id = ?')
      .run((b.promised_next_step || '').trim(), (b.next_followup_date || '').trim(), o.id);
    res.redirect(`/officers/${o.id}`);
  } catch (e) { next(e); }
});

// ---- Edit / update / delete ----
router.get('/officers/:id(\\d+)/edit', async (req, res, next) => {
  try {
    const o = await prepare('SELECT * FROM officers WHERE id = ?').get(req.params.id);
    if (!o) return res.status(404).send('Officer not found');
    const body = `<div class="page-head"><h1>Edit ${esc(o.name)}</h1></div>${await officerForm(o, `/officers/${o.id}/edit`, 'Save changes')}`;
    res.send(layout({ user: req.user, title: 'Edit officer', active: 'officers', body }));
  } catch (e) { next(e); }
});
router.post('/officers/:id(\\d+)/edit', async (req, res, next) => {
  try {
    const o = await readOfficerBody(req);
    o.id = Number(req.params.id);
    if (!o.name) return res.redirect(`/officers/${o.id}/edit`);
    await prepare(`UPDATE officers SET name=:name, designation=:designation, department_id=:department_id,
      district=:district, phone=:phone, email=:email, reports_to=:reports_to, notes=:notes WHERE id=:id`).run(o);
    res.redirect(`/officers/${o.id}`);
  } catch (e) { next(e); }
});
router.post('/officers/:id(\\d+)/delete', async (req, res, next) => {
  try {
    await prepare('UPDATE officers SET reports_to = NULL WHERE reports_to = ?').run(req.params.id);
    await prepare('DELETE FROM officers WHERE id = ?').run(req.params.id);
    res.redirect('/officers');
  } catch (e) { next(e); }
});

module.exports = router;
