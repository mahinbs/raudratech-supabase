require('./src/loadenv');
const express = require('express');
const path = require('path');
const db = require('./src/db');
const { login, logout, authenticate, requireUser } = require('./src/auth');
const { bare } = require('./src/render');

const app = express();
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Login / logout ----
app.get('/login', (req, res) => {
  const failed = 'failed' in req.query;
  res.send(bare({
    title: 'Login',
    body: `
<div class="login-wrap">
  <form method="post" action="/login" class="login-card">
    <div class="login-brand">Raudratech <span>Tender CRM</span></div>
    <p class="sub">Government Follow-up &amp; Tender Pipeline</p>
    ${failed ? '<div class="flash inline error">Wrong username or password.</div>' : ''}
    <label>Username<input name="username" autocomplete="username" autofocus required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <button class="btn primary wide">Sign in</button>
  </form>
</div>`,
  }));
});
app.post('/login', async (req, res, next) => {
  try {
    const user = await authenticate(req.body.username, req.body.password);
    if (!user) return res.redirect('/login?failed');
    login(res, user.id);
    res.redirect(user.role === 'manager' ? '/dashboard' : '/worklist');
  } catch (e) { next(e); }
});
app.post('/logout', (req, res) => { logout(res); res.redirect('/login'); });

// ---- Authenticated app ----
app.use(requireUser);
app.get('/', (req, res) => res.redirect(req.user.role === 'manager' ? '/dashboard' : '/worklist'));
app.use(require('./src/routes/worklist'));
app.use(require('./src/routes/officers'));
app.use(require('./src/routes/tenders'));
app.use(require('./src/routes/dashboard'));
app.use(require('./src/routes/importer'));
app.use(require('./src/routes/settings'));

app.use((req, res) => res.status(404).send('Page not found. <a href="/">Home</a>'));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something went wrong. <a href="/">Home</a>');
});

const PORT = process.env.PORT || 3000;
db.init()
  .then(() => app.listen(PORT, () => console.log(`Raudratech Tender CRM (Supabase) running at http://localhost:${PORT}`)))
  .catch((e) => { console.error('Failed to start — database not ready:', e.message); process.exit(1); });
