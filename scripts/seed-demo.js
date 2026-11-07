// بيانات تجريبية للعرض والتدريب: node scripts/seed-demo.js
// تحذير: بيمسح كل البيانات الحالية (ما عدا المستخدمين)
const db = require('../src/db');
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const ins = (t, o) => db.prepare(`INSERT INTO ${t} (${Object.keys(o).join(',')}) VALUES (${Object.keys(o).map(() => '?').join(',')})`).run(...Object.values(o)).lastInsertRowid;
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

db.transaction(() => {
  for (const t of ['production_logs', 'stock_movements', 'attendance', 'leaves', 'production_orders', 'molds', 'assets', 'materials', 'products', 'machines', 'employees']) db.exec(`DELETE FROM ${t}`);
  const emps = [['محمد علي', 'مشغل ماكينة', 600], ['أحمد حسن', 'مشغل ماكينة', 600], ['محمود سيد', 'مشغل ماكينة', 550], ['كريم سمير', 'مشغل ماكينة', 600],
    ['مصطفى عادل', 'مشغل ماكينة', 550], ['عمرو خالد', 'فني صيانة', null], ['إسلام فتحي', 'مشرف وردية', null], ['هاني رمضان', 'أمين مخزن', null],
    ['سامح نبيل', 'عامل تعبئة', 800], ['ياسر جمال', 'عامل تعبئة', 800]]
    .map(([name, job, target], i) => ins('employees', { code: 'E' + String(i + 1).padStart(2, '0'), name, job_title: job, department: job.includes('تعبئة') ? 'التعبئة' : job.includes('مخزن') ? 'المخزن' : 'الإنتاج', daily_target: target, hire_date: '2024-0' + (1 + (i % 9)) + '-01', status: 'active', phone: '0100000' + String(1000 + i) }));
  const mach = [1, 2, 3, 4, 5].map((i) => ins('machines', { code: 'M' + i, name: 'مكبس حقن ' + i, type: i <= 3 ? 'حقن 250 طن' : 'حقن 400 طن', location: 'صالة ' + (i <= 3 ? 'أ' : 'ب'), hourly_capacity: i <= 3 ? 90 : 60, status: i === 5 ? 'maintenance' : 'running' }));
  const prod = [['غطاء 38مم', 'قطعة'], ['جركن 5 لتر', 'قطعة'], ['برطمان 1 كجم', 'قطعة']].map(([name, unit], i) => ins('products', { code: 'P' + (i + 1), name, unit }));
  const molds = [['إسطمبة غطاء 38', 0, 8, 20000], ['إسطمبة جركن 5L', 1, 1, 15000], ['إسطمبة برطمان', 2, 2, 12000], ['إسطمبة غطاء 28 (احتياطي)', 0, 12, 20000]]
    .map(([name, p, cav, every], i) => ins('molds', { code: 'S' + (i + 1), name, product_id: prod[p], cavities: cav, maintenance_every: every, status: i === 3 ? 'available' : 'in_use', location: 'رف ' + (i + 1), initial_shots: i === 2 ? 10000 : 0, last_maintenance: day(30) }));
  const mats = [['بولي إيثيلين HDPE', 'كجم', 1000, 52], ['بولي بروبلين PP', 'كجم', 800, 48], ['ماستر باتش أزرق', 'كجم', 30, 180], ['ماستر باتش أبيض', 'كجم', 30, 150], ['كراتين تعبئة', 'كرتونة', 200, 9]]
    .map(([name, unit, min, cost], i) => ins('materials', { code: 'R' + (i + 1), name, unit, min_stock: min, unit_cost: cost, supplier: i < 2 ? 'الشركة المصرية للبتروكيماويات' : 'مورد محلي' }));
  [[0, 5000], [1, 3000], [2, 60], [3, 100], [4, 1500]].forEach(([m, q]) => ins('stock_movements', { date: day(14), material_id: mats[m], type: 'in', qty: q, reference: 'رصيد افتتاحي' }));
  const orders = [['PO-101', 0, 60000, 14, 2, 'in_progress'], ['PO-102', 1, 12000, 10, 3, 'in_progress'], ['PO-103', 2, 8000, 4, -6, 'open']]
    .map(([code, p, q, s, d, status]) => ins('production_orders', { code, product_id: prod[p], qty_planned: q, start_date: day(s), due_date: day(d), status }));
  // صرف مواد خام لأوامر التشغيل
  [[0, 0, 2600], [1, 1, 2300], [2, 0, 25], [3, 2, 40], [4, 0, 1350]].forEach(([m, o, q]) => ins('stock_movements', { date: day(7), material_id: mats[m], type: 'out', qty: q, order_id: orders[o], reference: 'إذن صرف ' + (500 + m) }));
  // 14 يوم إنتاج وحضور (بدون الجمعة)
  const assign = [[0, 0, 0, 0], [1, 1, 0, 0], [2, 2, 2, 2], [3, 3, 1, 1], [4, 4, 1, 1]]; // موظف، ماكينة، إسطمبة، أمر
  for (let n = 13; n >= 0; n--) {
    const d = day(n); if (new Date(d).getDay() === 5) continue;
    emps.forEach((e, i) => {
      const r = rnd(); const status = r < 0.06 ? 'absent' : r < 0.14 ? 'late' : 'present';
      ins('attendance', { employee_id: e, date: d, status, check_in: status === 'absent' ? null : status === 'late' ? '08:' + (20 + Math.floor(rnd() * 30)) : '07:5' + Math.floor(rnd() * 9), check_out: status === 'absent' ? null : '16:0' + Math.floor(rnd() * 9) });
      const a = assign[i]; if (!a || status === 'absent' || (a[1] === 4 && n < 3)) return;
      const cap = a[1] <= 2 ? 90 : 60; const hours = 8; const eff = 0.7 + rnd() * 0.32; const down = Math.round(rnd() * 50);
      const total = Math.round(cap * hours * eff * (a[2] === 0 ? 1 : 1)); const scrap = Math.round(total * (0.01 + rnd() * 0.05));
      ins('production_logs', { date: d, shift: 'morning', employee_id: e, machine_id: mach[a[1]], mold_id: molds[a[2]], order_id: orders[a[3]], product_id: prod[[0, 1, 2][a[3]]],
        qty_produced: total - scrap, qty_scrap: scrap, hours_worked: hours, downtime_minutes: down, downtime_reason: down > 30 ? ['تغيير لون', 'انتظار مواد', 'عطل بسيط'][Math.floor(rnd() * 3)] : null });
    });
  }
  ins('leaves', { employee_id: emps[5], type: 'annual', from_date: day(-2), to_date: day(-4), days: 3, status: 'pending', reason: 'ظروف عائلية' });
  ins('leaves', { employee_id: emps[8], type: 'sick', from_date: day(6), to_date: day(5), days: 2, status: 'approved', reason: 'دور برد' });
  [['شاحنة نقل ربع نقل', 'سيارات', 450000, 7], ['ونش شوكة (كلارك)', 'معدات مناولة', 380000, 5], ['كمبيوتر المخزن', 'أجهزة', 18000, 7], ['كمبريسور هواء', 'معدات', 95000, 5], ['ميزان إلكتروني 300 كجم', 'أجهزة قياس', 12000, 7]]
    .forEach(([name, category, cost, c], i) => ins('assets', { code: 'A' + (i + 1), name, category, purchase_cost: cost, purchase_date: '2023-0' + (i + 2) + '-15', custodian_id: emps[c], location: i === 0 ? 'الجراج' : 'المصنع', status: 'in_service' }));
})();
console.log('تم إدخال البيانات التجريبية');
