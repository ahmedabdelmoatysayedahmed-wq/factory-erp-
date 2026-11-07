const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');
const SqliteStore = require('./session-store');
const { ROLES, PERMS, can } = require('./roles');
const { resources, STATUS, today } = require('./resources');
const { LANGS, translator } = require('./i18n');

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
  secret: process.env.SESSION_SECRET || 'change-this-secret',
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
  const machines = all(`SELECT m.*, COALESCE(SUM(l.qty_produced),0) produced, COALESCE(SUM(l.hours_worked),0) hours
    FROM machines m LEFT JOIN production_logs l ON l.machine_id=m.id AND l.date=? GROUP BY m.id ORDER BY m.code`, d);
  const lowStock = all(`SELECT * FROM (SELECT t.*, COALESCE((SELECT SUM(CASE WHEN type='out' THEN -qty ELSE qty END)
    FROM stock_movements m WHERE m.material_id=t.id),0) stock FROM materials t) WHERE stock <= min_stock ORDER BY name`);
  const orders = all(`SELECT o.*, p.name product, COALESCE((SELECT SUM(qty_produced) FROM production_logs l WHERE l.order_id=o.id),0) produced
    FROM production_orders o LEFT JOIN products p ON p.id=o.product_id WHERE o.status IN ('open','in_progress') ORDER BY o.due_date`);
  const moldAlerts = all(`SELECT * FROM (SELECT t.*, COALESCE((SELECT CAST(SUM(qty_produced+qty_scrap) AS REAL)/MAX(t.cavities,1)
    FROM production_logs l WHERE l.mold_id=t.id AND (t.last_maintenance IS NULL OR l.date > t.last_maintenance)),0) since
    FROM molds t WHERE t.maintenance_every > 0) WHERE since >= maintenance_every * 0.9 OR status IN ('maintenance','damaged')`);
  res.render('dashboard', { d, offDay, stats, machines, lowStock, orders, moldAlerts, STATUS });
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
  res.render('reports', { from, to, byEmployee, byMachine, daily, workDays });
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
const { seedDemo, clearData, hasOnlyOldFakeEmployees, hasOnlyOldFakeMolds, hasAllDemoMoldsInFactory } = require('./demo');
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
// مرة واحدة: الإسطمبات التجريبية تتنقل لـ «الإسطمبات القادمة» (ماعدا 3 شغالين في الديمو)
if (db.getSetting('upcoming_v1') !== '1') {
  if (hasAllDemoMoldsInFactory(db)) { seedDemo(db, { keepEmployees: true }); console.log('Demo molds moved to Upcoming Molds'); }
  db.setSetting('upcoming_v1', '1');
}
app.post('/settings/demo', need('users', 'edit'), (req, res) => {
  const n = seedDemo(db, { keepEmployees: true, resetEmployees: !!req.body.reset_employees });
  flash(req, 'ok', ['تمت إضافة بيانات تجريبية (إنتاج وحضور آخر أسبوعين) على {0} موظف', n]);
  res.redirect('/');
});
app.post('/settings/clear', need('users', 'edit'), (req, res) => {
  if (req.body.confirm !== 'مسح' && req.body.confirm !== 'DELETE') { flash(req, 'err', 'لازم تكتب كلمة التأكيد علشان المسح يتم'); return res.redirect('/settings'); }
  clearData(db, { keepEmployees: !!req.body.keep_employees });
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
      if (id) db.prepare(`UPDATE ${req.rk} SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id=?`).run(...cols.map((c) => row[c]), id);
      else {
        const all = ['stock_movements', 'production_logs'].includes(req.rk) ? [...cols, 'user_id'] : cols;
        const vals = cols.map((c) => row[c]); if (all.length > cols.length) vals.push(req.session.user.id);
        db.prepare(`INSERT INTO ${req.rk} (${all.join(',')}) VALUES (${all.map(() => '?').join(',')})`).run(...vals);
      }
      flash(req, 'ok', 'تم الحفظ بنجاح');
      return res.redirect(req.body.again ? `/r/${req.rk}/new` : `/r/${req.rk}`);
    } catch (e) {
      error = e.message.includes('UNIQUE') ? 'الكود ده مستخدم قبل كده' : ['خطأ في الحفظ: {0}', e.message];
    }
  }
  showForm(req, res, { ...row, id }, error);
});
// استلام إسطمبة قادمة: بتتنقل لقائمة الإسطمبات (ومعاها منتج بنفس رقم القطعة)
app.post('/r/upcoming_molds/:id/receive', need('molds', 'edit'), (req, res) => {
  const u = db.prepare('SELECT * FROM upcoming_molds WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).render('error', { msg: 'السجل غير موجود' });
  db.transaction(() => {
    const p = db.prepare('SELECT id FROM products WHERE code=?').get(u.code);
    const productId = p ? p.id : Number(db.prepare("INSERT INTO products (code, name, name_en, unit) VALUES (?,?,?,'قطعة')").run(u.code, u.name, u.name_en).lastInsertRowid);
    const m = db.prepare('SELECT id FROM molds WHERE code=?').get(u.code);
    const notes = [u.notes, u.price ? `السعر: ${u.price} ${u.currency || ''}`.trim() : null].filter(Boolean).join(' - ') || null;
    if (m) db.prepare('UPDATE molds SET name=?, name_en=?, producer=?, agent=?, product_id=? WHERE id=?').run(u.name, u.name_en, u.producer, u.agent, productId, m.id);
    else db.prepare("INSERT INTO molds (code, name, name_en, producer, agent, product_id, cavities, status, notes) VALUES (?,?,?,?,?,?,?,'available',?)")
      .run(u.code, u.name, u.name_en, u.producer, u.agent, productId, u.cavities || 1, notes);
    db.prepare('DELETE FROM upcoming_molds WHERE id=?').run(u.id);
  })();
  flash(req, 'ok', ['تم استلام الإسطمبة «{0}» ونقلها لقائمة الإسطمبات', u.name]);
  res.redirect('/r/upcoming_molds');
});

app.post('/r/:res/:id/delete', getRes, needRes('edit'), (req, res) => {
  try {
    db.prepare(`DELETE FROM ${req.rk} WHERE id=?`).run(req.params.id);
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
