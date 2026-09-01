# Raudratech — Government Tender Pipeline CRM (Supabase edition)

Government Follow-up & Tender Pipeline CRM for Raudratech — one system of record for every officer, department and tender from discovery to award/loss. This edition stores all data in **Supabase (Postgres)** instead of a local file, so the whole team shares one live database across devices.

## Quick start

1. Install dependencies:
   ```
   npm install
   ```
2. Configure the database. Copy `.env.example` to `.env` and set `DATABASE_URL` to your Supabase connection string:
   - Supabase Dashboard → **Project Settings → Database → Connection string → Session pooler**
   - Replace `[YOUR-PASSWORD]` with your database password.
   ```
   cp .env.example .env
   # then edit .env
   ```
3. (Optional) Load demo data so you can explore immediately:
   ```
   npm run seed
   ```
4. Start:
   ```
   npm start        # http://localhost:3000
   ```

The tables are created automatically on first start (`db.init()` runs `CREATE TABLE IF NOT EXISTS …`). To create the schema without starting the server, run `npm run initdb`.

### Default users
Change these in **Settings** after first login.

| Username | Password | Role |
|----------|----------|------|
| `anuj` | `anuj123` | Field |
| `manager` | `manager123` | Manager |

## What's inside (mapped to the signed SLA)

- **Officer & relationship register** — name, designation, department, district, reporting hierarchy, contacts, last interaction, promised next step, next follow-up date.
- **Tender pipeline register** — tender ID, department, value, deadline, linked officers, moving through the 8 fixed stages: Awareness → Relationship → Requirement Created → Tender Published → Screening → Forwarded to Tender Team → Bid Submitted → Won/Lost. Full stage history. List and board views.
- **Auto-generated daily worklist (Today tab)** — overdue follow-ups, due today, tender deadlines approaching, relationships going cold, and the next 3 days.
- **Follow-up reminders** — overdue items stay flagged until actioned; "going cold" threshold configurable in Settings.
- **Effortless activity logging** — log a call/visit/meeting in one form; the officer's promised-next-step and follow-up date update as a by-product.
- **Manager's live pipeline view (Pipeline tab)** — pipeline value by stage vs the target, win rate, performance by department, officers who convert, live activity feed.
- **CSV import (Import tab)** — bulk-load officers and tenders; templates downloadable.

## Tech

- Node.js + Express, server-rendered HTML (no build step).
- Supabase Postgres via `pg`. Signed-cookie sessions, scrypt password hashing, field/manager roles.
- Configuration via `DATABASE_URL` (see `.env.example`).

## Deploy

Any Node 18+ host (Render, Railway, Fly.io). Set `DATABASE_URL` (and optionally `PORT`) in the host's environment. Because the database lives in Supabase, the app process itself is stateless — scale or redeploy freely.
