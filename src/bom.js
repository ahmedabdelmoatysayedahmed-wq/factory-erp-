// BOM (مكونات المنتج): كل منتج بيتعمل من أنهي خامات وبكام لكل قطعة
// والاستهلاك الأوتوماتيك: لما الإنتاج يتسجل، الخامات بتتخصم من المخزن لوحدها
//
// كمية الخامة المستهلكة = (السليم + الهالك) × الكمية للقطعة × (1 + نسبة الفاقد ÷ 100)

const round = (x) => Math.round(x * 1000) / 1000;

// حركات صرف أوتوماتيك لتسجيل إنتاج (بتتمسح وتتعمل من جديد لو التسجيل اتعدل)
function applyConsumption(db, logId) {
  db.prepare('DELETE FROM stock_movements WHERE production_log_id=?').run(logId);
  const log = db.prepare('SELECT * FROM production_logs WHERE id=?').get(logId);
  if (!log || !log.product_id) return 0;
  const pieces = (log.qty_produced || 0) + (log.qty_scrap || 0);
  if (pieces <= 0) return 0;
  const lines = db.prepare('SELECT * FROM bom_lines WHERE product_id=?').all(log.product_id);
  const ins = db.prepare(`INSERT INTO stock_movements (date, material_id, type, qty, order_id, reference, production_log_id, user_id)
    VALUES (?,?,'out',?,?,?,?,?)`);
  for (const l of lines) {
    const qty = round(pieces * l.qty * (1 + (l.scrap_pct || 0) / 100));
    if (qty > 0) ins.run(log.date, l.material_id, qty, log.order_id, `استهلاك إنتاج #${log.id}`, log.id, log.user_id);
  }
  return lines.length;
}
const removeConsumption = (db, logId) => db.prepare('DELETE FROM stock_movements WHERE production_log_id=?').run(logId);

// رصيد كل خامة دلوقتي
function materialStock(db) {
  return Object.fromEntries(db.prepare(`SELECT t.id, COALESCE((SELECT SUM(CASE WHEN type='out' THEN -qty ELSE qty END)
    FROM stock_movements m WHERE m.material_id=t.id),0) stock FROM materials t`).all().map((r) => [r.id, r.stock]));
}

// سطور BOM لمنتج + تكلفة الخامات للقطعة
function bomOf(db, productId) {
  const lines = db.prepare(`SELECT b.*, m.code mcode, m.name mname, m.unit, m.unit_cost FROM bom_lines b
    JOIN materials m ON m.id=b.material_id WHERE b.product_id=? ORDER BY m.name`).all(productId)
    .map((l) => { const per = l.qty * (1 + (l.scrap_pct || 0) / 100); return { ...l, per, cost: l.unit_cost ? per * l.unit_cost : null }; });
  const cost = lines.some((l) => l.cost !== null) ? lines.reduce((s, l) => s + (l.cost || 0), 0) : null;
  return { lines, cost };
}

// الخامات المطلوبة لكميات منتجات: [{product_id, qty}] => لكل خامة: المطلوب والرصيد والعجز
function requirements(db, items) {
  const stock = materialStock(db);
  const need = {};
  const noBom = [];
  for (const it of items) {
    if (!(it.qty > 0)) continue;
    const lines = db.prepare('SELECT * FROM bom_lines WHERE product_id=?').all(it.product_id);
    if (!lines.length) { noBom.push(it.product_id); continue; }
    for (const l of lines) need[l.material_id] = (need[l.material_id] || 0) + it.qty * l.qty * (1 + (l.scrap_pct || 0) / 100);
  }
  const mats = Object.keys(need).length ? db.prepare(`SELECT * FROM materials WHERE id IN (${Object.keys(need).map(() => '?').join(',')}) ORDER BY name`).all(...Object.keys(need)) : [];
  const rows = mats.map((m) => {
    const req = round(need[m.id]); const st = round(stock[m.id] || 0);
    return { ...m, need: req, stock: st, short: round(Math.max(0, req - st)) };
  });
  return { rows, noBom };
}

module.exports = { applyConsumption, removeConsumption, materialStock, bomOf, requirements };
