const express = require('express');
const { prepare, STAGES, OPEN_STAGES, ACTIVITY_TYPES, ensureDepartment } = require('../db');
const {
  esc, inr, inrShort, fmtDate, fmtDateTime, dueBadge, stageBadge, layout,
} = require('../render');

const router = express.Router();

async function departmentOptions(selectedId) {
  const rows = await prepare('SELECT id, name FROM departments ORDER BY name').all();
  return rows.map(r => `<option value="${r.id}" ${r.id === selectedId ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
}
async function officerChecklist(selectedIds = []) {
  const rows = await prepare(`
    SELECT o.id, o.name, o.designation, d.name AS dept
    FROM officers o LEFT JOIN departments d ON d.id = o.department_id ORDER BY o.name`).all();
  const sel = new Set(selectedIds);
  return `<div class="checklist">${rows.map(r =>
    `<label class="check"><input type="checkbox" name="officer_ids" value="${r.id}" ${sel.has(r.id) ? 'checked' : ''}>
     ${esc(r.name)} <span class="sub">${esc(r.designation)}${r.dept ? ' · ' + esc(r.dept) : ''}</span></label>`).join('')}
  ${rows.length === 0 ? '<p class="sub">No officers yet — add them in the Officers tab first.</p>' : ''}</div>`;
}

async function tenderForm(t = {}, selectedOfficers = [], action, submitLabel) {
  const deptOpts = await departmentOptions(t.department_id);
  const checklist = await officerChecklist(selectedOfficers);
  return `
<form method="post" action="${action}" class="card form-grid">
  <label>Title *<input name="title" required value="${esc(t.title)}" placeholder="e.g. Supply of solar street lights — Phase II"></label>
  <label>Tender ID / No.<input name="tender_no" value="${esc(t.tender_no)}" placeholder="e.g. KA/PWD/2026/0142"></label>
  <label>Department
    <select name="department_id"><option value="">— Select —</option>${deptOpts}</select>
  </label>
  <label>Or new department<input name="new_department" placeholder="Type to add a new department"></label>
  <label>Estimated value (₹)<input name="value_inr" type="number" min="0" step="1" value="${t.value_inr != null ? t.value_inr : ''}"></label>
  <label>Deadline<input type="date" name="deadline" value="${esc(t.deadline)}"></label>
  ${t.id ? '' : `<label>Starting stage
    <select name="stage">${OPEN_STAGES.map(s => `<option ${s === t.stage ? 'selected' : ''}>${s}</option>`).join('')}</select>
  </label><span></span>`}
  <label class="span2">Notes<textarea name="notes" rows="2">${esc(t.notes)}</textarea></label>
  <div class="span2"><h3>Linked officers</h3>${checklist}</div>
  <div class="span2 actions"><button class="btn primary">${submitLabel}</button></div>
</form>`;
}

async function readTenderBody(req) {
  const b = req.body;
  let departmentId = b.department_id ? Number(b.department_id) : null;
  if (b.new_department && b.new_department.trim()) departmentId = await ensureDepartment(b.new_department);
  return {
    title: (b.title || '').trim(),
    tender_no: (b.tender_no || '').trim(),
    department_id: departmentId,
    value_inr: Number(b.value_inr) || 0,
    deadline: (b.deadline || '').trim(),
    notes: (b.notes || '').trim(),
  };
}
function officerIdsFrom(req) {
  const raw = req.body.officer_ids;
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).map(Number).filter(Boolean);
}
async function setTenderOfficers(tenderId, officerIds) {
  await prepare('DELETE FROM tender_officers WHERE tender_id = ?').run(tenderId);
  for (const oid of officerIds) await prepare('INSERT INTO tender_officers (tender_id, officer_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(tenderId, oid);
}

// ---- List ----
router.get('/tenders', async (req, res, next) => {
  try {
    const { q = '', stage = '', department = '', view = '' } = req.query;
    const clauses = [];
    const params = {};
    if (q) { clauses.push('(t.title ILIKE :q OR t.tender_no ILIKE :q)'); params.q = `%${q}%`; }
    if (stage) { clauses.push('t.stage = :stage'); params.stage = stage; }
    if (department) { clauses.push('t.department_id = :department'); params.department = Number(department); }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const rows = await prepare(`
      SELECT t.*, d.name AS dept,
        (SELECT string_agg(o.name, ', ') FROM tender_officers x JOIN officers o ON o.id = x.officer_id WHERE x.tender_id = t.id) AS officers
      FROM tenders t LEFT JOIN departments d ON d.id = t.department_id
      ${where} ORDER BY t.updated_at DESC`).all(params);

    let content;
    if (view === 'board') {
      const byStage = {};
      for (const s of STAGES) byStage[s] = [];
      for (const r of rows) (byStage[r.stage] || (byStage[r.stage] = [])).push(r);
      content = `<div class="board">
        ${STAGES.map(s => `<div class="board-col ${s === 'Won' ? 'col-won' : s === 'Lost' ? 'col-lost' : ''}">
          <div class="board-col-head">${esc(s)} <span class="count">${byStage[s].length}</span>
            <span class="sub">${inrShort(byStage[s].reduce((sum, t) => sum + Number(t.value_inr), 0))}</span></div>
          ${byStage[s].map(t => `<a class="board-card" href="/tenders/${t.id}">
            <b>${esc(t.title)}</b>
            <span class="sub">${esc(t.dept || '')}</span>
            <span class="row"><span class="mono">${inrShort(t.value_inr)}</span>${t.deadline ? dueBadge(t.deadline) : ''}</span>
          </a>`).join('')}
        </div>`).join('')}
      </div>`;
    } else {
      content = `<div class="tbl-wrap"><table>
        <tr><th>Tender</th><th>Department</th><th>Value</th><th>Deadline</th><th>Stage</th><th>Officers</th></tr>
        ${rows.map(t => `<tr class="rowlink" data-href="/tenders/${t.id}">
          <td><a href="/tenders/${t.id}"><b>${esc(t.title)}</b></a><br><span class="sub mono">${esc(t.tender_no || '')}</span></td>
          <td>${esc(t.dept || '—')}</td>
          <td class="mono">${inrShort(t.value_inr)}</td>
          <td>${t.deadline ? `${fmtDate(t.deadline)}<br>${dueBadge(t.deadline)}` : '—'}</td>
          <td>${stageBadge(t.stage)}</td>
          <td class="wrapcell sub">${esc(t.officers || '—')}</td>
        </tr>`).join('')}
        ${rows.length === 0 ? '<tr><td colspan="6" class="empty">No tenders match. Add one or adjust filters.</td></tr>' : ''}
      </table></div><script src="/app.js"></script>`;
    }

    const keepParams = `q=${encodeURIComponent(q)}&stage=${encodeURIComponent(stage)}&department=${encodeURIComponent(department)}`;
    const deptOpts = await departmentOptions(Number(department));
    const body = `
<div class="page-head">
  <h1>Tenders <span class="count">${rows.length}</span></h1>
  <div class="head-actions">
    <a class="btn ${view !== 'board' ? 'toggled' : ''}" href="/tenders?${keepParams}">List</a>
    <a class="btn ${view === 'board' ? 'toggled' : ''}" href="/tenders?${keepParams}&view=board">Board</a>
    <a class="btn primary" href="/tenders/new">+ Add tender</a>
  </div>
</div>
<form class="filters" method="get" action="/tenders">
  ${view === 'board' ? '<input type="hidden" name="view" value="board">' : ''}
  <input type="search" name="q" placeholder="Search title or tender no." value="${esc(q)}">
  <select name="stage"><option value="">All stages</option>${STAGES.map(s => `<option ${s === stage ? 'selected' : ''}>${s}</option>`).join('')}</select>
  <select name="department"><option value="">All departments</option>${deptOpts}</select>
  <button class="btn">Filter</button>
</form>
${content}`;
    res.send(layout({ user: req.user, title: 'Tenders', active: 'tenders', body }));
  } catch (e) { next(e); }
});

// ---- New / create ----
router.get('/tenders/new', async (req, res, next) => {
  try {
    const preselect = req.query.officer ? [Number(req.query.officer)] : [];
    const body = `<div class="page-head"><h1>Add tender</h1></div>${await tenderForm({ stage: 'Awareness' }, preselect, '/tenders/new', 'Save tender')}`;
    res.send(layout({ user: req.user, title: 'Add tender', active: 'tenders', body }));
  } catch (e) { next(e); }
});
router.post('/tenders/new', async (req, res, next) => {
  try {
    const t = await readTenderBody(req);
    if (!t.title) return res.redirect('/tenders/new');
    t.stage = OPEN_STAGES.includes(req.body.stage) ? req.body.stage : 'Awareness';
    const info = await prepare(`INSERT INTO tenders (title, tender_no, department_id, value_inr, deadline, stage, notes)
      VALUES (:title, :tender_no, :department_id, :value_inr, :deadline, :stage, :notes)`).run(t);
    const id = info.lastInsertRowid;
    await setTenderOfficers(id, officerIdsFrom(req));
    await prepare('INSERT INTO stage_history (tender_id, from_stage, to_stage, note, moved_by) VALUES (?, NULL, ?, ?, ?)')
      .run(id, t.stage, 'Tender created', req.user.id);
    res.redirect(`/tenders/${id}`);
  } catch (e) { next(e); }
});

// ---- Detail ----
router.get('/tenders/:id(\\d+)', async (req, res, next) => {
  try {
    const t = await prepare(`SELECT t.*, d.name AS dept FROM tenders t LEFT JOIN departments d ON d.id = t.department_id WHERE t.id = ?`).get(req.params.id);
    if (!t) return res.status(404).send('Tender not found');
    const officers = await prepare(`
      SELECT o.id, o.name, o.designation, o.phone FROM tender_officers x JOIN officers o ON o.id = x.officer_id
      WHERE x.tender_id = ? ORDER BY o.name`).all(t.id);
    const history = await prepare(`
      SELECT h.*, u.name AS by_name FROM stage_history h LEFT JOIN users u ON u.id = h.moved_by
      WHERE h.tender_id = ? ORDER BY h.moved_at DESC, h.id DESC`).all(t.id);
    const acts = await prepare(`
      SELECT a.*, u.name AS by_name, o.name AS officer_name FROM activities a
      LEFT JOIN users u ON u.id = a.created_by LEFT JOIN officers o ON o.id = a.officer_id
      WHERE a.tender_id = ? ORDER BY a.created_at DESC LIMIT 100`).all(t.id);
    const stageIdx = STAGES.indexOf(t.stage);
    const terminal = t.stage === 'Won' || t.stage === 'Lost';
    const moveOptions = STAGES.filter(s => s !== t.stage).map(s => `<option>${s}</option>`).join('');

    const body = `
<div class="page-head">
  <div>
    <h1>${esc(t.title)}</h1>
    <p class="sub mono">${esc(t.tender_no || 'No tender no.')} · ${esc(t.dept || 'No department')}</p>
  </div>
  <div class="head-actions">
    <a class="btn" href="/tenders/${t.id}/edit">Edit</a>
    <form method="post" action="/tenders/${t.id}/delete" onsubmit="return confirm('Delete this tender and its history?')"><button class="btn danger">Delete</button></form>
  </div>
</div>

<div class="stage-track">
  ${STAGES.slice(0, 7).map((s, i) => `<div class="track-step ${i < stageIdx && !terminal ? 'done' : ''} ${s === t.stage ? 'current' : ''} ${terminal ? 'done' : ''}"><span>${i + 1}</span>${esc(s)}</div>`).join('<div class="track-line"></div>')}
  <div class="track-line"></div>
  <div class="track-step terminal ${t.stage === 'Won' ? 'current won' : ''} ${t.stage === 'Lost' ? 'current lost' : ''}"><span>8</span>${terminal ? esc(t.stage) : 'Won / Lost'}</div>
</div>

<div class="two-col">
  <div>
    <div class="card">
      <h3>Details</h3>
      <div class="kv">
        <div><span>Value</span><b class="mono">${inr(t.value_inr)} (${inrShort(t.value_inr)})</b></div>
        <div><span>Deadline</span><b>${t.deadline ? fmtDate(t.deadline) + ' ' : '—'} ${dueBadge(t.deadline)}</b></div>
        <div><span>Stage</span><b>${stageBadge(t.stage)}</b></div>
        <div><span>Created</span><b>${fmtDate(t.created_at)}</b></div>
      </div>
      ${t.notes ? `<p class="notes">${esc(t.notes)}</p>` : ''}
    </div>
    <div class="card highlight">
      <h3>Move stage</h3>
      <form method="post" action="/tenders/${t.id}/stage" class="form-grid">
        <label>To stage<select name="stage">${moveOptions}</select></label>
        <label>Note<input name="note" placeholder="Why / what happened"></label>
        <div class="span2 actions"><button class="btn primary">Move</button></div>
      </form>
    </div>
    <div class="card">
      <h3>Linked officers <span class="count">${officers.length}</span></h3>
      ${officers.map(o => `<div class="minirow"><a href="/officers/${o.id}">${esc(o.name)}</a> <span class="sub">${esc(o.designation)}</span> ${o.phone ? `<a class="sub" href="tel:${esc(o.phone)}">${esc(o.phone)}</a>` : ''}</div>`).join('') || '<p class="sub">None linked — edit the tender to link officers.</p>'}
    </div>
    <div class="card">
      <h3>Stage history</h3>
      <div class="timeline">
        ${history.map(h => `<div class="tl-item">
          <div class="tl-head"><b>${h.from_stage ? esc(h.from_stage) + ' → ' : ''}${esc(h.to_stage)}</b></div>
          <p class="sub">${fmtDateTime(h.moved_at)} · ${esc(h.by_name || '')}${h.note ? ' · ' + esc(h.note) : ''}</p>
        </div>`).join('')}
      </div>
    </div>
  </div>
  <div>
    <div class="card highlight">
      <h3>Log an interaction</h3>
      <form method="post" action="/tenders/${t.id}/activity" class="form-grid">
        <label>Type<select name="type">${ACTIVITY_TYPES.map(x => `<option>${x}</option>`).join('')}</select></label>
        <label>With officer
          <select name="officer_id"><option value="">—</option>
            ${officers.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}
          </select>
        </label>
        <label class="span2">What was discussed *<textarea name="summary" rows="2" required></textarea></label>
        <label>Promised next step<input name="promised_next_step"></label>
        <label>Next follow-up date<input type="date" name="next_followup_date"></label>
        <div class="span2 actions"><button class="btn primary">Log it</button></div>
      </form>
    </div>
    <div class="card">
      <h3>Activity history <span class="count">${acts.length}</span></h3>
      <div class="timeline">
        ${acts.map(a => `<div class="tl-item">
          <div class="tl-head"><span class="badge type">${esc(a.type)}</span> <span class="sub">${fmtDateTime(a.created_at)} · ${esc(a.by_name || '')}</span></div>
          <p>${esc(a.summary)}</p>
          ${a.officer_name ? `<p class="sub">With: ${esc(a.officer_name)}</p>` : ''}
          ${a.promised_next_step ? `<p class="sub">Next: ${esc(a.promised_next_step)}${a.next_followup_date ? ' by ' + fmtDate(a.next_followup_date) : ''}</p>` : ''}
        </div>`).join('') || '<p class="sub">No interactions logged yet.</p>'}
      </div>
    </div>
  </div>
</div>`;
    res.send(layout({ user: req.user, title: t.title, active: 'tenders', body }));
  } catch (e) { next(e); }
});

// ---- Stage move ----
router.post('/tenders/:id(\\d+)/stage', async (req, res, next) => {
  try {
    const t = await prepare('SELECT * FROM tenders WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).send('Tender not found');
    const to = req.body.stage;
    if (!STAGES.includes(to) || to === t.stage) return res.redirect(`/tenders/${t.id}`);
    await prepare(`UPDATE tenders SET stage = ?, updated_at = now() WHERE id = ?`).run(to, t.id);
    await prepare('INSERT INTO stage_history (tender_id, from_stage, to_stage, note, moved_by) VALUES (?, ?, ?, ?, ?)')
      .run(t.id, t.stage, to, (req.body.note || '').trim(), req.user.id);
    res.redirect(`/tenders/${t.id}`);
  } catch (e) { next(e); }
});

// ---- Log activity ----
router.post('/tenders/:id(\\d+)/activity', async (req, res, next) => {
  try {
    const t = await prepare('SELECT id FROM tenders WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).send('Tender not found');
    const b = req.body;
    if (!(b.summary || '').trim()) return res.redirect(`/tenders/${t.id}`);
    const officerId = b.officer_id ? Number(b.officer_id) : null;
    await prepare(`INSERT INTO activities (officer_id, tender_id, type, summary, promised_next_step, next_followup_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(officerId, t.id, ACTIVITY_TYPES.includes(b.type) ? b.type : 'Note',
        b.summary.trim(), (b.promised_next_step || '').trim(), (b.next_followup_date || '').trim(), req.user.id);
    if (officerId && ((b.promised_next_step || '').trim() || (b.next_followup_date || '').trim())) {
      await prepare('UPDATE officers SET promised_next_step = ?, next_followup_date = ? WHERE id = ?')
        .run((b.promised_next_step || '').trim(), (b.next_followup_date || '').trim(), officerId);
    }
    res.redirect(`/tenders/${t.id}`);
  } catch (e) { next(e); }
});

// ---- Edit / update / delete ----
router.get('/tenders/:id(\\d+)/edit', async (req, res, next) => {
  try {
    const t = await prepare('SELECT * FROM tenders WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).send('Tender not found');
    const linked = (await prepare('SELECT officer_id FROM tender_officers WHERE tender_id = ?').all(t.id)).map(r => r.officer_id);
    const body = `<div class="page-head"><h1>Edit tender</h1></div>${await tenderForm(t, linked, `/tenders/${t.id}/edit`, 'Save changes')}`;
    res.send(layout({ user: req.user, title: 'Edit tender', active: 'tenders', body }));
  } catch (e) { next(e); }
});
router.post('/tenders/:id(\\d+)/edit', async (req, res, next) => {
  try {
    const t = await readTenderBody(req);
    t.id = Number(req.params.id);
    if (!t.title) return res.redirect(`/tenders/${t.id}/edit`);
    await prepare(`UPDATE tenders SET title=:title, tender_no=:tender_no, department_id=:department_id,
      value_inr=:value_inr, deadline=:deadline, notes=:notes, updated_at=now() WHERE id=:id`).run(t);
    await setTenderOfficers(t.id, officerIdsFrom(req));
    res.redirect(`/tenders/${t.id}`);
  } catch (e) { next(e); }
});
router.post('/tenders/:id(\\d+)/delete', async (req, res, next) => {
  try {
    await prepare('DELETE FROM tenders WHERE id = ?').run(req.params.id);
    res.redirect('/tenders');
  } catch (e) { next(e); }
});

module.exports = router;
