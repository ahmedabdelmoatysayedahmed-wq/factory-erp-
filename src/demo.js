// بيانات تجريبية للعرض والتدريب
const ROSTER = require('./demo-employees');
// أسامي الموظفين الوهميين اللي كانت في النسخ القديمة من البيانات التجريبية
const OLD_FAKE = ['محمد علي', 'أحمد حسن', 'محمود سيد', 'كريم سمير', 'مصطفى عادل', 'عمرو خالد', 'إسلام فتحي', 'هاني رمضان', 'سامح نبيل', 'ياسر جمال'];
const TABLES = ['production_logs', 'stock_movements', 'attendance', 'leaves', 'production_orders', 'molds', 'assets', 'materials', 'products', 'machines'];

// مسح البيانات (المستخدمين والإعدادات مابيتمسحوش)
function clearData(db, { keepEmployees = false } = {}) {
  db.transaction(() => {
    for (const t of TABLES) db.exec(`DELETE FROM ${t}`);
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
    const prod = [['غطاء 38مم', 'قطعة'], ['جركن 5 لتر', 'قطعة'], ['برطمان 1 كجم', 'قطعة']].map(([name, unit], i) => ins('products', { code: 'P' + (i + 1), name, unit }));
    const molds = [['إسطمبة غطاء 38', 0, 8, 20000], ['إسطمبة جركن 5L', 1, 1, 15000], ['إسطمبة برطمان', 2, 2, 12000], ['إسطمبة غطاء 28 (احتياطي)', 0, 12, 20000]]
      .map(([name, p, cav, every], i) => ins('molds', { code: 'S' + (i + 1), name, product_id: prod[p], cavities: cav, maintenance_every: every, status: i === 3 ? 'available' : 'in_use', location: 'رف ' + (i + 1), initial_shots: i === 2 ? 10000 : 0, last_maintenance: day(30) }));
    const mats = [['بولي إيثيلين HDPE', 'كجم', 1000, 52], ['بولي بروبلين PP', 'كجم', 800, 48], ['ماستر باتش أزرق', 'كجم', 30, 180], ['ماستر باتش أبيض', 'كجم', 30, 150], ['كراتين تعبئة', 'كرتونة', 200, 9]]
      .map(([name, unit, min, cost], i) => ins('materials', { code: 'R' + (i + 1), name, unit, min_stock: min, unit_cost: cost, supplier: i < 2 ? 'مورد خامات' : 'مورد محلي' }));
    [[0, 5000], [1, 3000], [2, 60], [3, 100], [4, 1500]].forEach(([m, q]) => ins('stock_movements', { date: day(14), material_id: mats[m], type: 'in', qty: q, reference: 'رصيد افتتاحي' }));
    const orders = [['PO-101', 0, 60000, 14, 2, 'in_progress'], ['PO-102', 1, 12000, 10, 3, 'in_progress'], ['PO-103', 2, 8000, 4, -6, 'open']]
      .map(([code, p, q, s, d, status]) => ins('production_orders', { code, product_id: prod[p], qty_planned: q, start_date: day(s), due_date: day(d), status }));
    [[0, 0, 2600], [1, 1, 2300], [2, 0, 25], [3, 2, 40], [4, 0, 1350]].forEach(([m, o, q]) => ins('stock_movements', { date: day(7), material_id: mats[m], type: 'out', qty: q, order_id: orders[o], reference: 'إذن صرف ' + (500 + m) }));

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
    [['شاحنة نقل ربع نقل', 'سيارات', 450000], ['ونش شوكة (كلارك)', 'معدات مناولة', 380000], ['كمبيوتر المخزن', 'أجهزة', 18000], ['كمبريسور هواء', 'معدات', 95000], ['ميزان إلكتروني 300 كجم', 'أجهزة قياس', 12000]]
      .forEach(([name, category, cost], i) => ins('assets', { code: 'A' + (i + 1), name, category, purchase_cost: cost, purchase_date: '2023-0' + (i + 2) + '-15', custodian_id: emps[i % emps.length].id, location: i === 0 ? 'الجراج' : 'المصنع', status: 'in_service' }));
    count = emps.length;
  })();
  return count;
}

// هل الموظفين الموجودين هما بس الموظفين الوهميين القدام؟
function hasOnlyOldFakeEmployees(db) {
  const names = db.prepare('SELECT name FROM employees').all().map((r) => r.name);
  return names.length > 0 && names.every((n) => OLD_FAKE.includes(n));
}

module.exports = { seedDemo, clearData, hasOnlyOldFakeEmployees, ROSTER };
