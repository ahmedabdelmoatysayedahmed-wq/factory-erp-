// محضر استلام الوردية: محضر لكل ماكينة في اليوم، 24 ساعة (نهاري 8 الصبح → 8 بالليل، وليلي 8 بالليل → 8 الصبح)
// بعد ما كل ساعة تخلص، العامل قدامه N دقايق (الافتراضي 3) يسجل إنتاجها.
// لو الوقت عدّى: الساعة بتتقفل وتتحسب "ماشتغلش" (إنتاج صفر)، وقدامه M دقايق (الافتراضي 5) يرفع صورة أو فيديو علشان تتحسب.
// بعدها بتتقفل نهائي، ومحدش يعدّلها غير المشرف.
// الساعات المتسجلة بتتجمع لوحدها في "الإنتاج اليومي" (ومنها التقارير وخصم الخامات وأوامر التشغيل).
const { applyConsumption, removeConsumption } = require('./bom');

const SLOTS = 24;
let clockOverride = null;
const now = () => (clockOverride ? new Date(clockOverride) : new Date());
const setClock = (d) => { clockOverride = d ? new Date(d) : null; }; // للاختبارات

const startHour = (db) => Number(db.getSetting('shift_start_hour') ?? 8);
const windowMin = (db) => Number(db.getSetting('hourly_window_min') ?? 3);
const proofMin = (db) => Number(db.getSetting('proof_window_min') ?? 5);
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localStamp = (d) => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseLocal = (s) => { const [d, t = '00:00'] = String(s).split('T'); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return new Date(y, m - 1, dd, h, mi); };

// بداية الساعة رقم i في محضر يوم date
function slotStart(db, date, i) { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d, startHour(db) + i, 0, 0); }
const slotEnd = (db, date, i) => new Date(slotStart(db, date, i).getTime() + 3600e3);
const hour12 = (h) => ((h + 11) % 12) + 1; // زي الورقة: 8، 9، ... 12، 1، 2
const half = (i) => (i < 12 ? 'day' : 'night');
// تاريخ المحضر الحالي: قبل 8 الصبح لسه وردية ليل امبارح
function currentSheetDate(db, d = now()) { const x = new Date(d); if (x.getHours() < startHour(db)) x.setDate(x.getDate() - 1); return localDate(x); }

// حالة الساعة: done (اتسجلت) | open (الـ 3 دقايق شغالين) | proof (اتقفلت، والـ 5 دقايق بتوع الصورة/الفيديو شغالين)
// | missed (اتقفلت نهائي) | running (الساعة لسه شغالة) | future | off (قبل فتح المحضر أو بعد قفله)
function slotState(db, sheet, i, entry, at = now()) {
  const s = slotStart(db, sheet.date, i), e = slotEnd(db, sheet.date, i);
  if (entry && entry.status !== 'missed') return { state: 'done', end: e };
  const started = sheet.started_at ? parseLocal(sheet.started_at) : null;
  if (!started || e <= new Date(started.getFullYear(), started.getMonth(), started.getDate(), started.getHours())) return { state: 'off', end: e };
  if (sheet.closed_at && s >= parseLocal(sheet.closed_at)) return { state: 'off', end: e };
  if (at < s) return { state: 'future', end: e };
  if (at < e) return { state: 'running', end: e };
  const deadline = new Date(e.getTime() + windowMin(db) * 60e3);
  const proofDeadline = new Date(deadline.getTime() + proofMin(db) * 60e3);
  if (at <= deadline) return { state: 'open', end: e, deadline, proofDeadline };
  if (at <= proofDeadline) return { state: 'proof', end: e, deadline, proofDeadline };
  return { state: 'missed', end: e, deadline, proofDeadline };
}

// تجميع الساعات في "الإنتاج اليومي": سطر لكل (نص الوردية × العامل)
function aggregate(db, sheetId) {
  const sh = db.prepare('SELECT * FROM shift_sheets WHERE id=?').get(sheetId);
  if (!sh) return;
  const old = db.prepare('SELECT id FROM production_logs WHERE source_key LIKE ?').all(`sheet:${sheetId}:%`);
  for (const o of old) { removeConsumption(db, o.id); db.prepare('DELETE FROM production_logs WHERE id=?').run(o.id); }
  const rows = db.prepare('SELECT * FROM hourly_logs WHERE sheet_id=?').all(sheetId);
  const downs = db.prepare('SELECT * FROM sheet_downtimes WHERE sheet_id=?').all(sheetId);
  const groups = {};
  for (const r of rows) {
    const h = half(r.slot);
    const emp = r.employee_id || (h === 'day' ? sh.day_worker_id : sh.night_worker_id);
    if (!emp) continue;
    const g = groups[`${h}:${emp}`] ||= { h, emp, qty: 0, scrap: 0, hours: 0, missed: 0 };
    g.qty += r.qty || 0; g.scrap += r.scrap || 0;
    if (r.status === 'missed') g.missed++; else g.hours++;
  }
  const downByHalf = { day: 0, night: 0 };
  for (const d of downs) downByHalf[d.slot != null ? half(d.slot) : 'day'] += d.minutes || 0;
  const ins = db.prepare(`INSERT INTO production_logs (date, shift, employee_id, machine_id, mold_id, order_id, product_id, qty_produced, qty_scrap, hours_worked, downtime_minutes, notes, source_key)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const firstOfHalf = {};
  for (const g of Object.values(groups)) {
    const down = firstOfHalf[g.h] ? 0 : downByHalf[g.h]; firstOfHalf[g.h] = true; // التوقف بيتحسب مرة واحدة في نص الوردية
    const id = Number(ins.run(sh.date, g.h === 'day' ? 'morning' : 'night', g.emp, sh.machine_id, sh.mold_id, sh.order_id, sh.product_id, g.qty, g.scrap, g.hours, down,
      g.missed ? `من محضر الوردية - ${g.missed} ساعة ماتسجلتش (اتحسبت ماشتغلش)` : 'من محضر الوردية', `sheet:${sheetId}:${g.h}:${g.emp}`).lastInsertRowid);
    applyConsumption(db, id);
    db.prepare("UPDATE production_orders SET status='in_progress' WHERE status='open' AND id=?").run(sh.order_id);
  }
}

// الساعات اللي وقتها عدّى من غير تسجيل => "ماشتغلش" (بتشتغل كل دقيقة)
function markMissed(db, at = now()) {
  let n = 0;
  const sheets = db.prepare('SELECT * FROM shift_sheets WHERE closed_at IS NULL OR closed_at > ?').all(localStamp(new Date(at.getTime() - 2 * 864e5)));
  for (const sh of sheets) {
    const have = new Set(db.prepare('SELECT slot FROM hourly_logs WHERE sheet_id=?').all(sh.id).map((r) => r.slot));
    let changed = false;
    db.transaction(() => {
      for (let i = 0; i < SLOTS; i++) {
        const stt = slotState(db, sh, i, null, at).state;
        if (have.has(i) || (stt !== 'missed' && stt !== 'proof')) continue; // بتتحسب ماشتغلش أول ما الـ 3 دقايق يخلصوا
        db.prepare("INSERT INTO hourly_logs (sheet_id, slot, qty, scrap, employee_id, tech_id, status, entered_at) VALUES (?,?,0,0,?,?,'missed',?)")
          .run(sh.id, i, i < 12 ? sh.day_worker_id : sh.night_worker_id, i < 12 ? sh.day_tech_id : sh.night_tech_id, localStamp(at));
        n++; changed = true;
      }
      // المحضر بيتقفل لوحده بعد آخر ساعة في الوردية الليلي
      if (!sh.closed_at && at > new Date(slotEnd(db, sh.date, SLOTS - 1).getTime() + windowMin(db) * 60e3)) {
        db.prepare('UPDATE shift_sheets SET closed_at=? WHERE id=?').run(localStamp(slotEnd(db, sh.date, SLOTS - 1)), sh.id); changed = true;
      }
      if (changed) aggregate(db, sh.id);
    })();
  }
  return n;
}

module.exports = { SLOTS, now, setClock, startHour, windowMin, proofMin, slotStart, slotEnd, slotState, hour12, half, currentSheetDate, aggregate, markMissed, localDate, localStamp, parseLocal };
