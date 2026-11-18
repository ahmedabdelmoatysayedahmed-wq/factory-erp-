// بيانات تجريبية للعرض والتدريب
const ROSTER = require('./demo-employees');
const MOLDS = require('./demo-molds');
// أسامي الإسطمبات الوهمية اللي كانت في النسخ القديمة
const OLD_FAKE_MOLDS = ['إسطمبة غطاء 38', 'إسطمبة جركن 5L', 'إسطمبة برطمان', 'إسطمبة غطاء 28 (احتياطي)'];
// أسامي الموظفين الوهميين اللي كانت في النسخ القديمة من البيانات التجريبية
const OLD_FAKE = ['محمد علي', 'أحمد حسن', 'محمود سيد', 'كريم سمير', 'مصطفى عادل', 'عمرو خالد', 'إسلام فتحي', 'هاني رمضان', 'سامح نبيل', 'ياسر جمال'];
const TABLES = ['bom_lines', 'production_plans', 'product_movements', 'upcoming_molds', 'production_logs', 'stock_movements', 'attendance', 'leaves', 'production_orders', 'molds', 'assets', 'materials', 'products', 'machines'];

// مسح البيانات (المستخدمين والإعدادات مابيتمسحوش)
// keepMolds: بيسيب الإسطمبات ومنتجاتها والإسطمبات القادمة (بيشيل بس عداد الإنتاج التجريبي منها)
function clearData(db, { keepEmployees = false, keepMolds = false } = {}) {
  const keep = keepMolds ? ['molds', 'products', 'upcoming_molds'] : [];
  db.transaction(() => {
    if (keepMolds) db.exec('UPDATE molds SET initial_shots=0, last_maintenance=NULL');
    if (keepEmployees) db.exec('UPDATE assets SET custodian_id=NULL');
    for (const t of TABLES) if (!keep.includes(t)) db.exec(`DELETE FROM ${t}`);
    if (!keepEmployees) db.exec('DELETE FROM employees');
  })();
}

// بيمسح كل البيانات (ما عدا الموظفين لو keepEmployees) ويحط بيانات تجريبية لآخر أسبوعين
// بيرجع عدد الموظفين اللي اتعملهم حضور
function seedDemo(db, { keepEmployees = false, resetEmployees = false } = {}) {
  if (resetEmployees) keepEmployees = false;
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const ins = (t, o) => Number(db.prepare(`INSERT INTO ${t} (${Object.keys(o).join(',')}) VALUES (${Object.keys(o).map(() => '?').join(',')})`).run(...Object.values(o)).lastInsertRowid);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let count = 0;

  db.transaction(() => {
    clearData(db, { keepEmployees });
    let emps = keepEmployees ? db.prepare(`SELECT id, job_title, daily_target FROM employees WHERE status='active' ORDER BY id`).all() : [];
    if (!emps.length) {
      // قائمة موظفين المصنع (src/demo-employees.js)
      emps = ROSTER.map((e) => ({ id: ins('employees', { ...e, status: 'active' }), job_title: e.job_title, daily_target: null }));
    }
    // العمال اللي هيشتغلوا على الماكينات: الأولوية للي وظيفتهم عامل/مشغل
    const isWorker = (e) => /عامل|مشغل|operator|worker/i.test(e.job_title || '');
    const operators = [...emps.filter(isWorker), ...emps.filter((e) => !isWorker(e))].slice(0, 5);
    for (const e of operators) if (!e.daily_target) db.prepare('UPDATE employees SET daily_target=? WHERE id=?').run(600, e.id);

    const mach = [1, 2, 3, 4, 5].map((i) => ins('machines', { code: 'M' + i, name: 'مكبس حقن ' + i, type: i <= 3 ? 'حقن 250 طن' : 'حقن 400 طن', location: 'صالة ' + (i <= 3 ? 'أ' : 'ب'), hourly_capacity: i <= 3 ? 90 : 60, status: i === 5 ? 'maintenance' : 'running' }));
    // إسطمبات المصنع (src/demo-molds.js) - كل إسطمبة ليها منتج بنفس رقم القطعة، و3 منهم شغالين
    const USED = [0, 3, 6];
    const allProducts = MOLDS.map((m) => ins('products', { code: m.code, name: m.name, name_en: m.name_en, unit: 'قطعة' }));
    const allMolds = MOLDS.map((m, i) => {
      const u = USED.indexOf(i);
      return ins('molds', { ...m, product_id: allProducts[i], cavities: 1, status: u >= 0 ? 'in_use' : 'available',
        ...(u >= 0 ? { maintenance_every: 15000, initial_shots: u === 2 ? 11000 : 0, last_maintenance: day(30) } : {}) });
    });
    const prod = USED.map((i) => allProducts[i]);
    const molds = USED.map((i) => allMolds[i]);
    // «الإسطمبات القادمة» بتفضل فاضية - بتتملى بالاستيراد من Excel
    const mats = [['بولي بروبلين PP', 'كجم', 1500, 48], ['بولي بروبلين + تالك PP-T20', 'كجم', 800, 55], ['ماستر باتش أسود', 'كجم', 100, 180], ['ماستر باتش أبيض', 'كجم', 30, 150], ['كراتين تعبئة', 'كرتونة', 200, 9]]
      .map(([name, unit, min, cost], i) => ins('materials', { code: 'R' + (i + 1), name, unit, min_stock: min, unit_cost: cost, supplier: i < 2 ? 'مورد خامات' : 'مورد محلي' }));
    [[0, 12000], [1, 6000], [2, 280], [3, 100], [4, 1300]].forEach(([m, q]) => ins('stock_movements', { date: day(14), material_id: mats[m], type: 'in', qty: q, reference: 'رصيد افتتاحي' }));
    const orders = [['PO-101', 0, 60000, 14, 2, 'in_progress'], ['PO-102', 1, 12000, 10, 3, 'in_progress'], ['PO-103', 2, 8000, 4, -6, 'open']]
      .map(([code, p, q, s, d, status]) => ins('production_orders', { code, product_id: prod[p], qty_planned: q, start_date: day(s), due_date: day(d), status }));
    // BOM للمنتجات الشغالة: [خامة، كمية للقطعة، فاقد %]
    const BOM = [[[0, 0.30, 3], [2, 0.006, 0], [4, 0.025, 0]], [[1, 0.45, 3], [2, 0.009, 0], [4, 0.05, 0]], [[0, 0.12, 4], [2, 0.0024, 0], [4, 0.01, 0]]];
    BOM.forEach((lines, i) => lines.forEach(([m, q, sp]) => ins('bom_lines', { product_id: prod[i], material_id: mats[m], qty: q, scrap_pct: sp })));

    // 14 يوم حضور وإنتاج (من غير أيام الراحة الأسبوعية)
    const assign = [[0, 0, 0], [1, 0, 0], [2, 2, 2], [3, 1, 1], [4, 1, 1]]; // ماكينة، إسطمبة، أمر
    for (let n = 13; n >= 0; n--) {
      const d = day(n); if (db.isOffDay(d)) continue;
      emps.forEach((e) => {
        const r = rnd(); const status = r < 0.06 ? 'absent' : r < 0.14 ? 'late' : 'present';
        ins('attendance', { employee_id: e.id, date: d, status,
          check_in: status === 'absent' ? null : status === 'late' ? '08:' + (20 + Math.floor(rnd() * 30)) : '07:5' + Math.floor(rnd() * 9),
          check_out: status === 'absent' ? null : '16:0' + Math.floor(rnd() * 9) });
        const k = operators.indexOf(e); const a = assign[k];
        if (!a || status === 'absent' || (k === 4 && n < 3)) return;
        const cap = k <= 2 ? 90 : 60; const eff = 0.7 + rnd() * 0.32; const down = Math.round(rnd() * 50);
        const total = Math.round(cap * 8 * eff); const scrap = Math.round(total * (0.01 + rnd() * 0.05));
        ins('production_logs', { date: d, shift: 'morning', employee_id: e.id, machine_id: mach[k], mold_id: molds[a[1]], order_id: orders[a[2]], product_id: prod[a[2]],
          qty_produced: total - scrap, qty_scrap: scrap, hours_worked: 8, downtime_minutes: down,
          downtime_reason: down > 30 ? ['تغيير لون', 'انتظار مواد', 'عطل بسيط'][Math.floor(rnd() * 3)] : null });
      });
    }
    // مخزن المنتجات: جرد من أسبوعين لأول 15 منتج + صرف للعملاء، و3 منهم رصيدهم تحت الحد
    const { periodOf } = require('./stock');
    allProducts.slice(0, 15).forEach((pid, i) => {
      ins('product_movements', { date: day(14), product_id: pid, type: 'count', qty: [400, 900, 650, 60, 300, 85, 1200, 150, 500, 40, 700, 220, 95, 380, 610][i], reference: 'جرد افتتاحي' });
      if (USED.includes(i)) ins('product_movements', { date: day(2), product_id: pid, type: 'out', qty: 5000 + i * 500, reference: 'إذن صرف عميل' });
    });
    // خطة الشهر والأسبوع للمنتجات الشغالة
    const m = periodOf('month', day(0)).start, w = periodOf('week', day(0)).start;
    prod.forEach((pid, i) => {
      ins('production_plans', { period_type: 'month', period_start: m, product_id: pid, qty_planned: [16000, 10000, 9000][i] });
      ins('production_plans', { period_type: 'week', period_start: w, product_id: pid, qty_planned: [3500, 2500, 2200][i] });
    });
    [['شاحنة نقل ربع نقل', 'سيارات', 450000], ['ونش شوكة (كلارك)', 'معدات مناولة', 380000], ['كمبيوتر المخزن', 'أجهزة', 18000], ['كمبريسور هواء', 'معدات', 95000], ['ميزان إلكتروني 300 كجم', 'أجهزة قياس', 12000]]
      .forEach(([name, category, cost], i) => ins('assets', { code: 'A' + (i + 1), name, category, purchase_cost: cost, purchase_date: '2023-0' + (i + 2) + '-15', custodian_id: emps[i % emps.length].id, location: i === 0 ? 'الجراج' : 'المصنع', status: 'in_service' }));
    // خصم الخامات للإنتاج التجريبي حسب الـ BOM
    const { applyConsumption } = require('./bom');
    for (const r of db.prepare('SELECT id FROM production_logs').all()) applyConsumption(db, r.id);
    count = emps.length;
    for (const f of MIGRATION_FLAGS) db.setSetting(f, '1');
  })();
  return count;
}

// قاعدة بيانات من نسخة قديمة محتاجة تصحيح؟ (الإسطمبات القادمة فيها إسطمبات المصنع)
// ملحوظة: الـ 101 في الإسطمبات والقادمة فاضية = الوضع الصح، مش محتاج تصحيح
function needsUpcomingFix(db) {
  const codes = new Set(MOLDS.map((m) => m.code));
  const up = db.prepare('SELECT code FROM upcoming_molds').all();
  return up.length > 0 && up.every((r) => codes.has(r.code));
}
// علامات التحديثات اللي اتعملت مرة واحدة - البيانات التجريبية الجديدة مش محتاجاها
const MIGRATION_FLAGS = ['roster_v1', 'molds_v1', 'upcoming_v1', 'upcoming_v2', 'upcoming_v3'];

// هل الإسطمبات الموجودة هي بس الإسطمبات الوهمية القديمة؟
function hasOnlyOldFakeMolds(db) {
  const names = db.prepare('SELECT name FROM molds').all().map((r) => r.name);
  return names.length > 0 && names.every((n) => OLD_FAKE_MOLDS.includes(n));
}

// هل الموظفين الموجودين هما بس الموظفين الوهميين القدام؟
function hasOnlyOldFakeEmployees(db) {
  const names = db.prepare('SELECT name FROM employees').all().map((r) => r.name);
  return names.length > 0 && names.every((n) => OLD_FAKE.includes(n));
}

module.exports = { seedDemo, clearData, hasOnlyOldFakeEmployees, hasOnlyOldFakeMolds, needsUpcomingFix, ROSTER, MOLDS };
