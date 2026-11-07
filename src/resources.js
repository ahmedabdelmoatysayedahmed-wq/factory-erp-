// تعريف الأقسام (الجداول) وحقول كل قسم - الشاشات تُبنى منها تلقائياً
const opt = (o) => Object.entries(o).map(([value, label]) => ({ value, label }));

const STATUS = {
  employee: { active: 'على رأس العمل', inactive: 'متوقف' },
  machine: { running: 'تعمل', stopped: 'متوقفة', maintenance: 'صيانة', broken: 'عطلانة' },
  mold: { available: 'متاحة', in_use: 'على الماكينة', maintenance: 'صيانة', damaged: 'تالفة' },
  asset: { in_service: 'في الخدمة', maintenance: 'صيانة', retired: 'مستبعد' },
  move: { in: 'وارد', out: 'صرف', adjust: 'تسوية (+/-)' },
  order: { open: 'مفتوح', in_progress: 'قيد التشغيل', done: 'منتهي', cancelled: 'ملغي' },
  shift: { morning: 'صباحي', evening: 'مسائي', night: 'ليلي' },
  leaveType: { annual: 'اعتيادية', casual: 'عارضة', sick: 'مرضية', unpaid: 'بدون أجر', other: 'أخرى' },
  leaveStatus: { pending: 'قيد المراجعة', approved: 'موافق عليها', rejected: 'مرفوضة' },
  att: { present: 'حاضر', late: 'متأخر', absent: 'غائب', leave: 'إجازة', off: 'راحة' },
};

const today = () => new Date().toISOString().slice(0, 10);

const resources = {
  employees: {
    title: 'الموظفين', single: 'موظف', order: 'name',
    fields: [
      { name: 'code', label: 'الكود', list: true },
      { name: 'name', label: 'الاسم', required: true, list: true },
      { name: 'job_title', label: 'الوظيفة', list: true },
      { name: 'department', label: 'القسم', list: true },
      { name: 'phone', label: 'التليفون', list: true },
      { name: 'hire_date', label: 'تاريخ التعيين', type: 'date' },
      { name: 'daily_target', label: 'المستهدف اليومي (قطعة)', type: 'number', list: true },
      { name: 'annual_leave_balance', label: 'رصيد الإجازات السنوي (يوم)', type: 'number' },
      { name: 'status', label: 'الحالة', type: 'select', options: opt(STATUS.employee), list: true },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' },
    ],
  },
  machines: {
    title: 'الماكينات', single: 'ماكينة', order: 'code',
    fields: [
      { name: 'code', label: 'الكود', list: true },
      { name: 'name', label: 'الاسم', required: true, list: true },
      { name: 'type', label: 'النوع', list: true },
      { name: 'location', label: 'المكان', list: true },
      { name: 'hourly_capacity', label: 'الطاقة (قطعة/ساعة)', type: 'number', list: true },
      { name: 'status', label: 'الحالة', type: 'select', options: opt(STATUS.machine), list: true },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' },
    ],
  },
  products: {
    title: 'المنتجات', single: 'منتج', order: 'name',
    fields: [
      { name: 'code', label: 'الكود', list: true },
      { name: 'name', label: 'الاسم', required: true, list: true },
      { name: 'unit', label: 'الوحدة', list: true },
      { name: 'notes', label: 'ملاحظات', type: 'textarea', list: true },
    ],
  },
  molds: {
    title: 'الإسطمبات', single: 'إسطمبة', order: 'code',
    // عدد الضربات = الضربات الأولية + (إنتاج + هالك) / عدد العيون
    select: `t.*, COALESCE(t.initial_shots,0) + COALESCE((SELECT CAST(SUM(qty_produced + qty_scrap) AS REAL) / MAX(t.cavities,1)
              FROM production_logs l WHERE l.mold_id = t.id),0) AS total_shots,
             COALESCE((SELECT CAST(SUM(qty_produced + qty_scrap) AS REAL) / MAX(t.cavities,1)
              FROM production_logs l WHERE l.mold_id = t.id AND (t.last_maintenance IS NULL OR l.date > t.last_maintenance)),0)
              AS shots_since_maint`,
    fields: [
      { name: 'code', label: 'الكود', list: true },
      { name: 'name', label: 'الاسم', required: true, list: true },
      { name: 'product_id', label: 'المنتج', type: 'ref', ref: 'products', list: true },
      { name: 'cavities', label: 'عدد العيون', type: 'number', list: true },
      { name: 'status', label: 'الحالة', type: 'select', options: opt(STATUS.mold), list: true },
      { name: 'location', label: 'مكان التخزين', list: true },
      { name: 'initial_shots', label: 'عدد ضربات سابقة', type: 'number' },
      { name: 'maintenance_every', label: 'صيانة كل (ضربة)', type: 'number' },
      { name: 'last_maintenance', label: 'تاريخ آخر صيانة', type: 'date', list: true },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' },
    ],
    computed: [
      { name: 'total_shots', label: 'إجمالي الضربات', fmt: 'int' },
      { name: 'shots_since_maint', label: 'ضربات منذ الصيانة', fmt: 'int' },
    ],
  },
  assets: {
    title: 'الأصول', single: 'أصل', order: 'code',
    fields: [
      { name: 'code', label: 'الكود', list: true },
      { name: 'name', label: 'الاسم', required: true, list: true },
      { name: 'category', label: 'الفئة', list: true },
      { name: 'location', label: 'المكان', list: true },
      { name: 'purchase_date', label: 'تاريخ الشراء', type: 'date' },
      { name: 'purchase_cost', label: 'تكلفة الشراء', type: 'number', list: true },
      { name: 'supplier', label: 'المورد' },
      { name: 'custodian_id', label: 'العهدة مع', type: 'ref', ref: 'employees', list: true },
      { name: 'status', label: 'الحالة', type: 'select', options: opt(STATUS.asset), list: true },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' },
    ],
  },
  materials: {
    title: 'المواد الخام', single: 'مادة خام', order: 'name',
    select: `t.*, COALESCE((SELECT SUM(CASE WHEN type='out' THEN -qty ELSE qty END)
             FROM stock_movements m WHERE m.material_id = t.id),0) AS stock`,
    fields: [
      { name: 'code', label: 'الكود', list: true },
      { name: 'name', label: 'الاسم', required: true, list: true },
      { name: 'unit', label: 'الوحدة', list: true },
      { name: 'min_stock', label: 'حد الطلب', type: 'number', list: true },
      { name: 'unit_cost', label: 'تكلفة الوحدة', type: 'number' },
      { name: 'supplier', label: 'المورد' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' },
    ],
    computed: [{ name: 'stock', label: 'الرصيد الحالي', fmt: 'num', warn: (r) => r.stock <= r.min_stock }],
  },
  stock_movements: {
    title: 'حركات المخزن', single: 'حركة مخزن', order: 'date DESC, id DESC', newDefaults: () => ({ date: today() }),
    fields: [
      { name: 'date', label: 'التاريخ', type: 'date', required: true, list: true },
      { name: 'material_id', label: 'المادة', type: 'ref', ref: 'materials', required: true, list: true },
      { name: 'type', label: 'نوع الحركة', type: 'select', options: opt(STATUS.move), required: true, list: true },
      { name: 'qty', label: 'الكمية', type: 'number', required: true, list: true },
      { name: 'order_id', label: 'أمر التشغيل (للصرف)', type: 'ref', ref: 'production_orders', refLabel: 'code', list: true },
      { name: 'reference', label: 'رقم المستند / الإذن', list: true },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' },
    ],
    validate(row, db, id) {
      if (row.type === 'out') {
        const r = db.prepare(`SELECT COALESCE(SUM(CASE WHEN type='out' THEN -qty ELSE qty END),0) s
          FROM stock_movements WHERE material_id=? AND id IS NOT ?`).get(row.material_id, id || null);
        if (Number(row.qty) > r.s) return `الكمية المطلوب صرفها أكبر من الرصيد المتاح (${r.s})`;
      }
      if (row.type !== 'adjust' && Number(row.qty) <= 0) return 'الكمية لازم تكون أكبر من صفر';
    },
  },
  production_orders: {
    title: 'أوامر التشغيل', single: 'أمر تشغيل', order: 'id DESC', newDefaults: () => ({ start_date: today() }),
    select: `t.*, COALESCE((SELECT SUM(qty_produced) FROM production_logs l WHERE l.order_id=t.id),0) AS produced`,
    fields: [
      { name: 'code', label: 'رقم الأمر', required: true, list: true },
      { name: 'product_id', label: 'المنتج', type: 'ref', ref: 'products', required: true, list: true },
      { name: 'qty_planned', label: 'الكمية المطلوبة', type: 'number', required: true, list: true },
      { name: 'start_date', label: 'تاريخ البدء', type: 'date', list: true },
      { name: 'due_date', label: 'تاريخ التسليم', type: 'date', list: true },
      { name: 'status', label: 'الحالة', type: 'select', options: opt(STATUS.order), list: true },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' },
    ],
    computed: [
      { name: 'produced', label: 'المنتج فعلياً', fmt: 'num' },
      { name: 'progress', label: 'نسبة الإنجاز', fmt: 'pct', calc: (r) => (r.qty_planned ? (r.produced / r.qty_planned) * 100 : 0) },
    ],
  },
  production_logs: {
    title: 'الإنتاج اليومي', single: 'تسجيل إنتاج', order: 'date DESC, id DESC',
    newDefaults: () => ({ date: today(), shift: 'morning', hours_worked: 8 }),
    fields: [
      { name: 'date', label: 'التاريخ', type: 'date', required: true, list: true },
      { name: 'shift', label: 'الوردية', type: 'select', options: opt(STATUS.shift), list: true },
      { name: 'employee_id', label: 'الموظف', type: 'ref', ref: 'employees', required: true, list: true },
      { name: 'machine_id', label: 'الماكينة', type: 'ref', ref: 'machines', required: true, list: true },
      { name: 'mold_id', label: 'الإسطمبة', type: 'ref', ref: 'molds', list: true },
      { name: 'order_id', label: 'أمر التشغيل', type: 'ref', ref: 'production_orders', refLabel: 'code', list: true },
      { name: 'product_id', label: 'المنتج', type: 'ref', ref: 'products', list: true },
      { name: 'qty_produced', label: 'الكمية المنتجة (سليم)', type: 'number', required: true, list: true },
      { name: 'qty_scrap', label: 'الهالك', type: 'number', list: true },
      { name: 'hours_worked', label: 'ساعات التشغيل', type: 'number', list: true },
      { name: 'downtime_minutes', label: 'دقائق التوقف', type: 'number', list: true },
      { name: 'downtime_reason', label: 'سبب التوقف' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' },
    ],
    beforeSave(row, db) {
      // لو اختار أمر تشغيل ومفيش منتج، ناخد منتج الأمر
      if (row.order_id && !row.product_id) {
        const o = db.prepare('SELECT product_id FROM production_orders WHERE id=?').get(row.order_id);
        if (o) row.product_id = o.product_id;
      }
    },
  },
  leaves: {
    title: 'الإجازات', single: 'طلب إجازة', order: 'from_date DESC', newDefaults: () => ({ from_date: today(), to_date: today() }),
    fields: [
      { name: 'employee_id', label: 'الموظف', type: 'ref', ref: 'employees', required: true, list: true },
      { name: 'type', label: 'نوع الإجازة', type: 'select', options: opt(STATUS.leaveType), required: true, list: true },
      { name: 'from_date', label: 'من', type: 'date', required: true, list: true },
      { name: 'to_date', label: 'إلى', type: 'date', required: true, list: true },
      { name: 'days', label: 'عدد الأيام', type: 'number', list: true, hint: 'يُحسب تلقائياً لو سبته فاضي' },
      { name: 'status', label: 'الحالة', type: 'select', options: opt(STATUS.leaveStatus), list: true },
      { name: 'reason', label: 'السبب', type: 'textarea' },
    ],
    validate(row) { if (row.to_date < row.from_date) return 'تاريخ النهاية قبل تاريخ البداية'; },
    beforeSave(row) {
      if (!row.days) row.days = Math.round((new Date(row.to_date) - new Date(row.from_date)) / 864e5) + 1;
    },
  },
};

module.exports = { resources, STATUS, today };
