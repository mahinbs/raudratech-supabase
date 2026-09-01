const express = require('express');
const { prepare, getSetting, setSetting, hashPassword } = require('../db');
const { esc, inr, layout } = require('../render');
const { requireManager } = require('../auth');

const router = express.Router();

router.get('/settings', requireManager, async (req, res, next) => {
  try {
    const users = await prepare('SELECT id, username, name, role FROM users ORDER BY id').all();
    const flash = req.query.done || '';
    const body = `
<div class="page-head"><h1>Settings</h1></div>
${flash ? `<div class="flash inline">${esc(flash)}</div>` : ''}
<div class="two-col">
  <div class="card">
    <h3>Targets & reminder rules</h3>
    <form method="post" action="/settings" class="form-grid">
      <label>Target amount (₹)<input name="target_amount" type="number" min="0" value="${esc(getSetting('target_amount'))}"></label>
      <label>Target label<input name="target_label" value="${esc(getSetting('target_label'))}"></label>
      <label>"Going cold" after (days without contact)<input name="cold_days" type="number" min="1" value="${esc(getSetting('cold_days'))}"></label>
      <label>Tender deadline warning (days ahead)<input name="deadline_soon_days" type="number" min="1" value="${esc(getSetting('deadline_soon_days'))}"></label>
      <div class="span2 actions"><button class="btn primary">Save settings</button></div>
    </form>
    <p class="sub">Current target reads as ${inr(getSetting('target_amount'))}.</p>
  </div>
  <div class="card">
    <h3>Users & passwords</h3>
    <div class="tbl-wrap plain"><table>
      <tr><th>User</th><th>Username</th><th>Role</th></tr>
      ${users.map(u => `<tr><td>${esc(u.name)}</td><td class="mono">${esc(u.username)}</td><td>${u.role === 'manager' ? 'Manager' : 'Field'}</td></tr>`).join('')}
    </table></div>
    <form method="post" action="/settings/password" class="form-grid" style="margin-top:14px">
      <label>User
        <select name="user_id">${users.map(u => `<option value="${u.id}">${esc(u.name)} (${esc(u.username)})</option>`).join('')}</select>
      </label>
      <label>New password<input name="password" type="password" required minlength="6"></label>
      <div class="span2 actions"><button class="btn primary">Set password</button></div>
    </form>
    <form method="post" action="/settings/users" class="form-grid" style="margin-top:18px">
      <h3 class="span2">Add user</h3>
      <label>Full name<input name="name" required></label>
      <label>Username<input name="username" required pattern="[a-z0-9_.-]+" title="lowercase letters, numbers, dot, dash, underscore"></label>
      <label>Password<input name="password" type="password" required minlength="6"></label>
      <label>Role
        <select name="role"><option value="field">Field</option><option value="manager">Manager</option></select>
      </label>
      <div class="span2 actions"><button class="btn">Add user</button></div>
    </form>
  </div>
</div>`;
    res.send(layout({ user: req.user, title: 'Settings', active: 'settings', body }));
  } catch (e) { next(e); }
});

router.post('/settings', requireManager, async (req, res, next) => {
  try {
    const b = req.body;
    if (b.target_amount !== undefined) await setSetting('target_amount', Math.max(0, Number(b.target_amount) || 0));
    if (b.target_label) await setSetting('target_label', b.target_label.trim());
    if (Number(b.cold_days) > 0) await setSetting('cold_days', Number(b.cold_days));
    if (Number(b.deadline_soon_days) > 0) await setSetting('deadline_soon_days', Number(b.deadline_soon_days));
    res.redirect('/settings?done=' + encodeURIComponent('Settings saved.'));
  } catch (e) { next(e); }
});

router.post('/settings/password', requireManager, async (req, res, next) => {
  try {
    const { user_id, password } = req.body;
    if (user_id && password && password.length >= 6) {
      await prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), Number(user_id));
      return res.redirect('/settings?done=' + encodeURIComponent('Password updated.'));
    }
    res.redirect('/settings?done=' + encodeURIComponent('Password not updated — minimum 6 characters.'));
  } catch (e) { next(e); }
});

router.post('/settings/users', requireManager, async (req, res, next) => {
  try {
    const { name, username, password, role } = req.body;
    if (!name || !username || !password || password.length < 6) {
      return res.redirect('/settings?done=' + encodeURIComponent('User not added — all fields required, password 6+ chars.'));
    }
    try {
      await prepare('INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)')
        .run(username.trim().toLowerCase(), hashPassword(password), name.trim(), role === 'manager' ? 'manager' : 'field');
      res.redirect('/settings?done=' + encodeURIComponent(`User ${name.trim()} added.`));
    } catch (e) {
      res.redirect('/settings?done=' + encodeURIComponent('Username already exists.'));
    }
  } catch (e) { next(e); }
});

module.exports = router;
