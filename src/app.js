const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');
const SqliteStore = require('./session-store');
const { ROLES, PERMS, can } = require('./roles');
const { resources, STATUS, today } = require('./resources');
const { LANGS, translator } = require('./i18n');
const { productStock, getAlerts, clearAlertsCache, periodOf, shiftPeriod } = require('./stock');
const { bomOf, requirements, applyConsumption } = require('./bom');
const PB = require('./prebom');
const fs = require('fs');

const app = express();
const prod = process.env.NODE_ENV === 'production';
if (prod && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required in production');
app.set('trust proxy', 1); // خلف سيرفر الاستضافة (HTTPS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(session({
  store: new SqliteStore(db),
  secret: process.env.SESSION_SECRET || db.config.sessionSecret || 'change-this-secret',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: prod, maxAge: 12 * 3600 * 1000 },
}));

// متغيرات متاحة لكل الشاشات
app.use((req, res, next) => {
  const m = /(?:^|;\s*)lang=(\w+)/.exec(req.headers.cookie || '');
  const lang = m && LANGS.includes(m[1]) ? m[1] : 'ar';
  res.locals.lang = lang;
  res.locals.dir = lang === 'ar' ? 'rtl' : 'ltr';
  res.locals.t = translator(lang);
  const settings = db.getSettings();
  req.settings = res.locals.settings = settings;
  res.locals.user = req.session.user || null;
  res.locals.can = (s, a) => allowed(req, s, a);
  // الحقول التابعة لقسم مقفول (زي رصيد الإجازات) مابتظهرش
  // والحقول المقصورة على أدوار معينة (زي المرتب) مابتظهرش لغيرهم
  req.fieldOn = res.locals.fieldOn = (f) =>
    (f.module !== 'leaves' || settings.leavesEnabled) && (!f.roles || (!!req.session.user && f.roles.includes(req.session.user.role)));
  res.locals.ROLES = ROLES;
  res.locals.PERMS = PERMS;
  res.locals.PB = PB;
  res.locals.resources = resources;
  res.locals.path = req.path;
  res.locals.flash = req.session.flash; delete req.session.flash;
  next();
});
const flash = (req, type, msg) => { req.session.flash = { type, msg }; };

app.get('/healthz', (req, res) => res.send('ok'));

// ---------- تغيير اللغة ----------
app.get('/lang/:l', (req, res) => {
  if (LANGS.includes(req.params.l)) res.cookie('lang', req.params.l, { maxAge: 365 * 864e5, sameSite: 'lax' });
  const back = req.get('referer');
  res.redirect(back && new URL(back).host === req.get('host') ? back : '/');
});

// ---------- الدخول ----------
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(req.body.username || '');
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password_hash))
    return res.status(401).render('login', { error: 'اسم المستخدم أو كلمة المرور غلط' });
  req.session.regenerate(() => {
    req.session.user = { id: u.id, username: u.username, full_name: u.full_name, role: u.role };
    res.redirect('/');
  });
});
app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

app.use((req, res, next) => (req.session.user ? next() : res.redirect('/login')));
// الصلاحية + إن القسم نفسه مفعّل (قسم الإجازات ممكن يتقفل من الإعدادات)
const allowed = (req, section, action) =>
  (section !== 'leaves' || req.settings.leavesEnabled) && can(req.session.user, section, action);
// أي تعديل بيمسح كاش التنبيهات، وكل صفحة بتعرض عدد التنبيهات في الجرس
app.use((req, res, next) => {
  if (req.method === 'POST') clearAlertsCache();
  res.locals.alertsCount = req.session.user && can(req.session.user, 'alerts') ? getAlerts(db).count : 0;
  next();
});

const need = (section, action = 'view') => (req, res, next) =>
  allowed(req, section, action) ? next() : res.status(403).render('error', { msg: 'ليس لديك صلاحية لهذه الصفحة' });

// ---------- لوحة التحكم ----------
app.get('/', (req, res) => {
  const d = req.query.date || today();
  const offDay = db.isOffDay(d, req.settings);
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const stats = {
    employees: one(`SELECT COUNT(*) c FROM employees WHERE status='active'`).c,
    present: one(`SELECT COUNT(*) c FROM attendance WHERE date=? AND status IN ('present','late')`, d).c,
    absent: one(`SELECT COUNT(*) c FROM attendance WHERE date=? AND status='absent'`, d).c,
    onLeave: one(`SELECT COUNT(*) c FROM leaves WHERE status='approved' AND ? BETWEEN from_date AND to_date`, d).c,
    produced: one(`SELECT COALESCE(SUM(qty_produced),0) s FROM production_logs WHERE date=?`, d).s,
    scrap: one(`SELECT COALESCE(SUM(qty_scrap),0) s FROM production_logs WHERE date=?`, d).s,
    downtime: one(`SELECT COALESCE(SUM(downtime_minutes),0) s FROM production_logs WHERE date=?`, d).s,
    pendingLeaves: one(`SELECT COUNT(*) c FROM leaves WHERE status='pending'`).c,
    upcomingMolds: one(`SELECT COUNT(*) c FROM upcoming_molds`).c,
  };
  const products = all(`SELECT p.code, p.name, SUM(l.qty_produced) produced, SUM(l.qty_scrap) scrap
    FROM production_logs l JOIN products p ON p.id = l.product_id WHERE l.date=? GROUP BY p.id ORDER BY produced DESC`, d);
  const machines = all(`SELECT m.*, COALESCE(SUM(l.qty_produced),0) produced, COALESCE(SUM(l.hours_worked),0) hours
    FROM machines m LEFT JOIN production_logs l ON l.machine_id=m.id AND l.date=? GROUP BY m.id ORDER BY m.code`, d);
  const lowStock = all(`SELECT * FROM (SELECT t.*, COALESCE((SELECT SUM(CASE WHEN type='out' THEN -qty ELSE qty END)
    FROM stock_movements m WHERE m.material_id=t.id),0) stock FROM materials t) WHERE stock <= min_stock ORDER BY name`);
  const orders = all(`SELECT o.*, p.name product, COALESCE((SELECT SUM(qty_produced) FROM production_logs l WHERE l.order_id=o.id),0) produced
    FROM production_orders o LEFT JOIN products p ON p.id=o.product_id WHERE o.status IN ('open','in_progress') ORDER BY o.due_date`);
  const moldAlerts = all(`SELECT * FROM (SELECT t.*, COALESCE((SELECT CAST(SUM(qty_produced+qty_scrap) AS REAL)/MAX(t.cavities,1)
    FROM production_logs l WHERE l.mold_id=t.id AND (t.last_maintenance IS NULL OR l.date > t.last_maintenance)),0) since
    FROM molds t WHERE t.maintenance_every > 0) WHERE since >= maintenance_every * 0.9 OR status IN ('maintenance','damaged')`);
  res.render('dashboard', { d, offDay, products, lowProducts: getAlerts(db).products, stats, machines, lowStock, orders, moldAlerts, STATUS });
});

// ---------- الحضور والانصراف (شاشة يومية مجمعة) ----------
app.get('/attendance', need('attendance'), (req, res) => {
  const d = req.query.date || today();
  const rows = db.prepare(`SELECT e.id, e.code, e.name, e.job_title, a.check_in, a.check_out, a.status, a.notes,
      ${req.settings.leavesEnabled ? `(SELECT type FROM leaves lv WHERE lv.employee_id=e.id AND lv.status='approved' AND ? BETWEEN lv.from_date AND lv.to_date LIMIT 1)` : 'NULL AND ?'} leave_type
    FROM employees e LEFT JOIN attendance a ON a.employee_id=e.id AND a.date=?
    WHERE e.status='active' ORDER BY e.name`).all(d, d);
  res.render('attendance', { d, rows, STATUS, offDay: db.isOffDay(d, req.settings) });
});
app.post('/attendance', need('attendance', 'edit'), (req, res) => {
  const d = req.body.date || today();
  const ids = [].concat(req.body.emp || []);
  const up = db.prepare(`INSERT INTO attendance (employee_id,date,check_in,check_out,status,notes) VALUES (?,?,?,?,?,?)
    ON CONFLICT(employee_id,date) DO UPDATE SET check_in=excluded.check_in, check_out=excluded.check_out,
    status=excluded.status, notes=excluded.notes`);
  const del = db.prepare('DELETE FROM attendance WHERE employee_id=? AND date=?');
  db.transaction(() => {
    for (const id of ids) {
      const g = (k) => req.body[`${k}_${id}`] || null;
      if (!g('status')) { del.run(id, d); continue; }
      up.run(id, d, g('in'), g('out'), g('status'), g('notes'));
    }
  })();
  flash(req, 'ok', 'تم حفظ الحضور');
  res.redirect('/attendance?date=' + d);
});

// ---------- تقارير الإنتاجية ----------
app.get('/reports', need('reports'), (req, res) => {
  const from = req.query.from || today().slice(0, 8) + '01';
  const to = req.query.to || today();
  const byEmployee = db.prepare(`SELECT e.id, e.code, e.name, e.daily_target,
      COUNT(DISTINCT l.date) days, COALESCE(SUM(l.qty_produced),0) produced, COALESCE(SUM(l.qty_scrap),0) scrap,
      COALESCE(SUM(l.hours_worked),0) hours,
      (SELECT COUNT(*) FROM attendance a WHERE a.employee_id=e.id AND a.date BETWEEN ? AND ? AND a.status IN ('present','late')) att_days,
      (SELECT COUNT(*) FROM attendance a WHERE a.employee_id=e.id AND a.date BETWEEN ? AND ? AND a.status='absent') abs_days,
      (SELECT COUNT(*) FROM attendance a WHERE a.employee_id=e.id AND a.date BETWEEN ? AND ? AND a.status='late') late_days
    FROM employees e LEFT JOIN production_logs l ON l.employee_id=e.id AND l.date BETWEEN ? AND ?
    GROUP BY e.id ORDER BY produced DESC`).all(from, to, from, to, from, to, from, to);
  const byMachine = db.prepare(`SELECT m.id, m.code, m.name, m.hourly_capacity,
      COALESCE(SUM(l.qty_produced),0) produced, COALESCE(SUM(l.qty_scrap),0) scrap,
      COALESCE(SUM(l.hours_worked),0) hours, COALESCE(SUM(l.downtime_minutes),0) downtime
    FROM machines m LEFT JOIN production_logs l ON l.machine_id=m.id AND l.date BETWEEN ? AND ?
    GROUP BY m.id ORDER BY m.code`).all(from, to);
  const daily = db.prepare(`SELECT date, SUM(qty_produced) produced, SUM(qty_scrap) scrap
    FROM production_logs WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date`).all(from, to);
  // أيام العمل في الفترة (من غير أيام الراحة الأسبوعية، ولحد النهارده بس)
  let workDays = 0;
  const end = to < today() ? to : today();
  for (let x = new Date(from + 'T00:00:00Z'); x.toISOString().slice(0, 10) <= end; x.setUTCDate(x.getUTCDate() + 1))
    if (!db.isOffDay(x.toISOString().slice(0, 10), req.settings)) workDays++;
  // إنتاج كل منتج (قطعة) في الفترة - مع بحث باسم/رقم القطعة
  const pq = (req.query.product || '').trim();
  const byProduct = db.prepare(`SELECT p.id, p.code, p.name, p.unit,
      SUM(l.qty_produced) produced, SUM(l.qty_scrap) scrap, COUNT(DISTINCT l.date) days,
      GROUP_CONCAT(DISTINCT m.code) machines
    FROM production_logs l JOIN products p ON p.id = l.product_id LEFT JOIN machines m ON m.id = l.machine_id
    WHERE l.date BETWEEN ? AND ? AND (? = '' OR p.name LIKE ? OR p.code LIKE ? OR p.name_en LIKE ?)
    GROUP BY p.id ORDER BY produced DESC`).all(from, to, pq, `%${pq}%`, `%${pq}%`, `%${pq}%`);
  res.render('reports', { from, to, byEmployee, byMachine, daily, workDays, byProduct, pq });
});

// ---------- المستخدمين ----------
app.get('/users', need('users'), (req, res) =>
  res.render('users', { users: db.prepare('SELECT * FROM users ORDER BY id').all(), edit: null }));
app.get('/users/:id/edit', need('users', 'edit'), (req, res) =>
  res.render('users', { users: db.prepare('SELECT * FROM users ORDER BY id').all(),
    edit: db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id) }));
app.post('/users', need('users', 'edit'), (req, res) => {
  const { id, username, full_name, role, password } = req.body;
  const active = req.body.active ? 1 : 0;
  if (!ROLES[role]) { flash(req, 'err', 'دور غير صحيح'); return res.redirect('/users'); }
  try {
    if (id) {
      if (Number(id) === req.session.user.id && (!active || role !== 'admin')) throw new Error('لا يمكنك إيقاف حسابك أو تغيير دورك');
      db.prepare('UPDATE users SET username=?, full_name=?, role=?, active=? WHERE id=?').run(username, full_name, role, active, id);
      if (password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), id);
    } else {
      if (!password || password.length < 6) throw new Error('كلمة المرور لازم تكون 6 حروف على الأقل');
      db.prepare('INSERT INTO users (username,password_hash,full_name,role,active) VALUES (?,?,?,?,?)')
        .run(username, bcrypt.hashSync(password, 10), full_name, role, active);
    }
    flash(req, 'ok', 'تم الحفظ');
  } catch (e) {
    flash(req, 'err', e.message.includes('UNIQUE') ? 'اسم المستخدم موجود بالفعل' : e.message);
  }
  res.redirect('/users');
});

// ---------- الإعدادات (مدير النظام) ----------
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
app.get('/settings', need('users', 'edit'), (req, res) =>
  res.render('settings', { DAYS, noEmployees: !db.prepare('SELECT 1 FROM employees LIMIT 1').get() }));
app.post('/settings', need('users', 'edit'), (req, res) => {
  const off = [].concat(req.body.weekly_off || []).map(Number).filter((n) => n >= 0 && n <= 6);
  db.setSetting('weekly_off', off.join(','));
  db.setSetting('leaves_enabled', req.body.leaves_enabled ? '1' : '0');
  if (req.body.product_min_stock !== undefined && Number(req.body.product_min_stock) >= 0) db.setSetting('product_min_stock', Number(req.body.product_min_stock));
  flash(req, 'ok', 'تم الحفظ');
  res.redirect('/settings');
});

app.get('/password', (req, res) => res.render('password', { error: null }));
app.post('/password', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.user.id);
  if (!bcrypt.compareSync(req.body.old || '', u.password_hash)) return res.render('password', { error: 'كلمة المرور الحالية غلط' });
  if ((req.body.new || '').length < 6) return res.render('password', { error: 'كلمة المرور الجديدة لازم 6 حروف على الأقل' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(req.body.new, 10), u.id);
  flash(req, 'ok', 'تم تغيير كلمة المرور');
  res.redirect('/');
});

// ---------- شاشات عامة لكل الأقسام (إضافة / تعديل / حذف / بحث) ----------
// ---------- مخزن المنتجات ----------
app.get('/stock', need('product_stock'), (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  const only = req.query.only || '';
  const { start, end } = periodOf('month', today());
  const prodMonth = Object.fromEntries(db.prepare('SELECT product_id, SUM(qty_produced) s FROM production_logs WHERE date BETWEEN ? AND ? GROUP BY product_id')
    .all(start, end).map((r) => [r.product_id, r.s]));
  let rows = productStock(db).map((p) => ({ ...p, month: prodMonth[p.id] || 0 }));
  const counts = { all: rows.length, low: rows.filter((p) => p.low).length, untracked: rows.filter((p) => !p.tracked).length };
  if (q) rows = rows.filter((p) => `${p.code} ${p.name}`.toLowerCase().includes(q));
  if (only === 'low') rows = rows.filter((p) => p.low);
  else if (only !== 'all') rows = rows.filter((p) => p.tracked); // الافتراضي: المنتجات المتابَعة بس
  rows.sort((a, b) => (b.low - a.low) || (a.stock / (a.min || 1)) - (b.stock / (b.min || 1)));
  res.render('stock', { rows, counts, q: req.query.q || '', only, def: db.getSetting('product_min_stock') });
});

// ---------- خطة الإنتاج (شهري / أسبوعي) ----------
const planPeriod = (req) => {
  const type = req.query.type === 'week' || req.body?.type === 'week' ? 'week' : 'month';
  return { type, ...periodOf(type, (req.query.date || req.body?.date || today()).slice(0, 10)) };
};
app.get('/plan', need('production_plans'), (req, res) => {
  const per = planPeriod(req);
  const stock = Object.fromEntries(productStock(db).map((p) => [p.id, p]));
  const lines = db.prepare(`SELECT pl.*, p.code, p.name, p.unit,
      COALESCE((SELECT SUM(qty_produced) FROM production_logs l WHERE l.product_id=pl.product_id AND l.date BETWEEN ? AND ?),0) produced
    FROM production_plans pl JOIN products p ON p.id=pl.product_id WHERE pl.period_type=? AND pl.period_start=? ORDER BY p.name`)
    .all(per.start, per.end, per.type, per.start).map((l) => ({ ...l, st: stock[l.product_id] }));
  // منتجات تحت الحد ومش في الخطة => اقتراح كمية تكمّل الرصيد لضعف الحد الأدنى
  const inPlan = new Set(lines.map((l) => l.product_id));
  const suggest = Object.values(stock).filter((p) => p.low && !inPlan.has(p.id))
    .map((p) => ({ ...p, qty: Math.ceil((p.min * 2 - p.stock) / 50) * 50 }));
  const products = db.prepare("SELECT id, COALESCE(code || ' - ', '') || name label FROM products ORDER BY name").all();
  const reqs = requirements(db, lines.map((l) => ({ product_id: l.product_id, qty: Math.max(0, l.qty_planned - l.produced) })));
  reqs.noBom = reqs.noBom.map((id) => lines.find((l) => l.product_id === id)).filter(Boolean);
  res.render('plan', { per, lines, suggest, products, reqs, prev: shiftPeriod(per.type, per.start, -1), next: shiftPeriod(per.type, per.start, 1) });
});
app.post('/plan', need('production_plans', 'edit'), (req, res) => {
  const per = planPeriod(req);
  const back = `/plan?type=${per.type}&date=${per.start}`;
  const ids = [].concat(req.body.product_id || []), qtys = [].concat(req.body.qty || []);
  let n = 0;
  db.transaction(() => {
    ids.forEach((pid, i) => {
      const q = Number(qtys[i]);
      if (!pid || !(q > 0)) return;
      db.prepare(`INSERT INTO production_plans (period_type, period_start, product_id, qty_planned, notes) VALUES (?,?,?,?,?)
        ON CONFLICT(period_type, period_start, product_id) DO UPDATE SET qty_planned=excluded.qty_planned, notes=COALESCE(excluded.notes, notes)`)
        .run(per.type, per.start, Number(pid), q, req.body.notes || null);
      n++;
    });
  })();
  flash(req, n ? 'ok' : 'err', n ? 'تم الحفظ' : 'اختار المنتج واكتب كمية أكبر من صفر');
  res.redirect(back);
});
app.post('/plan/copy', need('production_plans', 'edit'), (req, res) => {
  const per = planPeriod(req);
  const prev = shiftPeriod(per.type, per.start, -1);
  const n = db.prepare(`INSERT OR IGNORE INTO production_plans (period_type, period_start, product_id, qty_planned, notes)
    SELECT period_type, ?, product_id, qty_planned, notes FROM production_plans WHERE period_type=? AND period_start=?`).run(per.start, per.type, prev.start).changes;
  flash(req, 'ok', ['تم نسخ {0} منتج من الفترة اللي فاتت', n]);
  res.redirect(`/plan?type=${per.type}&date=${per.start}`);
});
app.post('/plan/:id/delete', need('production_plans', 'edit'), (req, res) => {
  const l = db.prepare('SELECT * FROM production_plans WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM production_plans WHERE id=?').run(req.params.id);
  res.redirect(l ? `/plan?type=${l.period_type}&date=${l.period_start}` : '/plan');
});

// ---------- BOM (مكونات المنتج) ----------
app.get('/bom', need('bom'), (req, res) => {
  const q = (req.query.q || '').trim();
  const only = req.query.only || '';
  let rows = db.prepare(`SELECT p.id, p.code, p.name, (SELECT COUNT(*) FROM bom_lines b WHERE b.product_id=p.id) n,
    EXISTS (SELECT 1 FROM pre_bom c WHERE c.product_id=p.id) card FROM products p
    WHERE (? = '' OR p.name LIKE ? OR p.code LIKE ?) ORDER BY p.name`).all(q, `%${q}%`, `%${q}%`);
  const counts = { all: rows.length, with: rows.filter((p) => p.n).length };
  if (only === 'with') rows = rows.filter((p) => p.n); else if (only === 'without') rows = rows.filter((p) => !p.n);
  rows = rows.map((p) => ({ ...p, cost: p.n ? bomOf(db, p.id).cost : null }));
  res.render('bom-list', { rows, q, only, counts });
});
app.get('/bom/:id', need('bom'), (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).render('error', { msg: 'السجل غير موجود' });
  const materials = db.prepare("SELECT id, COALESCE(code || ' - ', '') || name label, unit FROM materials ORDER BY name").all();
  const others = db.prepare(`SELECT p.id, COALESCE(p.code || ' - ', '') || p.name label FROM products p
    WHERE p.id<>? AND EXISTS (SELECT 1 FROM bom_lines b WHERE b.product_id=p.id) ORDER BY p.name`).all(p.id);
  const used = db.prepare('SELECT COALESCE(SUM(qty_produced + qty_scrap),0) s FROM production_logs WHERE product_id=?').get(p.id).s;
  res.render('bom', { p, ...bomOf(db, p.id), materials, others, used, card: getCard(p) });
});
app.post('/bom/:id', need('bom', 'edit'), (req, res) => {
  const pid = Number(req.params.id);
  const qty = Number(req.body.qty), scrap = req.body.scrap_pct === '' || req.body.scrap_pct === undefined ? 0 : Number(req.body.scrap_pct);
  if (!req.body.material_id || !(qty > 0) || !(scrap >= 0)) flash(req, 'err', 'اختار الخامة واكتب كمية أكبر من صفر');
  else {
    db.prepare(`INSERT INTO bom_lines (product_id, material_id, qty, scrap_pct, notes) VALUES (?,?,?,?,?)
      ON CONFLICT(product_id, material_id) DO UPDATE SET qty=excluded.qty, scrap_pct=excluded.scrap_pct, notes=COALESCE(excluded.notes, notes)`)
      .run(pid, Number(req.body.material_id), qty, scrap, req.body.notes || null);
    flash(req, 'ok', 'تم الحفظ');
  }
  res.redirect(`/bom/${pid}`);
});
app.post('/bom/:id/copy', need('bom', 'edit'), (req, res) => {
  const n = db.prepare(`INSERT INTO bom_lines (product_id, material_id, qty, scrap_pct, notes)
    SELECT ?, material_id, qty, scrap_pct, notes FROM bom_lines WHERE product_id=? AND true
    ON CONFLICT(product_id, material_id) DO UPDATE SET qty=excluded.qty, scrap_pct=excluded.scrap_pct`).run(Number(req.params.id), Number(req.body.from)).changes;
  if (req.body.card) {
    const src = db.prepare('SELECT data FROM pre_bom WHERE product_id=?').get(Number(req.body.from));
    if (src) { const d = JSON.parse(src.data); d.photos = []; saveCard(req, Number(req.params.id), d); }
  }
  flash(req, 'ok', ['تم نسخ {0} خامة', n]);
  res.redirect(`/bom/${req.params.id}`);
});
app.post('/bom/:id/line/:line/delete', need('bom', 'edit'), (req, res) => {
  db.prepare('DELETE FROM bom_lines WHERE id=? AND product_id=?').run(req.params.line, req.params.id);
  res.redirect(`/bom/${req.params.id}`);
});
// ---------- كارت Pre-BOM ----------
const uploadsDir = () => { const d = require('path').join(db.dataDir, 'uploads'); fs.mkdirSync(d, { recursive: true }); return d; };
function getCard(p) {
  const r = db.prepare('SELECT data FROM pre_bom WHERE product_id=?').get(p.id);
  const d = PB.normalize(r ? JSON.parse(r.data) : null);
  if (!r) { d.fpi_no = p.code || ''; d.product_name = p.name_en || p.name; }
  return d;
}
function saveCard(req, pid, d) {
  db.prepare(`INSERT INTO pre_bom (product_id, data, updated_at, updated_by) VALUES (?,?,datetime('now'),?)
    ON CONFLICT(product_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
    .run(pid, JSON.stringify(d), req.session.user.id);
}
// الخامات اللي في الـ BOM من الكارت: بتمسح سطور الكارت القديمة وتحط الجديدة
function generateFromCard(pid, d) {
  const lines = PB.bomFromCard(d);
  db.transaction(() => {
    db.prepare('DELETE FROM bom_lines WHERE product_id=?').run(pid);
    for (const l of lines) db.prepare('INSERT INTO bom_lines (product_id, material_id, qty, scrap_pct, notes) VALUES (?,?,?,?,?)').run(pid, l.material_id, l.qty, l.scrap_pct, 'من كارت Pre-BOM');
  })();
  return lines.length;
}
const clip = (v) => (v === undefined || v === null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, 300));
app.post('/bom/:id/card', need('bom', 'edit'), (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).render('error', { msg: 'السجل غير موجود' });
  const b = req.body, d = getCard(p), f = b.f || {};
  const keys = [...PB.HEAD_A, ...PB.HEAD_C].map((x) => x[0]).concat(['inj_price', 'revision', 'runner_g', 'scrap_pct', 'main_material_id', 'mb_material_id',
    'box_material_id', 'partition_material_id', 'partition_qty', 'bag_material_id', 'bag_qty']);
  for (const k of keys) if (k in f) d[k] = clip(f[k]);
  const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
  arr(b.items).forEach((it, i) => { if (d.items[i]) for (const k of ['desc', 'mat', 'cavity', 'mold_size', 'wip']) if (k in it) d.items[i][k] = clip(it[k]); });
  const comps = b.components || {};
  for (const i of Object.keys(comps)) { const c = comps[i], dc = d.components[Number(i)]; if (dc) for (const k of ['code', 'qty_text', 'material_id', 'qty']) if (k in c) dc[k] = clip(c[k]); }
  for (const v of PB.VARIANTS) if (b.variants && b.variants[v]) for (const k of ['desc', 'fg', 'oem']) d.variants[v][k] = clip(b.variants[v][k]);
  arr(b.notes).forEach((x, i) => { if (i < PB.NOTES) d.notes[i] = clip(x); });
  if (b.approvals) for (const k of ['eng', 'qa', 'pro', 'md']) d.approvals[k] = clip(b.approvals[k]);
  saveCard(req, p.id, d);
  if (b.generate) flash(req, 'ok', ['تم حفظ الكارت وحساب {0} خامة للـ BOM', generateFromCard(p.id, d)]);
  else flash(req, 'ok', 'تم الحفظ');
  res.redirect(`/bom/${p.id}`);
});
app.post('/bom/:id/card/import', need('bom', 'edit'), express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ ok: false });
  try {
    const imp = await PB.parseSheet(req.body);
    const d = getCard(p);
    // البيانات من الشيت، والحاجات الخاصة بالبرنامج (اختيار الخامات والصور) بتفضل زي ما هي
    const keepComp = d.components.map((c) => ({ material_id: c.material_id, qty: c.qty }));
    Object.assign(d, imp, { photos: d.photos, approvals: d.approvals });
    d.components = imp.components.map((c, i) => ({ ...c, ...keepComp[i] }));
    saveCard(req, p.id, d);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false }); }
});
app.post('/bom/:id/card/photo', need('bom', 'edit'), express.raw({ type: 'image/*', limit: '10mb' }), (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[req.get('content-type')];
  if (!p || !ext || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ ok: false });
  const file = `prebom-${p.id}-${Date.now()}.${ext}`;
  fs.writeFileSync(require('path').join(uploadsDir(), file), req.body);
  const d = getCard(p); d.photos.push({ file, label: clip(req.query.label).slice(0, 20) }); saveCard(req, p.id, d);
  res.json({ ok: true });
});
app.post('/bom/:id/card/photo/:i/delete', need('bom', 'edit'), (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ ok: false });
  const d = getCard(p); const [ph] = d.photos.splice(Number(req.params.i), 1);
  if (ph) { try { fs.unlinkSync(require('path').join(uploadsDir(), ph.file)); } catch {} saveCard(req, p.id, d); }
  res.json({ ok: true });
});
app.get('/bom/:id/photo/:file', need('bom'), (req, res) => {
  const name = require('path').basename(req.params.file);
  if (!name.startsWith(`prebom-${Number(req.params.id)}-`)) return res.status(404).end();
  res.sendFile(require('path').join(uploadsDir(), name), (e) => e && res.status(404).end());
});

// إعادة حساب استهلاك الخامات لإنتاج متسجل قبل ما الـ BOM يتعمل
app.post('/bom/:id/recalc', need('bom', 'edit'), (req, res) => {
  const ids = db.prepare('SELECT id FROM production_logs WHERE product_id=? AND date >= ?').all(req.params.id, req.body.from || '0000-00-00');
  db.transaction(() => ids.forEach((r) => applyConsumption(db, r.id)))();
  flash(req, 'ok', ['تم حساب استهلاك الخامات لـ {0} تسجيل إنتاج', ids.length]);
  res.redirect(`/bom/${req.params.id}`);
});

// ---------- التنبيهات ----------
app.get('/alerts', need('alerts'), (req, res) => res.render('alerts', { a: getAlerts(db, { fresh: true }) }));
app.get('/api/alerts', need('alerts'), (req, res) => {
  const a = getAlerts(db);
  res.json({ count: a.count, products: a.products.slice(0, 5).map((p) => p.name) });
});

// مسح قائمة الإسطمبات القادمة كلها (لازم قبل الراوت العام /r/:res/:id)
app.post('/r/upcoming_molds/clear', need('upcoming_molds', 'edit'), (req, res) => {
  const n = db.prepare('DELETE FROM upcoming_molds').run().changes;
  flash(req, 'ok', ['تم مسح {0} إسطمبة من القائمة', n]);
  res.redirect('/r/upcoming_molds');
});

// ---------- استيراد من Excel (الموظفين / الإسطمبات) ----------
const { importers } = require('./importers');
const getImporter = (req, res, next) => {
  req.imp = importers[req.params.res];
  return req.imp ? need(req.params.res, 'edit')(req, res, next) : res.status(404).render('error', { msg: 'الصفحة غير موجودة' });
};
app.get('/r/:res/import', getImporter, (req, res) => res.render('import', { imp: req.imp, rk: req.params.res }));
app.post('/r/:res/import', getImporter, express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  const tr = res.locals.t;
  try {
    if (!req.body || !req.body.length) throw new Error('اختار ملف Excel الأول');
    const list = await req.imp.parse(req.body);
    if (!list.length) throw new Error('الملف مافيهوش بيانات');
    if (req.query.preview) return res.json({ ok: true, rows: list });
    res.json({ ok: true, ...req.imp.importRows(db, list) });
  } catch (e) {
    const msg = e.tr ? e.tr : /zip|spreadsheet|xlsx|end of data|signature/i.test(e.message) ? 'الملف ده مش ملف Excel (.xlsx)' : e.message;
    res.status(400).json({ ok: false, error: tr(msg) });
  }
});

// ---------- بيانات تجريبية / بداية جديدة (مدير النظام) ----------
const { seedDemo, clearData, hasOnlyOldFakeEmployees, hasOnlyOldFakeMolds, needsUpcomingFix } = require('./demo');
// مرة واحدة: لو قاعدة البيانات فيها الموظفين الوهميين القدام بس، نعيد البيانات التجريبية بموظفين المصنع
if (db.getSetting('roster_v1') !== '1') {
  if (hasOnlyOldFakeEmployees(db)) { seedDemo(db, { resetEmployees: true }); console.log('Demo data updated with the factory employees list'); }
  db.setSetting('roster_v1', '1');
}
// مرة واحدة: لو الإسطمبات هي الوهمية القديمة بس، نعيد البيانات التجريبية بإسطمبات المصنع (والموظفين زي ما هما)
if (db.getSetting('molds_v1') !== '1') {
  if (hasOnlyOldFakeMolds(db)) { seedDemo(db, { keepEmployees: true }); console.log('Demo data updated with the factory molds list'); }
  db.setSetting('molds_v1', '1');
}
// مرة واحدة: تصحيح البيانات التجريبية - إسطمبات المصنع (101) في «الإسطمبات»،
// والإسطمبات اللي بتتصنع في الصين (شيتات الموردين) في «الإسطمبات القادمة»
if (db.getSetting('upcoming_v2') !== '1') {
  if (needsUpcomingFix(db)) { seedDemo(db, { keepEmployees: true }); console.log('Demo data fixed: factory molds in Molds, molds in China in Upcoming Molds'); }
  db.setSetting('upcoming_v1', '1'); db.setSetting('upcoming_v2', '1');
}
// مرة واحدة: شيل الإسطمبات القادمة اللي كانت متحطة كبيانات تجريبية (القائمة بتتملى بالاستيراد)
if (db.getSetting('upcoming_v3') !== '1') {
  const n = db.prepare("DELETE FROM upcoming_molds WHERE code LIKE 'CYNTIA-%' OR code LIKE 'JESSE-%' OR code LIKE 'SHIDA-23-%'").run().changes;
  if (n) console.log(`Removed ${n} demo upcoming molds (Upcoming Molds is now empty for your import)`);
  db.setSetting('upcoming_v3', '1');
}
app.post('/settings/demo', need('users', 'edit'), (req, res) => {
  const n = seedDemo(db, { keepEmployees: true, resetEmployees: !!req.body.reset_employees });
  flash(req, 'ok', ['تمت إضافة بيانات تجريبية (إنتاج وحضور آخر أسبوعين) على {0} موظف', n]);
  res.redirect('/');
});
app.post('/settings/clear', need('users', 'edit'), (req, res) => {
  if (req.body.confirm !== 'مسح' && req.body.confirm !== 'DELETE') { flash(req, 'err', 'لازم تكتب كلمة التأكيد علشان المسح يتم'); return res.redirect('/settings'); }
  clearData(db, { keepEmployees: !!req.body.keep_employees, keepMolds: !!req.body.keep_molds });
  flash(req, 'ok', 'تم مسح البيانات');
  res.redirect('/settings');
});

const refOptions = (f) => {
  const label = f.refLabel || 'name';
  return db.prepare(`SELECT id, ${label === 'name' ? "COALESCE(code || ' - ','') || name" : label} AS label FROM ${f.ref} ORDER BY label`).all();
};
const getRes = (req, res, next) => {
  const r = resources[req.params.res];
  if (!r) return res.status(404).render('error', { msg: 'الصفحة غير موجودة' });
  req.r = r; req.rk = req.params.res; next();
};
const needRes = (action) => (req, res, next) => need(req.rk, action)(req, res, next);

app.get('/r/:res', getRes, needRes('view'), (req, res) => {
  const r = req.r, q = (req.query.q || '').trim();
  const where = [], params = [];
  if (q) {
    const text = r.fields.filter((f) => !f.type || f.type === 'text' || f.type === 'textarea');
    where.push('(' + text.map((f) => `t.${f.name} LIKE ?`).join(' OR ') + ')');
    text.forEach(() => params.push(`%${q}%`));
  }
  const dateField = r.fields.find((f) => f.type === 'date' && f.required);
  if (dateField && req.query.from) { where.push(`t.${dateField.name} >= ?`); params.push(req.query.from); }
  if (dateField && req.query.to) { where.push(`t.${dateField.name} <= ?`); params.push(req.query.to); }
  for (const f of r.fields.filter((f) => f.type === 'ref' || f.type === 'select' || f.filter)) {
    if (req.query[f.name]) { where.push(`t.${f.name} = ?`); params.push(req.query[f.name]); }
  }
  const rows = db.prepare(`SELECT ${r.select || 't.*'} FROM ${req.rk} t ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${r.order.split(',').map((s) => 't.' + s.trim()).join(', ')} LIMIT 1000`).all(...params);
  for (const row of rows) for (const c of r.computed || []) if (c.calc) row[c.name] = c.calc(row);
  const refs = {};
  for (const f of r.fields.filter((f) => f.type === 'ref')) refs[f.name] = Object.fromEntries(refOptions(f).map((o) => [o.id, o.label]));
  const filters = r.fields.filter((f) => f.type === 'ref' || f.type === 'select' || f.filter).map((f) => ({
    ...f, choices: f.type === 'ref' ? refOptions(f).map((o) => ({ value: o.id, label: o.label }))
      : f.filter ? db.prepare(`SELECT DISTINCT ${f.name} v FROM ${req.rk} WHERE ${f.name} IS NOT NULL ORDER BY v`).all().map((x) => ({ value: x.v, label: x.v }))
      : f.options }));
  res.render('list', { r, rk: req.rk, rows, refs, q, query: req.query, dateField, filters });
});

const showForm = (req, res, row, error) => {
  const refs = {};
  for (const f of req.r.fields.filter((f) => f.type === 'ref')) refs[f.name] = refOptions(f);
  res.render('form', { r: req.r, rk: req.rk, row, refs, error });
};
app.get('/r/:res/new', getRes, needRes('edit'), (req, res) => showForm(req, res, req.r.newDefaults ? req.r.newDefaults() : {}));
app.get('/r/:res/:id/edit', getRes, needRes('edit'), (req, res) => {
  const row = db.prepare(`SELECT * FROM ${req.rk} WHERE id=?`).get(req.params.id);
  if (!row) return res.status(404).render('error', { msg: 'السجل غير موجود' });
  showForm(req, res, row);
});
app.post(['/r/:res', '/r/:res/:id'], getRes, needRes('edit'), (req, res) => {
  const r = req.r, id = req.params.id ? Number(req.params.id) : null;
  const row = {};
  for (const f of r.fields.filter(req.fieldOn)) { // الحقول المخفية مابتتغيرش
    let v = req.body[f.name];
    v = v === undefined || v === '' ? null : String(v).trim();
    if (v !== null && (f.type === 'number' || f.type === 'ref')) v = Number(v);
    row[f.name] = v;
  }
  const missing = r.fields.filter(req.fieldOn).find((f) => f.required && (row[f.name] === null || Number.isNaN(row[f.name])));
  let error = missing ? ['حقل "{0}" مطلوب', missing.label] : r.validate && r.validate(row, db, id);
  if (!error) {
    r.beforeSave && r.beforeSave(row, db);
    const cols = Object.keys(row);
    try {
      db.transaction(() => {
        let rowId = id;
        if (id) db.prepare(`UPDATE ${req.rk} SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id=?`).run(...cols.map((c) => row[c]), id);
        else {
          const all = ['stock_movements', 'production_logs', 'product_movements'].includes(req.rk) ? [...cols, 'user_id'] : cols;
          const vals = cols.map((c) => row[c]); if (all.length > cols.length) vals.push(req.session.user.id);
          rowId = Number(db.prepare(`INSERT INTO ${req.rk} (${all.join(',')}) VALUES (${all.map(() => '?').join(',')})`).run(...vals).lastInsertRowid);
        }
        r.afterSave && r.afterSave(db, rowId);
      })();
      flash(req, 'ok', 'تم الحفظ بنجاح');
      return res.redirect(req.body.again ? `/r/${req.rk}/new` : `/r/${req.rk}`);
    } catch (e) {
      error = e.message.includes('UNIQUE') ? 'الكود ده مستخدم قبل كده' : ['خطأ في الحفظ: {0}', e.message];
    }
  }
  showForm(req, res, { ...row, id }, error);
});
// استلام إسطمبة قادمة: بتتنقل لقائمة الإسطمبات (ومعاها منتج بنفس الرقم)
// كود الإسطمبة = رقم القطعة عندنا لو معروف، وإلا مرجع المورد
app.post('/r/upcoming_molds/:id/receive', need('molds', 'edit'), (req, res) => {
  const u = db.prepare('SELECT * FROM upcoming_molds WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).render('error', { msg: 'السجل غير موجود' });
  const code = u.part_no && !/[\/,]/.test(u.part_no) && !db.prepare('SELECT 1 FROM molds WHERE code=?').get(u.part_no) ? u.part_no : u.code;
  const cav = String(u.cavities || '').match(/\d+/g);
  const cavities = cav ? cav.map(Number).reduce((a, b) => a + b, 0) : 1; // 1+1 => 2
  const notes = [u.notes, u.code !== code ? `مرجع المورد: ${u.code}` : null, u.part_no && u.part_no !== code ? `رقم القطعة: ${u.part_no}` : null,
    u.oem_no ? `OEM: ${u.oem_no}` : null, u.material ? `الخامة: ${u.material}` : null, u.steel ? `الصلب: ${u.steel}` : null,
    u.cavities ? `العيون: ${u.cavities}` : null, u.price ? `السعر: ${u.price} ${u.currency || ''}`.trim() : null].filter(Boolean).join(' - ') || null;
  db.transaction(() => {
    const p = db.prepare('SELECT id FROM products WHERE code=?').get(code);
    const productId = p ? p.id : Number(db.prepare("INSERT INTO products (code, name, name_en, unit) VALUES (?,?,?,'قطعة')").run(code, u.name, u.name_en).lastInsertRowid);
    const m = db.prepare('SELECT id FROM molds WHERE code=?').get(code);
    if (m) db.prepare('UPDATE molds SET name=?, name_en=?, producer=?, agent=?, product_id=?, notes=? WHERE id=?').run(u.name, u.name_en, u.producer, u.agent, productId, notes, m.id);
    else db.prepare("INSERT INTO molds (code, name, name_en, producer, agent, product_id, cavities, status, notes) VALUES (?,?,?,?,?,?,?,'available',?)")
      .run(code, u.name, u.name_en, u.producer, u.agent, productId, cavities, notes);
    db.prepare('DELETE FROM upcoming_molds WHERE id=?').run(u.id);
  })();
  flash(req, 'ok', ['تم استلام الإسطمبة «{0}» ونقلها لقائمة الإسطمبات', u.name]);
  res.redirect('/r/upcoming_molds');
});

app.post('/r/:res/:id/delete', getRes, needRes('edit'), (req, res) => {
  try {
    db.transaction(() => {
      req.r.beforeDelete && req.r.beforeDelete(db, Number(req.params.id));
      db.prepare(`DELETE FROM ${req.rk} WHERE id=?`).run(req.params.id);
    })();
    flash(req, 'ok', 'تم الحذف');
  } catch (e) {
    flash(req, 'err', e.message.includes('FOREIGN KEY') ? 'لا يمكن الحذف لأن السجل مرتبط ببيانات أخرى' : e.message);
  }
  res.redirect(`/r/${req.rk}`);
});

app.use((req, res) => res.status(404).render('error', { msg: 'الصفحة غير موجودة' }));

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Factory ERP running on http://localhost:${port}`);
    // عناوين الشبكة المحلية علشان الموبايلات تفتح البرنامج على نفس الواي فاي
    const ips = Object.values(require('os').networkInterfaces()).flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    for (const ip of ips) console.log(`From phones on the same Wi-Fi: http://${ip}:${port}`);
  });
}
module.exports = app;
