// صيانة المعدات: خطط وقائية (كل كام يوم / ساعة تشغيل / ضربة) + أوامر صيانة (وقائية / عطل / فحص)
// لما خطة توصل ميعادها، البرنامج بيفتح أمر صيانة لوحده

const now = () => new Date().toISOString().slice(0, 16); // yyyy-mm-ddThh:mm
const day = (s) => (s ? String(s).slice(0, 10) : null);

// قد إيه اتستهلك من الخطة من آخر صيانة (أيام / ساعات تشغيل / ضربات)
const USED_SQL = `CASE t.interval_type
  WHEN 'days' THEN COALESCE(julianday(date('now')) - julianday(t.last_done), 1e9)
  WHEN 'hours' THEN (SELECT COALESCE(SUM(l.hours_worked),0) FROM production_logs l WHERE l.machine_id=t.machine_id AND l.date > COALESCE(t.last_done,'0000'))
  WHEN 'shots' THEN (SELECT COALESCE(SUM(l.qty_produced + l.qty_scrap),0) FROM production_logs l WHERE l.mold_id=t.mold_id AND l.date > COALESCE(t.last_done,'0000'))
    / MAX(COALESCE((SELECT cavities FROM molds WHERE id=t.mold_id),1),1)
  END`;

function plans(db) {
  return db.prepare(`SELECT t.*, ${USED_SQL} used FROM maintenance_plans t WHERE t.active <> 'no'`).all()
    .map((p) => ({ ...p, pct: p.interval_value ? Math.min(999, (p.used * 100) / p.interval_value) : 0 }));
}

function nextCode(db) {
  const last = db.prepare("SELECT code FROM maintenance_orders WHERE code LIKE 'MO-%' ORDER BY id DESC LIMIT 1").get();
  return `MO-${String((last ? parseInt(last.code.slice(3), 10) || 0 : 0) + 1).padStart(4, '0')}`;
}
const openFor = (db, where, ...args) => db.prepare(`SELECT 1 FROM maintenance_orders WHERE status NOT IN ('done','cancelled') AND ${where}`).get(...args);

// يفتح أوامر صيانة للخطط اللي وصلت ميعادها، وللإسطمبات اللي وصلت عدد ضربات الصيانة
function createDueOrders(db) {
  let n = 0;
  const ins = db.prepare(`INSERT INTO maintenance_orders (code, type, machine_id, mold_id, asset_id, plan_id, title, priority, status, reported_at, assigned_to, notes)
    VALUES (?, 'preventive', ?, ?, ?, ?, ?, 'normal', 'open', ?, ?, ?)`);
  db.transaction(() => {
    for (const p of plans(db)) {
      if (p.pct < 100 || openFor(db, 'plan_id=?', p.id)) continue;
      ins.run(nextCode(db), p.machine_id, p.mold_id, p.asset_id, p.id, p.title, now(), p.assigned_to, 'اتفتح أوتوماتيك: الخطة وصلت ميعادها');
      n++;
    }
    const molds = db.prepare(`SELECT * FROM (SELECT t.*, COALESCE((SELECT CAST(SUM(qty_produced+qty_scrap) AS REAL)/MAX(t.cavities,1)
      FROM production_logs l WHERE l.mold_id=t.id AND (t.last_maintenance IS NULL OR l.date > t.last_maintenance)),0) since
      FROM molds t WHERE t.maintenance_every > 0) WHERE since >= maintenance_every`).all();
    for (const m of molds) {
      if (openFor(db, 'mold_id=?', m.id)) continue;
      ins.run(nextCode(db), null, m.id, null, null, `صيانة دورية للإسطمبة (كل ${m.maintenance_every} ضربة)`, now(), null, 'اتفتح أوتوماتيك: الإسطمبة وصلت عدد ضربات الصيانة');
      n++;
    }
  })();
  return n;
}

// أثر أمر الصيانة على حالة المعدة والخطة
function applyOrderEffects(db, id) {
  const o = db.prepare('SELECT * FROM maintenance_orders WHERE id=?').get(id);
  if (!o) return;
  const active = !['done', 'cancelled'].includes(o.status);
  if (o.machine_id) {
    if (active && o.type !== 'inspection' && (o.type === 'breakdown' || o.status === 'in_progress'))
      db.prepare("UPDATE machines SET status=? WHERE id=?").run(o.type === 'breakdown' ? 'broken' : 'maintenance', o.machine_id);
    else if (!active && !openFor(db, "machine_id=? AND type<>'inspection' AND id<>?", o.machine_id, o.id))
      db.prepare("UPDATE machines SET status='running' WHERE id=? AND status IN ('broken','maintenance')").run(o.machine_id);
  }
  if (o.mold_id) {
    if (active && (o.type === 'breakdown' || o.status === 'in_progress')) db.prepare("UPDATE molds SET status='maintenance' WHERE id=?").run(o.mold_id);
    else if (!active && !openFor(db, 'mold_id=? AND id<>?', o.mold_id, o.id))
      db.prepare("UPDATE molds SET status='available' WHERE id=? AND status IN ('maintenance','damaged')").run(o.mold_id);
    // الصيانة الوقائية للإسطمبة بتصفّر عداد الضربات
    if (o.status === 'done' && o.type === 'preventive') db.prepare('UPDATE molds SET last_maintenance=? WHERE id=?').run(day(o.finished_at) || day(now()), o.mold_id);
  }
  if (o.status === 'done' && o.plan_id) db.prepare('UPDATE maintenance_plans SET last_done=? WHERE id=?').run(day(o.finished_at) || day(now()), o.plan_id);
}

module.exports = { plans, createDueOrders, applyOrderEffects, nextCode, now, USED_SQL };
