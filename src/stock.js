// مخزن المنتجات (الإنتاج التام) وتنبيهات النقص وخطة الإنتاج
//
// رصيد المنتج = آخر جرد + الإنتاج السليم بعد يوم الجرد + الوارد − المنصرف (بعد يوم الجرد)
// الجرد بيتحسب على إنه رصيد نهاية يومه. المنتج اللي ماعندوش أي جرد ولا حركة = "مش متابَع" ومالوش تنبيه.

function productStock(db) {
  const def = Number(db.getSetting('product_min_stock') || 100);
  const lastCount = db.prepare("SELECT date, qty FROM product_movements WHERE product_id=? AND type='count' ORDER BY date DESC, id DESC LIMIT 1");
  const prodAfter = db.prepare('SELECT COALESCE(SUM(qty_produced),0) s FROM production_logs WHERE product_id=? AND date > ?');
  const movesAfter = db.prepare(`SELECT COALESCE(SUM(CASE type WHEN 'in' THEN qty WHEN 'out' THEN -qty ELSE 0 END),0) s,
    COUNT(*) n FROM product_movements WHERE product_id=? AND type<>'count' AND date > ?`);
  return db.prepare('SELECT id, code, name, unit, min_stock FROM products ORDER BY name').all().map((p) => {
    const c = lastCount.get(p.id);
    const since = c ? c.date : '0000-00-00';
    const m = movesAfter.get(p.id, since);
    const tracked = !!c || m.n > 0;
    const stock = (c ? c.qty : 0) + prodAfter.get(p.id, since).s + m.s;
    const min = p.min_stock ?? def;
    return { ...p, min: min, stock, tracked, countDate: c ? c.date : null, low: tracked && stock < min };
  });
}

// تنبيهات: منتجات تحت الحد + مواد خام تحت حد الطلب + إسطمبات محتاجة صيانة
let cache = { t: 0, v: null };
function getAlerts(db, { fresh = false } = {}) {
  if (!fresh && cache.v && Date.now() - cache.t < 15000) return cache.v;
  const products = productStock(db).filter((p) => p.low).sort((a, b) => a.stock - b.stock);
  const materials = db.prepare(`SELECT * FROM (SELECT t.*, COALESCE((SELECT SUM(CASE WHEN type='out' THEN -qty ELSE qty END)
    FROM stock_movements m WHERE m.material_id=t.id),0) stock FROM materials t) WHERE stock <= min_stock ORDER BY name`).all();
  const molds = db.prepare(`SELECT * FROM (SELECT t.*, COALESCE((SELECT CAST(SUM(qty_produced+qty_scrap) AS REAL)/MAX(t.cavities,1)
    FROM production_logs l WHERE l.mold_id=t.id AND (t.last_maintenance IS NULL OR l.date > t.last_maintenance)),0) since
    FROM molds t WHERE t.maintenance_every > 0) WHERE since >= maintenance_every * 0.9 OR status IN ('maintenance','damaged')`).all();
  const maintenance = db.prepare(`SELECT o.*, COALESCE(m.code, d.code, a.code) eq FROM maintenance_orders o LEFT JOIN machines m ON m.id=o.machine_id
    LEFT JOIN molds d ON d.id=o.mold_id LEFT JOIN assets a ON a.id=o.asset_id WHERE o.status NOT IN ('done','cancelled')
    ORDER BY CASE o.type WHEN 'breakdown' THEN 0 ELSE 1 END, o.reported_at`).all();
  // ساعات اتقفلت ماتسجلتش في المحاضر المفتوحة (آخر يومين)
  const missed = db.prepare(`SELECT s.id, s.date, m.code mcode, m.name mname, COUNT(*) n FROM hourly_logs h JOIN shift_sheets s ON s.id=h.sheet_id
    JOIN machines m ON m.id=s.machine_id WHERE h.status='missed' AND s.date >= date('now','-1 day') GROUP BY s.id ORDER BY s.date DESC, m.code`).all();
  const v = { products, materials, molds, maintenance, missed, count: products.length + materials.length + molds.length + maintenance.length + missed.length };
  cache = { t: Date.now(), v };
  return v;
}
const clearAlertsCache = () => { cache = { t: 0, v: null }; };

// ---------- فترات الخطة ----------
const iso = (d) => d.toISOString().slice(0, 10);
// الأسبوع بيبدأ السبت (الجمعة راحة)
function periodOf(type, dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (type === 'week') {
    const back = (d.getUTCDay() + 1) % 7; // السبت=6 => 0
    const start = new Date(d); start.setUTCDate(d.getUTCDate() - back);
    const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
    return { start: iso(start), end: iso(end) };
  }
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { start: iso(start), end: iso(end) };
}
function shiftPeriod(type, start, n) {
  const d = new Date(start + 'T00:00:00Z');
  if (type === 'week') d.setUTCDate(d.getUTCDate() + 7 * n); else d.setUTCMonth(d.getUTCMonth() + n);
  return periodOf(type, iso(d));
}

module.exports = { productStock, getAlerts, clearAlertsCache, periodOf, shiftPeriod };
