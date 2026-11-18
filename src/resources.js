// تعريف الأقسام (الجداول) وحقول كل قسم - الشاشات تُبنى منها تلقائياً
const { applyConsumption, removeConsumption } = require('./bom');
const MT = require('./maintenance');
const opt = (o) => Object.entries(o).map(([value, label]) => ({ value, label }));

const STATUS = {
  employee: { active: 'على رأس العمل', inactive: 'متوقف' },
  machine: { running: 'تعمل', stopped: 'متوقفة', maintenance: 'صيانة', broken: 'عطلانة' },
  upcoming: { manufacturing: 'قيد التصنيع', trial: 'تجربة (T0)', shipping: 'في الشحن', customs: 'في الجمرك' },
  mold: { available: 'متاحة', in_use: 'على الماكينة', maintenance: 'صيانة', damaged: 'تالفة' },
  asset: { in_service: 'في الخدمة', maintenance: 'صيانة', retired: 'مستبعد' },
  move: { in: 'وارد', out: 'صرف', adjust: 'تسوية (+/-)' },
  mType: { breakdown: 'عطل', preventive: 'صيانة وقائية', inspection: 'فحص' },
  mStatus: { open: 'مفتوح', in_progress: 'جاري الإصلاح', waiting_parts: 'مستني قطع غيار', done: 'منتهي', cancelled: 'ملغي' },
  interval: { days: 'كل كام يوم', hours: 'كل كام ساعة تشغيل (للماكينة)', shots: 'كل كام ضربة (للإسطمبة)' },
  yesno: { yes: 'شغالة', no: 'موقوفة' },
  priority: { urgent: 'عاجل', high: 'عالي', normal: 'عادي', low: 'منخفض' },
  order: { open: 'مفتوح', in_progress: 'قيد التشغيل', done: 'منتهي', cancelled: 'ملغي' },
  shift: { morning: 'صباحي', evening: 'مسائي', night: 'ليلي' },
  productMove: { out: 'صرف / بيع', in: 'وارد / مرتجع', count: 'جرد (الرصيد الفعلي)' },
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
      { name: 'national_id', label: 'الرقم القومي' },
      { name: 'hire_date', label: 'تاريخ التعيين', type: 'date', list: true },
      { name: 'salary', label: 'المرتب', type: 'number', roles: ['admin', 'manager', 'hr'] },
      { name: 'daily_target', label: 'المستهدف اليومي (قطعة)', type: 'number', list: true },
      { name: 'annual_leave_balance', label: 'رصيد الإجازات السنوي (يوم)', type: 'number', module: 'leaves' },
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
    rowLinks: [{ label: 'BOM', href: (row) => `/bom/${row.id}` }],
    fields: [
      { name: 'code', label: 'رقم القطعة', list: true },
      { name: 'name', label: 'الاسم', required: true, list: true },
      { name: 'name_en', label: 'الوصف بالإنجليزي', list: true },
      { name: 'unit', label: 'الوحدة', list: true },
      { name: 'min_stock', label: 'أقل رصيد (تنبيه)', type: 'number', list: true, hint: 'لو الرصيد نزل تحته يطلع تنبيه. سيبه فاضي = الحد العام من الإعدادات' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea', list: true },
    ],
  },
  product_movements: {
    title: 'حركات مخزن المنتجات', single: 'حركة منتج', order: 'date DESC, id DESC', newDefaults: () => ({ date: today(), type: 'out' }),
    fields: [
      { name: 'date', label: 'التاريخ', type: 'date', required: true, list: true },
      { name: 'product_id', label: 'المنتج', type: 'ref', ref: 'products', required: true, list: true },
      { name: 'type', label: 'نوع الحركة', type: 'select', options: opt(STATUS.productMove), required: true, list: true },
      { name: 'qty', label: 'الكمية', type: 'number', required: true, list: true, hint: 'في الجرد: اكتب الرصيد الفعلي الموجود في المخزن' },
      { name: 'reference', label: 'رقم المستند / الإذن', list: true },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' },
    ],
    validate(row) {
      if (row.type === 'count' ? Number(row.qty) < 0 : Number(row.qty) <= 0) return 'الكمية لازم تكون أكبر من صفر';
    },
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
      { name: 'code', label: 'رقم القطعة', list: true },
      { name: 'name', label: 'الاسم', required: true, list: true },
      { name: 'name_en', label: 'الوصف بالإنجليزي' },
      { name: 'product_id', label: 'المنتج', type: 'ref', ref: 'products' },
      { name: 'producer', label: 'المصنّع', list: true, filter: true },
      { name: 'agent', label: 'الوكيل / المسؤول', filter: true },
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
  upcoming_molds: {
    title: 'الإسطمبات القادمة', single: 'إسطمبة قادمة', order: 'producer, code',
    fields: [
      { name: 'code', label: 'مرجع المورد', required: true, list: true },
      { name: 'name', label: 'الاسم', required: true, list: true },
      { name: 'name_en', label: 'الوصف بالإنجليزي' },
      { name: 'producer', label: 'المصنّع', list: true, filter: true },
      { name: 'agent', label: 'الوكيل / المسؤول', filter: true },
      { name: 'part_no', label: 'رقم القطعة عندنا', list: true },
      { name: 'oem_no', label: 'رقم OEM' },
      { name: 'status', label: 'الحالة', type: 'select', options: opt(STATUS.upcoming), list: true },
      { name: 't0_date', label: 'تاريخ التجربة (T0)', type: 'date', list: true },
      { name: 'expected_date', label: 'الوصول المتوقع', type: 'date', list: true },
      { name: 'cavities', label: 'عدد العيون', hint: 'زي 1 أو 1+1 أو R+L 2' },
      { name: 'material', label: 'خامة المنتج' },
      { name: 'steel', label: 'نوع الصلب' },
      { name: 'runner', label: 'نوع الرانر' },
      { name: 'order_date', label: 'تاريخ الطلب', type: 'date' },
      { name: 'price', label: 'السعر', type: 'number' },
      { name: 'currency', label: 'العملة' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' },
    ],
    // زرار في كل صف: لما الإسطمبة توصل المصنع
    rowActions: [{ action: 'receive', label: 'استلام', confirm: 'استلام الإسطمبة دي ونقلها لقائمة الإسطمبات؟' }],
  },
  maintenance_orders: {
    title: 'أوامر الصيانة', single: 'أمر صيانة', order: 'id DESC',
    newDefaults: (db) => ({ code: MT.nextCode(db), type: 'breakdown', status: 'open', priority: 'high', reported_at: MT.now() }),
    fields: [
      { name: 'code', label: 'رقم الأمر', required: true, list: true },
      { name: 'type', label: 'النوع', type: 'select', options: opt(STATUS.mType), required: true, list: true },
      { name: 'machine_id', label: 'الماكينة', type: 'ref', ref: 'machines', list: true },
      { name: 'mold_id', label: 'الإسطمبة', type: 'ref', ref: 'molds', list: true },
      { name: 'asset_id', label: 'الأصل', type: 'ref', ref: 'assets', list: true },
      { name: 'title', label: 'المشكلة / المطلوب', required: true, list: true },
      { name: 'priority', label: 'الأولوية', type: 'select', options: opt(STATUS.priority), list: true },
      { name: 'status', label: 'الحالة', type: 'select', options: opt(STATUS.mStatus), required: true, list: true },
      { name: 'assigned_to', label: 'الفني المسؤول', type: 'ref', ref: 'employees', list: true },
      { name: 'reported_at', label: 'وقت البلاغ', type: 'datetime-local', list: true },
      { name: 'started_at', label: 'بداية الإصلاح', type: 'datetime-local' },
      { name: 'finished_at', label: 'نهاية الإصلاح', type: 'datetime-local' },
      { name: 'downtime_minutes', label: 'دقائق توقف المعدة', type: 'number', list: true, hint: 'في الأعطال بتتحسب لوحدها من وقت البلاغ لحد نهاية الإصلاح لو سبتها فاضية' },
      { name: 'cause', label: 'سبب العطل', type: 'textarea' },
      { name: 'action_taken', label: 'اللي اتعمل', type: 'textarea' },
      { name: 'parts_used', label: 'قطع الغيار المستخدمة', type: 'textarea' },
      { name: 'cost', label: 'التكلفة', type: 'number', list: true },
      { name: 'plan_id', label: 'خطة الصيانة', type: 'ref', ref: 'maintenance_plans', refLabel: 'title' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' },
    ],
    validate(row) {
      const n = ['machine_id', 'mold_id', 'asset_id'].filter((k) => row[k]).length;
      if (n !== 1) return 'اختار المعدة: ماكينة أو إسطمبة أو أصل (واحدة بس)';
      if (row.finished_at && row.reported_at && row.finished_at < row.reported_at) return 'نهاية الإصلاح قبل وقت البلاغ';
    },
    beforeSave(row) {
      if (row.status === 'in_progress' && !row.started_at) row.started_at = MT.now();
      if (row.status === 'done' && !row.finished_at) row.finished_at = MT.now();
      if (row.status === 'done' && row.type === 'breakdown' && row.downtime_minutes === null && row.reported_at && row.finished_at)
        row.downtime_minutes = Math.max(0, Math.round((new Date(row.finished_at) - new Date(row.reported_at)) / 60000));
    },
    afterSave: (db, id) => MT.applyOrderEffects(db, id),
    rowActions: [
      { action: 'start', label: 'ابدأ', confirm: 'بدء الإصلاح دلوقتي؟', show: (r) => r.status === 'open' || r.status === 'waiting_parts' },
      { action: 'finish', label: 'خلّص', confirm: 'الإصلاح خلص؟ (هتقدر تكتب اللي اتعمل بعدها)', show: (r) => r.status !== 'done' && r.status !== 'cancelled' },
    ],
  },
  maintenance_plans: {
    title: 'خطط الصيانة الوقائية', single: 'خطة صيانة', order: 'title',
    newDefaults: () => ({ interval_type: 'days', active: 'yes', last_done: today() }),
    select: `t.*, ${MT.USED_SQL} AS used`,
    fields: [
      { name: 'title', label: 'الصيانة المطلوبة', required: true, list: true, hint: 'مثلاً: تغيير زيت الهيدروليك، تشحيم، تنضيف فلاتر' },
      { name: 'machine_id', label: 'الماكينة', type: 'ref', ref: 'machines', list: true },
      { name: 'mold_id', label: 'الإسطمبة', type: 'ref', ref: 'molds', list: true },
      { name: 'asset_id', label: 'الأصل', type: 'ref', ref: 'assets', list: true },
      { name: 'interval_type', label: 'كل إمتى', type: 'select', options: opt(STATUS.interval), required: true, list: true },
      { name: 'interval_value', label: 'العدد', type: 'number', required: true, list: true },
      { name: 'last_done', label: 'آخر مرة اتعملت', type: 'date', list: true },
      { name: 'assigned_to', label: 'الفني المسؤول', type: 'ref', ref: 'employees' },
      { name: 'active', label: 'الحالة', type: 'select', options: opt(STATUS.yesno), list: true },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' },
    ],
    computed: [
      { name: 'used', label: 'اتستهلك من آخر صيانة', fmt: 'int' },
      { name: 'pct', label: 'وصل لميعاده', fmt: 'pct', calc: (r) => (r.interval_value ? Math.min(100, (r.used * 100) / r.interval_value) : 0) },
    ],
    validate(row) {
      const n = ['machine_id', 'mold_id', 'asset_id'].filter((k) => row[k]).length;
      if (n !== 1) return 'اختار المعدة: ماكينة أو إسطمبة أو أصل (واحدة بس)';
      if (row.interval_type === 'hours' && !row.machine_id) return 'الصيانة بساعات التشغيل للماكينات بس';
      if (row.interval_type === 'shots' && !row.mold_id) return 'الصيانة بعدد الضربات للإسطمبات بس';
      if (!(row.interval_value > 0)) return 'العدد لازم يكون أكبر من صفر';
    },
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
        if (Number(row.qty) > r.s) return ['الكمية المطلوب صرفها أكبر من الرصيد المتاح ({0})', r.s];
      }
      if (row.type !== 'adjust' && Number(row.qty) <= 0) return 'الكمية لازم تكون أكبر من صفر';
    },
  },
  production_orders: {
    title: 'أوامر التشغيل', single: 'أمر تشغيل', order: 'id DESC',
    // رقم الأمر الجاي بيتملى لوحده (PO-101, PO-102, ...)
    newDefaults: (db) => {
      const last = db.prepare("SELECT code FROM production_orders WHERE code LIKE 'PO-%' ORDER BY id DESC LIMIT 1").get();
      const n = last ? (parseInt(last.code.slice(3), 10) || 100) + 1 : 101;
      return { code: `PO-${n}`, start_date: today(), status: 'open', priority: 'normal' };
    },
    rowLinks: [{ label: 'فتح', href: (row) => `/orders/${row.id}` }],
    select: `t.*, COALESCE((SELECT SUM(qty_produced) FROM production_logs l WHERE l.order_id=t.id),0) AS produced`,
    fields: [
      { name: 'code', label: 'رقم الأمر', required: true, list: true },
      { name: 'product_id', label: 'المنتج', type: 'ref', ref: 'products', required: true, list: true },
      { name: 'qty_planned', label: 'الكمية المطلوبة', type: 'number', required: true, list: true },
      { name: 'machine_id', label: 'الماكينة', type: 'ref', ref: 'machines', list: true },
      { name: 'mold_id', label: 'الإسطمبة', type: 'ref', ref: 'molds' },
      { name: 'priority', label: 'الأولوية', type: 'select', options: opt(STATUS.priority), list: true },
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
    // خصم الخامات من المخزن حسب الـ BOM (وإعادة الحساب لو التسجيل اتعدل، والإرجاع لو اتمسح)
    afterSave: (db, id) => {
      applyConsumption(db, id);
      // أول إنتاج على أمر مفتوح => الأمر بقى قيد التشغيل
      db.prepare("UPDATE production_orders SET status='in_progress' WHERE status='open' AND id=(SELECT order_id FROM production_logs WHERE id=?)").run(id);
    },
    beforeDelete: (db, id) => removeConsumption(db, id),
    beforeSave(row, db) {
      // لو اختار أمر تشغيل ومفيش منتج، ناخد منتج الأمر
      if (row.order_id && !row.product_id) {
        const o = db.prepare('SELECT product_id FROM production_orders WHERE id=?').get(row.order_id);
        if (o) row.product_id = o.product_id;
      }
      // ولو الأمر ليه إسطمبة ومفيش إسطمبة متختارة، ناخد إسطمبة الأمر
      if (row.order_id && !row.mold_id) {
        const o = db.prepare('SELECT mold_id FROM production_orders WHERE id=?').get(row.order_id);
        if (o && o.mold_id) row.mold_id = o.mold_id;
      }
      // ولو اختار إسطمبة، ناخد المنتج بتاعها (لازم قبل الحفظ علشان الخامات تتخصم صح)
      if (row.mold_id && !row.product_id) {
        const m = db.prepare('SELECT product_id FROM molds WHERE id=?').get(row.mold_id);
        if (m) row.product_id = m.product_id;
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
