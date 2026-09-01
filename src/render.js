// Server-rendered HTML helpers — layout, escaping, formatting.
const { STAGES } = require('./db');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
function inr(n) { return '₹' + inrFmt.format(Number(n) || 0); }
function inrShort(n) {
  n = Number(n) || 0;
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(n % 1e7 === 0 ? 0 : 2) + ' Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(n % 1e5 === 0 ? 0 : 1) + ' L';
  return inr(n);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso.replace(' ', 'T'));
  if (isNaN(d)) return esc(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso.replace(' ', 'T'));
  if (isNaN(d)) return esc(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', ' +
    d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr + 'T00:00:00');
  const now = new Date(todayStr() + 'T00:00:00');
  return Math.round((target - now) / 86400000);
}
function daysSince(iso) {
  if (!iso) return null;
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso.replace(' ', 'T'));
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function stageBadge(stage) {
  const idx = STAGES.indexOf(stage);
  const cls = stage === 'Won' ? 'won' : stage === 'Lost' ? 'lost' : 'open';
  const num = idx >= 0 && idx < 7 ? `${idx + 1}/7 · ` : '';
  return `<span class="badge stage-${cls}">${num}${esc(stage)}</span>`;
}

function dueBadge(dateStr) {
  const d = daysUntil(dateStr);
  if (d == null) return '';
  if (d < 0) return `<span class="badge due-overdue">Overdue ${-d}d</span>`;
  if (d === 0) return `<span class="badge due-today">Due today</span>`;
  if (d <= 3) return `<span class="badge due-soon">In ${d}d</span>`;
  return `<span class="badge due-later">${fmtDate(dateStr)}</span>`;
}

function layout({ user, title, active, body, flash }) {
  const nav = [
    ['/worklist', 'Today', 'worklist'],
    ['/officers', 'Officers', 'officers'],
    ['/tenders', 'Tenders', 'tenders'],
    ['/dashboard', 'Pipeline', 'dashboard'],
    ['/import', 'Import', 'import'],
  ];
  if (user && user.role === 'manager') nav.push(['/settings', 'Settings', 'settings']);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Raudratech CRM</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Public+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="/">Raudratech <span>Tender CRM</span></a>
  <nav>
    ${nav.map(([href, label, key]) => `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`).join('')}
  </nav>
  <div class="userbox">
    <span class="uname">${esc(user ? user.name : '')} <em>${user ? (user.role === 'manager' ? 'Manager' : 'Field') : ''}</em></span>
    <form method="post" action="/logout"><button class="linklike">Logout</button></form>
  </div>
</header>
${flash ? `<div class="flash">${esc(flash)}</div>` : ''}
<main class="container">
${body}
</main>
</body>
</html>`;
}

function bare({ title, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Raudratech CRM</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Public+Sans:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/style.css">
</head>
<body class="bare">${body}</body>
</html>`;
}

module.exports = {
  esc, inr, inrShort, todayStr, fmtDate, fmtDateTime,
  daysUntil, daysSince, stageBadge, dueBadge, layout, bare,
};
