// Postgres (Supabase) data layer.
// Provides a small better-sqlite3-like API (prepare().get/all/run) but async,
// so the route code reads almost identically to the original SQLite version.
const { Pool, types } = require('pg');
const crypto = require('crypto');

// --- Return timestamps as 'YYYY-MM-DD HH:MM:SS' strings (like the old SQLite text),
//     so render.js and string comparisons keep working unchanged. ---
function tsToText(raw) {
  if (raw == null) return null;
  const d = new Date(raw);
  if (isNaN(d)) return raw;
  return d.toISOString().replace('T', ' ').slice(0, 19); // UTC, seconds precision
}
types.setTypeParser(1114, tsToText); // timestamp
types.setTypeParser(1184, tsToText); // timestamptz

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('\n[config] DATABASE_URL is not set. Copy .env.example to .env and fill in your Supabase connection string.\n');
}
// Supabase requires SSL; a local Postgres (localhost) does not.
const isLocal = /@(localhost|127\.0\.0\.1)/.test(connectionString || '');
// The app keeps its tables in a dedicated schema so it never collides with
// anything else in the same database. Configurable via DB_SCHEMA (default "raudra").
const APP_SCHEMA = (process.env.DB_SCHEMA || 'raudra').replace(/[^a-zA-Z0-9_]/g, '');
const pool = new Pool({
  connectionString,
  ssl: connectionString && !isLocal ? { rejectUnauthorized: false } : false,
  max: 8,
});
// Every connection resolves unqualified names against our schema first.
pool.on('connect', (client) => { client.query(`SET search_path TO ${APP_SCHEMA}, public`); });

// ---- placeholder translation: `?` and `:name` -> `$n` ----
const NAMED = /(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g; // ignores ::type casts
const NO_ID_TABLES = new Set(['tender_officers', 'settings']);

function isInsert(sql) { return /^\s*insert\s+into\s+"?([a-zA-Z_][\w]*)"?/i.exec(sql); }

function buildQuery(sql, args) {
  const hasNamed = NAMED.test(sql);
  NAMED.lastIndex = 0;
  if (hasNamed) {
    const obj = (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) ? args[0] : {};
    const map = {}; const order = []; let i = 0;
    const text = sql.replace(NAMED, (m, name) => {
      if (!(name in map)) { map[name] = '$' + (++i); order.push(name); }
      return map[name];
    });
    const values = order.map(n => (obj[n] === undefined ? null : obj[n]));
    return { text, values };
  }
  let i = 0;
  const text = sql.replace(/\?/g, () => '$' + (++i));
  if (i === 0) return { text, values: [] }; // no placeholders: ignore any stray params object
  let values = args;
  if (args.length === 1 && Array.isArray(args[0])) values = args[0];
  values = values.map(v => (v === undefined ? null : v));
  return { text, values };
}

function prepare(sql) {
  return {
    async get(...args) { const { text, values } = buildQuery(sql, args); const r = await pool.query(text, values); return r.rows[0]; },
    async all(...args) { const { text, values } = buildQuery(sql, args); const r = await pool.query(text, values); return r.rows; },
    async run(...args) {
      let s = sql;
      const m = isInsert(s);
      if (m && !/returning/i.test(s) && !NO_ID_TABLES.has(m[1].toLowerCase())) s = s.replace(/;?\s*$/, '') + ' RETURNING id';
      const { text, values } = buildQuery(s, args);
      const r = await pool.query(text, values);
      return { changes: r.rowCount, lastInsertRowid: r.rows[0] ? r.rows[0].id : undefined };
    },
  };
}

async function exec(sql) { await pool.query(sql); }

// ---- Fixed domain constants (unchanged from SLA) ----
const STAGES = ['Awareness', 'Relationship', 'Requirement Created', 'Tender Published', 'Screening', 'Forwarded to Tender Team', 'Bid Submitted', 'Won', 'Lost'];
const OPEN_STAGES = STAGES.slice(0, 7);
const ACTIVITY_TYPES = ['Call', 'Visit', 'Meeting', 'Presentation', 'Note'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('field','manager'))
);
CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS officers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  designation TEXT DEFAULT '',
  department_id INTEGER REFERENCES departments(id),
  district TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  reports_to INTEGER REFERENCES officers(id) ON DELETE SET NULL,
  notes TEXT DEFAULT '',
  promised_next_step TEXT DEFAULT '',
  next_followup_date TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenders (
  id SERIAL PRIMARY KEY,
  tender_no TEXT DEFAULT '',
  title TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id),
  value_inr DOUBLE PRECISION DEFAULT 0,
  deadline TEXT DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'Awareness',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tender_officers (
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  officer_id INTEGER NOT NULL REFERENCES officers(id) ON DELETE CASCADE,
  PRIMARY KEY (tender_id, officer_id)
);
CREATE TABLE IF NOT EXISTS stage_history (
  id SERIAL PRIMARY KEY,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  note TEXT DEFAULT '',
  moved_by INTEGER REFERENCES users(id),
  moved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS activities (
  id SERIAL PRIMARY KEY,
  officer_id INTEGER REFERENCES officers(id) ON DELETE CASCADE,
  tender_id INTEGER REFERENCES tenders(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  promised_next_step TEXT DEFAULT '',
  next_followup_date TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_act_officer ON activities(officer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_act_tender ON activities(tender_id, created_at);
CREATE INDEX IF NOT EXISTS idx_officers_followup ON officers(next_followup_date);
`;

// ---- settings cache (so getSetting stays synchronous like the original) ----
const settingsCache = {};
function getSetting(key) { return key in settingsCache ? settingsCache[key] : null; }
async function setSetting(key, value) {
  await pool.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, String(value)]);
  settingsCache[key] = String(value);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

async function ensureDepartment(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  await pool.query('INSERT INTO departments (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [trimmed]);
  const r = await pool.query('SELECT id FROM departments WHERE name = $1', [trimmed]);
  return r.rows[0].id;
}

let initialised = false;
async function init() {
  if (initialised) return;
  await exec(`CREATE SCHEMA IF NOT EXISTS ${APP_SCHEMA}`);
  await exec(SCHEMA);
  const defaults = {
    target_amount: '20000000',
    target_label: 'Quarterly Target',
    cold_days: '21',
    deadline_soon_days: '7',
    cookie_secret: crypto.randomBytes(32).toString('hex'),
  };
  for (const [k, v] of Object.entries(defaults)) {
    await pool.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [k, v]);
  }
  const c = await pool.query('SELECT COUNT(*)::int AS c FROM users');
  if (c.rows[0].c === 0) {
    const ins = 'INSERT INTO users (username, password_hash, name, role) VALUES ($1,$2,$3,$4)';
    await pool.query(ins, ['anuj', hashPassword('anuj123'), 'Anuj', 'field']);
    await pool.query(ins, ['manager', hashPassword('manager123'), 'Reporting Manager', 'manager']);
  }
  const rows = await pool.query('SELECT key, value FROM settings');
  for (const r of rows.rows) settingsCache[r.key] = r.value;
  initialised = true;
}

module.exports = {
  pool, prepare, exec, init,
  STAGES, OPEN_STAGES, ACTIVITY_TYPES,
  getSetting, setSetting, hashPassword, verifyPassword, ensureDepartment,
};
