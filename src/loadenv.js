// Minimal .env loader (no dependency). Reads KEY=VALUE lines from a .env file
// in the project root, if present, without overwriting already-set env vars.
const fs = require('fs');
const path = require('path');
try {
  const p = path.join(__dirname, '..', '.env');
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const eq = s.indexOf('=');
      if (eq < 0) continue;
      const key = s.slice(0, eq).trim();
      let val = s.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (!(key in process.env)) process.env[key] = val;
    }
  }
} catch (e) { /* ignore */ }
