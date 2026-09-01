const express = require('express');
const { prepare, STAGES, ensureDepartment } = require('../db');
const { esc, layout } = require('../render');

const router = express.Router();

// Minimal CSV parser handling quoted fields and CRLF.
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some(f => f.trim() !== '')) rows.push(row); }
  return rows;
}

function rowsToObjects(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1).map(r => {
    const o = {};
    headers.forEach((h, i) => { o[h] = (r[i] || '').trim(); });
    return o;
  });
}

const OFFICER_TEMPLATE = 'name,designation,department,district,phone,email,reports_to_name,promised_next_step,next_followup_date,notes\n' +
  '"Rajesh Kumar","Executive Engineer","Public Works Department","Bengaluru Urban","9876543210","rajesh@example.gov.in","","Send product spec sheet","2026-09-01","Met at PWD expo"\n';
const TENDER_TEMPLATE = 'title,tender_no,department,value_inr,deadline,stage,officer_names,notes\n' +
  '"Supply of solar street lights Phase II","KA/PWD/2026/0142","Public Works Department","4500000","2026-09-15","Tender Published","Rajesh Kumar","Pre-bid meeting done"\n';

router.get('/import', (req, res) => {
  const flash = req.query.done ? req.query.done : '';
  const body = `
<div class="page-head"><h1>Import data</h1></div>
${flash ? `<div class="flash inline">${esc(flash)}</div>` : ''}
<div class="two-col">
  <div class="card">
    <h3>Officers</h3>
    <p class="sub">Columns: <span class="mono">name, designation, department, district, phone, email, reports_to_name, promised_next_step, next_followup_date, notes</span>. Only <b>name</b> is required. Dates as <span class="mono">YYYY-MM-DD</span>.</p>
    <p><a class="btn small" href="/import/template/officers">Download template</a></p>
    <form method="post" action="/import/officers">
      <textarea name="csv" rows="8" placeholder="Paste CSV here (including the header row)" required></textarea>
      <div class="actions"><button class="btn primary">Import officers</button></div>
    </form>
  </div>
  <div class="card">
    <h3>Tenders</h3>
    <p class="sub">Columns: <span class="mono">title, tender_no, department, value_inr, deadline, stage, officer_names, notes</span>. Only <b>title</b> is required. <span class="mono">officer_names</span> is semicolon-separated; officers must exist (import officers first). Stage must be one of the 8 fixed stages.</p>
    <p><a class="btn small" href="/import/template/tenders">Download template</a></p>
    <form method="post" action="/import/tenders">
      <textarea name="csv" rows="8" placeholder="Paste CSV here (including the header row)" required></textarea>
      <div class="actions"><button class="btn primary">Import tenders</button></div>
    </form>
  </div>
</div>
<p class="sub">Tip: in Excel or Google Sheets use File → Save/Download as CSV, open the file in a text editor, and paste the contents here.</p>`;
  res.send(layout({ user: req.user, title: 'Import', active: 'import', body }));
});

router.get('/import/template/:kind', (req, res) => {
  const kind = req.params.kind;
  const content = kind === 'tenders' ? TENDER_TEMPLATE : OFFICER_TEMPLATE;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${kind}_template.csv"`);
  res.send(content);
});

router.post('/import/officers', async (req, res, next) => {
  try {
    const objs = rowsToObjects(parseCSV(req.body.csv || ''));
    let imported = 0, skipped = 0;
    const pendingBosses = [];
    const ins = prepare(`INSERT INTO officers (name, designation, department_id, district, phone, email, promised_next_step, next_followup_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const o of objs) {
      if (!o.name) { skipped++; continue; }
      const deptId = o.department ? await ensureDepartment(o.department) : null;
      const info = await ins.run(o.name, o.designation || '', deptId, o.district || '', o.phone || '', o.email || '',
        o.promised_next_step || '', o.next_followup_date || '', o.notes || '');
      if (o.reports_to_name) pendingBosses.push({ id: info.lastInsertRowid, boss: o.reports_to_name });
      imported++;
    }
    for (const p of pendingBosses) {
      const boss = await prepare('SELECT id FROM officers WHERE name = ? AND id <> ? ORDER BY id LIMIT 1').get(p.boss, p.id);
      if (boss) await prepare('UPDATE officers SET reports_to = ? WHERE id = ?').run(boss.id, p.id);
    }
    res.redirect('/import?done=' + encodeURIComponent(`Officers: ${imported} imported, ${skipped} skipped (missing name).`));
  } catch (e) { next(e); }
});

router.post('/import/tenders', async (req, res, next) => {
  try {
    const objs = rowsToObjects(parseCSV(req.body.csv || ''));
    let imported = 0, skipped = 0, officerLinks = 0, officerMisses = 0;
    const ins = prepare(`INSERT INTO tenders (title, tender_no, department_id, value_inr, deadline, stage, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const linkIns = prepare('INSERT INTO tender_officers (tender_id, officer_id) VALUES (?, ?) ON CONFLICT DO NOTHING');
    const histIns = prepare('INSERT INTO stage_history (tender_id, from_stage, to_stage, note, moved_by) VALUES (?, NULL, ?, ?, ?)');
    for (const t of objs) {
      if (!t.title) { skipped++; continue; }
      const deptId = t.department ? await ensureDepartment(t.department) : null;
      const stage = STAGES.includes(t.stage) ? t.stage : 'Awareness';
      const info = await ins.run(t.title, t.tender_no || '', deptId, Number(t.value_inr) || 0, t.deadline || '', stage, t.notes || '');
      await histIns.run(info.lastInsertRowid, stage, 'Imported', req.user.id);
      for (const name of (t.officer_names || '').split(';').map(s => s.trim()).filter(Boolean)) {
        const off = await prepare('SELECT id FROM officers WHERE name = ? ORDER BY id LIMIT 1').get(name);
        if (off) { await linkIns.run(info.lastInsertRowid, off.id); officerLinks++; }
        else officerMisses++;
      }
      imported++;
    }
    const missNote = officerMisses ? ` ${officerMisses} officer name(s) not found.` : '';
    res.redirect('/import?done=' + encodeURIComponent(`Tenders: ${imported} imported, ${skipped} skipped. ${officerLinks} officer links created.${missNote}`));
  } catch (e) { next(e); }
});

module.exports = router;
