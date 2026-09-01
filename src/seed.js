// Optional demo data so the app can be piloted/demoed immediately: `npm run seed`
// Safe to run once; refuses to run if officers already exist.
require('./loadenv');
const db = require('./db');
const { prepare, ensureDepartment } = db;

function d(offsetDays) {
  const x = new Date(Date.now() + offsetDays * 86400000);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function dt(offsetDays, hour) { return `${d(offsetDays)} ${String(hour).padStart(2, '0')}:30:00`; }

async function main() {
  await db.init();
  const existing = await prepare('SELECT COUNT(*)::int AS c FROM officers').get();
  if (existing.c > 0) {
    console.log('Database already has officers — seed skipped.');
    process.exit(0);
  }

  const pwd = await ensureDepartment('Public Works Department');
  const rural = await ensureDepartment('Rural Development & Panchayat Raj');
  const energy = await ensureDepartment('Energy Department');
  const urban = await ensureDepartment('Urban Development');
  const water = await ensureDepartment('Water Resources');

  const insOfficer = prepare(`INSERT INTO officers (name, designation, department_id, district, phone, email, reports_to, promised_next_step, next_followup_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const oid = async (...a) => (await insOfficer.run(...a)).lastInsertRowid;

  const sharma = await oid('R. K. Sharma', 'Chief Engineer', pwd, 'Bengaluru Urban', '9876500001', 'rksharma@example.gov.in', null, '', '', 'Final authority for PWD electrical tenders');
  const patil = await oid('S. Patil', 'Executive Engineer', pwd, 'Bengaluru Urban', '9876500002', 'spatil@example.gov.in', sharma, 'Share GEM catalogue link', d(0), 'Prefers WhatsApp for documents');
  const reddy = await oid('M. Reddy', 'Assistant Executive Engineer', pwd, 'Mysuru', '9876500003', '', patil, 'Site visit for street light survey', d(-3), '');
  const rao = await oid('K. Nagaraja Rao', 'Superintending Engineer', energy, 'Bengaluru Urban', '9876500004', 'knrao@example.gov.in', null, 'Demo of solar pump controller', d(2), 'Very interested in solar range');
  const iyer = await oid('V. Iyer', 'Deputy Secretary', rural, 'Tumakuru', '9876500005', '', null, '', '', 'Met once at exhibition; needs re-engagement');
  const khan = await oid('A. Khan', 'Executive Engineer', water, 'Belagavi', '9876500006', 'akhan@example.gov.in', null, 'Send irrigation pump pricing', d(-1), '');
  const gowda = await oid('H. D. Gowda', 'Commissioner', urban, 'Hubballi-Dharwad', '9876500007', '', null, 'Follow up after budget approval', d(6), 'Budget expected next quarter');
  await oid('P. Srinivas', 'Junior Engineer', energy, 'Mysuru', '9876500008', '', rao, '', '', 'New contact, introduced by Rao');

  const insTender = prepare(`INSERT INTO tenders (title, tender_no, department_id, value_inr, deadline, stage, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const link = prepare('INSERT INTO tender_officers (tender_id, officer_id) VALUES (?, ?) ON CONFLICT DO NOTHING');
  const hist = prepare(`INSERT INTO stage_history (tender_id, from_stage, to_stage, note, moved_by, moved_at) VALUES (?, ?, ?, ?, 1, ?)`);

  async function tender(title, no, dept, value, deadline, stage, officers, note) {
    const id = (await insTender.run(title, no, dept, value, deadline, stage, note || '')).lastInsertRowid;
    for (const o of officers) await link.run(id, o);
    await hist.run(id, null, 'Awareness', 'Tender created', dt(-40, 10));
    if (stage !== 'Awareness') await hist.run(id, 'Awareness', stage, 'Progressed', dt(-10, 15));
    return id;
  }

  const t1 = await tender('Supply & installation of LED street lights — Phase II', 'KA/PWD/2026/0142', pwd, 4500000, d(9), 'Tender Published', [patil, reddy], 'Pre-bid meeting attended');
  const t2 = await tender('Solar water pumping systems for gram panchayats', 'KA/RDPR/2026/0067', rural, 12000000, d(21), 'Screening', [iyer], 'Eligibility docs under review');
  const t3 = await tender('Smart metering pilot — city division', 'KA/EN/2026/0031', energy, 8500000, d(4), 'Bid Submitted', [rao], 'Bid submitted, technical evaluation ongoing');
  const t4 = await tender('Irrigation pump house refurbishment', 'KA/WR/2026/0210', water, 3200000, d(30), 'Relationship', [khan], '');
  await tender('Public park solar lighting', 'KA/UD/2025/0389', urban, 1800000, d(-20), 'Won', [gowda], 'Delivered last quarter');
  await tender('Borewell recharge units — district pilot', 'KA/RDPR/2025/0290', rural, 2600000, d(-35), 'Lost', [iyer], 'Lost on price; L1 was 8% lower');
  await tender('EV charging points — municipal buildings', '', urban, 5600000, '', 'Awareness', [gowda], 'Concept discussed; budget not yet allocated');

  const insAct = prepare(`INSERT INTO activities (officer_id, tender_id, type, summary, promised_next_step, next_followup_date, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)`);

  await insAct.run(patil, t1, 'Meeting', 'Attended pre-bid meeting; clarified L1 evaluation criteria and delivery timelines.', 'Share GEM catalogue link', d(0), dt(-2, 11));
  await insAct.run(reddy, t1, 'Visit', 'Site walk of Phase II street light corridors with AEE; noted 340 poles.', 'Site visit for street light survey', d(-3), dt(-8, 15));
  await insAct.run(rao, t3, 'Call', 'Confirmed technical evaluation committee meets this week; our bid is compliant.', 'Demo of solar pump controller', d(2), dt(-1, 17));
  await insAct.run(khan, t4, 'Call', 'Discussed pump house scope; asked for updated pricing on 15HP sets.', 'Send irrigation pump pricing', d(-1), dt(-4, 12));
  await insAct.run(gowda, null, 'Presentation', 'Presented EV charging portfolio to Commissioner and two council members.', 'Follow up after budget approval', d(6), dt(-12, 10));
  await insAct.run(iyer, t2, 'Meeting', 'Reviewed eligibility criteria for solar pump tender; our past supply orders qualify.', '', '', dt(-25, 14));
  await insAct.run(sharma, null, 'Visit', 'Courtesy visit; introduced new product line brochure.', '', '', dt(-30, 16));

  console.log('Seeded demo data: 8 officers, 7 tenders, 7 activities across all pipeline stages.');
  process.exit(0);
}

main().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
