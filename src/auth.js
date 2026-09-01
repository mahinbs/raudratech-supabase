const crypto = require('crypto');
const { prepare, getSetting, verifyPassword } = require('./db');

const COOKIE = 'crm_session';
const SESSION_DAYS = 30;

function sign(payload) {
  const secret = getSetting('cookie_secret');
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${mac}`;
}
function verify(token) {
  if (!token) return null;
  const idx = token.lastIndexOf('.');
  if (idx < 0) return null;
  const payload = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const secret = getSetting('cookie_secret');
  if (!secret) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  const [userId, expires] = payload.split(':');
  if (Date.now() > Number(expires)) return null;
  return Number(userId);
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function login(res, userId) {
  const expires = Date.now() + SESSION_DAYS * 86400000;
  const token = sign(`${userId}:${expires}`);
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
}
function logout(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

async function authenticate(username, password) {
  const user = await prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim().toLowerCase());
  if (!user) return null;
  if (!verifyPassword(password || '', user.password_hash)) return null;
  return user;
}

// Middleware: attach req.user or redirect to /login
async function requireUser(req, res, next) {
  try {
    const token = parseCookies(req)[COOKIE];
    const userId = verify(token);
    if (userId) {
      const user = await prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(userId);
      if (user) { req.user = user; return next(); }
    }
    res.redirect('/login');
  } catch (e) { next(e); }
}
function requireManager(req, res, next) {
  if (req.user && req.user.role === 'manager') return next();
  res.status(403).send('Managers only. <a href="/">Back</a>');
}

module.exports = { login, logout, authenticate, requireUser, requireManager };
