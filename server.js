// Local / self-hosted entrypoint (Render, Railway, Fly, a VM, or `npm start`).
require('./src/loadenv');
const app = require('./app');
const db = require('./src/db');

const PORT = process.env.PORT || 3000;
db.init()
  .then(() => app.listen(PORT, () => console.log(`Raudratech Tender CRM (Supabase) running at http://localhost:${PORT}`)))
  .catch((e) => { console.error('Failed to start — database not ready:', e.message); process.exit(1); });
