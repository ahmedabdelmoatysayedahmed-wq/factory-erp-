const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-'));
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.NO_BACKUP = '1';
process.env.MAIL_TEST = '1'; // الإيميلات بتتكتب في الذاكرة بدل ما تتبعت
const app = require('../src/app');
let server, base;

function client() {
  const jar = {};
  const fn = async (method, url, form, raw) => {
    const res = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; '), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(raw ? { 'content-type': 'application/octet-stream' } : {}) },
      body: raw || (form ? new URLSearchParams(form).toString() : undefined),
    });
    for (const c of res.headers.getSetCookie()) { const [k, v] = c.split(';')[0].split('='); jar[k] = v; }
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  };
  fn.cookie = () => Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
  fn.base = async () => base;
  return fn;
}

before(() => new Promise((r) => { server = app.listen(0, () => { base = 'http://127.0.0.1:' + server.address().port; r(); }); }));
after(() => server.close());

test('full workflow', async () => {
  const req = client();
  assert.equal((await req('GET', '/')).location, '/login');
  assert.equal((await req('POST', '/login', { username: 'admin', password: 'wrong' })).status, 401);
  assert.equal((await req('POST', '/login', { username: 'admin', password: 'admin123' })).location, '/');

  await req('POST', '/r/employees', { code: 'E1', name: 'أحمد', daily_target: '500', status: 'active' });
  await req('POST', '/r/machines', { code: 'M1', name: 'مكبس 1', hourly_capacity: '100', status: 'running' });
  await req('POST', '/r/products', { code: 'P1', name: 'غطاء' });
  await req('POST', '/r/molds', { code: 'S1', name: 'إسطمبة غطاء', product_id: '1', cavities: '4', status: 'in_use', maintenance_every: '100' });
  await req('POST', '/r/materials', { code: 'R1', name: 'بلاستيك', unit: 'كجم', min_stock: '50' });
  await req('POST', '/r/stock_movements', { date: '2026-11-01', material_id: '1', type: 'in', qty: '100' });
  const over = await req('POST', '/r/stock_movements', { date: '2026-11-01', material_id: '1', type: 'out', qty: '500' });
  assert.match(over.text, /أكبر من الرصيد/);
  await req('POST', '/r/stock_movements', { date: '2026-11-01', material_id: '1', type: 'out', qty: '60' });
  await req('POST', '/r/production_orders', { code: 'PO-1', product_id: '1', qty_planned: '1000', status: 'open' });
  const r = await req('POST', '/r/production_logs', { date: '2026-11-01', employee_id: '1', machine_id: '1', mold_id: '1',
    order_id: '1', qty_produced: '400', qty_scrap: '20', hours_worked: '8', downtime_minutes: '30' });
  assert.equal(r.location, '/r/production_logs');
  await req('POST', '/attendance', { date: '2026-11-01', emp: '1', status_1: 'present', in_1: '08:00', out_1: '16:00' });
  // الجمعة راحة أسبوعية تلقائياً، وقسم الإجازات مقفول افتراضياً
  const fri = await req('GET', '/attendance?date=2026-11-06');
  assert.match(fri.text, /راحة أسبوعية/);
  assert.match(fri.text, /value="off" selected/);
  assert.doesNotMatch((await req('GET', '/attendance?date=2026-11-05')).text, /value="off" selected/);
  assert.equal((await req('GET', '/r/leaves')).status, 403);
  assert.doesNotMatch((await req('GET', '/r/employees/new')).text, /رصيد الإجازات/);
  assert.doesNotMatch((await req('GET', '/')).text, /href="\/r\/leaves"/);
  const rep0 = await req('GET', '/reports?from=2026-11-01&to=2026-11-07');
  assert.match(rep0.text, /أيام العمل في الفترة: 6/); // 7 أيام ناقص الجمعة
  await req('POST', '/settings', { weekly_off: ['5'], leaves_enabled: '1' });
  assert.equal((await req('GET', '/r/leaves')).status, 200);
  assert.match((await req('GET', '/r/employees/new')).text, /رصيد الإجازات/);

  await req('POST', '/r/leaves', { employee_id: '1', type: 'annual', from_date: '2026-11-03', to_date: '2026-11-05', status: 'approved' });

  const mats = await req('GET', '/r/materials');
  assert.match(mats.text, /class="warn"[^>]*>40/); // 100-60 = 40 تحت حد الطلب
  assert.match((await req('GET', '/r/molds')).text, />105</); // 420/4 ضربة
  assert.match((await req('GET', '/r/production_orders')).text, /40%/);
  assert.match((await req('GET', '/r/leaves')).text, />3</);
  const rep = await req('GET', '/reports?from=2026-11-01&to=2026-11-30');
  assert.match(rep.text, /إنتاج المنتجات/);
  assert.match(rep.text, /<td>غطاء<\/td><td><b>400<\/b>/); // إنتاج المنتج في الفترة
  assert.doesNotMatch((await req('GET', '/reports?from=2026-11-01&to=2026-11-30&product=' + encodeURIComponent('مش موجود'))).text, /<td>غطاء<\/td>/);
  assert.match((await req('GET', '/?date=2026-11-01')).text, /إنتاج اليوم حسب المنتج[\s\S]*غطاء/);
  assert.match(rep.text, /80%/); // 400/500 مستهدف الموظف - و 400/(100*8)=50% للماكينة
  assert.match(rep.text, /50%/);
  const dash = await req('GET', '/?date=2026-11-01');
  assert.match(dash.text, /بلاستيك/); assert.match(dash.text, /إسطمبة غطاء/);
  for (const p of ['/r/employees', '/r/assets', '/attendance?date=2026-11-01', '/users', '/r/employees/new', '/r/molds/1/edit'])
    assert.equal((await req('GET', p)).status, 200, p);

  // اللغة الإنجليزية
  const en = client();
  await en('GET', '/lang/en');
  const login = await en('GET', '/login');
  assert.match(login.text, /dir="ltr"/); assert.match(login.text, /Sign in/);
  await en('POST', '/login', { username: 'admin', password: 'admin123' });
  for (const p of ['/', '/reports', '/attendance', '/users', '/r/molds', '/r/production_logs/new', '/r/stock_movements']) {
    const html = (await en('GET', p)).text;
    // مفيش نص عربي غير البيانات المدخلة وزرار "عربي"
    const ar = html.replace(/أحمد|غطاء|إسطمبة غطاء|بلاستيك|كجم|مدير النظام|مكبس|أمين|عربي/g, '').match(/[\u0600-\u06FF]+/g);
    assert.equal(ar, null, p + ': ' + (ar || []).join(' '));
  }
  const bad = await en('POST', '/r/stock_movements', { date: '2026-11-01', material_id: '1', type: 'out', qty: '999' });
  assert.match(bad.text, /exceeds available stock \(40\)/);

  // استيراد الموظفين من Excel
  const xlsx = fs.readFileSync(path.join(__dirname, 'fixtures', 'employees-sample.xlsx'));
  const imp = async (q = '') => JSON.parse((await req('POST', '/r/employees/import' + q, null, xlsx)).text);
  const pv = await imp('?preview=1');
  assert.equal(pv.rows.length, 3);
  assert.equal(pv.rows[0].name, 'موظف تجريبي أول'); // المسافات الزيادة اتشالت
  assert.equal(pv.rows[0].phone, '01000000001'); // الصفر اللي على الشمال رجع
  assert.equal(pv.rows[0].national_id, '29001010100011');
  assert.equal(pv.rows[0].hire_date, '2025-03-16');
  assert.equal(pv.rows[1].status, 'inactive');
  assert.deepEqual(await imp(), { ok: true, added: 3, updated: 0 });
  assert.deepEqual(await imp(), { ok: true, added: 0, updated: 3 }); // مش بيتكرر
  const notXlsx = JSON.parse((await req('POST', '/r/employees/import', null, Buffer.from('not excel'))).text);
  assert.equal(notXlsx.ok, false);
  const emps = (await req('GET', '/r/employees?q=' + encodeURIComponent('تجريبي'))).text;
  assert.match(emps, /01000000001/);

  // بيانات تجريبية على الموظفين الحاليين، ومسح البيانات
  await req('POST', '/settings/demo', {});
  assert.match((await req('GET', '/r/employees')).text, /موظف تجريبي أول/);
  assert.match((await req('GET', '/r/production_logs')).text, /مكبس حقن 1/);
  await req('POST', '/settings/clear', { confirm: 'غلط', keep_employees: '1' });
  assert.match((await req('GET', '/r/production_logs')).text, /مكبس حقن 1/); // ماتمسحش
  const moldsBefore = /<small>\((\d+)\)/.exec((await req('GET', '/r/molds')).text)[1];
  await req('POST', '/settings/clear', { confirm: 'مسح', keep_employees: '1', keep_molds: '1' });
  assert.doesNotMatch((await req('GET', '/r/production_logs')).text, /مكبس حقن 1/);
  assert.match((await req('GET', '/r/employees')).text, /موظف تجريبي أول/);
  assert.match((await req('GET', '/r/molds')).text, new RegExp(`<small>\\(${moldsBefore}\\)`)); // الإسطمبات فضلت
  assert.match((await req('GET', '/r/machines')).text, /<small>\(0\)/); // الماكينات التجريبية اتشالت

  // استيراد الإسطمبات من Excel: كل إسطمبة بيتعملها منتج بنفس رقم القطعة
  const mx = fs.readFileSync(path.join(__dirname, 'fixtures', 'molds-sample.xlsx'));
  const mimp = async (q = '') => JSON.parse((await req('POST', '/r/molds/import' + q, null, mx)).text);
  const mpv = await mimp('?preview=1');
  assert.equal(mpv.rows.length, 2);
  assert.equal(mpv.rows[1].code, 'TEST002 RA'); // المسافات الزيادة اتشالت
  assert.equal(mpv.rows[0].name_en, 'F.BUMPER BRACKET TEST 2020 RA');
  assert.deepEqual(await mimp(), { ok: true, added: 2, updated: 0 });
  assert.deepEqual(await mimp(), { ok: true, added: 0, updated: 2 });
  assert.match((await req('GET', '/r/molds')).text, /مثبت اكصدام تجريبي/);
  assert.match((await req('GET', '/r/products')).text, /TEST001 RA/);
  assert.equal((await req('GET', '/r/machines/import')).status, 404); // الاستيراد للموظفين والإسطمبات بس

  // قائمة موظفين المصنع في البيانات التجريبية
  await req('POST', '/settings/demo', { reset_employees: '1' });
  const roster = (await req('GET', '/r/employees')).text;
  assert.match(roster, /يوسف احمد عبدالمعطى/);
  assert.doesNotMatch(roster, /موظف تجريبي أول/);
  assert.match((await req('GET', '/r/production_logs')).text, /عبد النبى ابو حسيبه/);
  // الديمو: إسطمبات المصنع (101) في الإسطمبات، واللي بتتصنع في الصين (83) في القادمة
  assert.match((await req('GET', '/r/molds')).text, /\(101\)/);
  assert.match((await req('GET', '/r/molds')).text, /ANMBBS027 RA/);
  assert.match((await req('GET', '/r/molds?producer=SHIDA')).text, /\(23\)/); // فلتر المصنّع في الإسطمبات
  assert.match((await req('GET', '/r/upcoming_molds')).text, /\(0\)/); // القادمة فاضية لحد الاستيراد
  assert.doesNotMatch((await req('GET', '/?date=2026-11-07')).text, /إسطمبات قادمة/); // مفيش قادمة => مفيش مربع

  // استلام إسطمبة قادمة => بتتنقل للإسطمبات ومعاها منتج
  // رقم القطعة مزدوج (L/R) => كود الإسطمبة بيبقى مرجع المورد، والعيون R+L 2 => 2
  await req('POST', '/r/upcoming_molds', { code: 'CY-TEST-01', name: 'حامل اكصدام تجريبي', producer: 'CYNTIA', part_no: 'AAA1LA/AAA1RA', cavities: 'R+L 2', status: 'manufacturing' });
  const up = (await req('GET', '/r/upcoming_molds')).text;
  assert.match(up, /\(1\)/);
  assert.match((await req('GET', '/?date=2026-11-07')).text, /إسطمبات قادمة/);
  assert.match(up, /مسح القائمة كلها/);
  const cy = /action="\/r\/upcoming_molds\/(\d+)\/receive"/.exec(up)[1];
  const recv = await req('POST', `/r/upcoming_molds/${cy}/receive`, {});
  assert.equal(recv.location, '/r/upcoming_molds');
  assert.match((await req('GET', '/r/upcoming_molds')).text, /\(0\)/);
  const molds2 = (await req('GET', '/r/molds?q=CY-TEST-01')).text;
  assert.match(molds2, /\(1\)/);
  assert.match(molds2, /data-label="عدد العيون">2</);

  // استيراد القادمة: العمود اللي من غير عنوان جنب المصنّع = الوكيل، واللي اتستلم مايتضافش تاني
  const ux = fs.readFileSync(path.join(__dirname, 'fixtures', 'upcoming-sample.xlsx'));
  const upv = JSON.parse((await req('POST', '/r/upcoming_molds/import?preview=1', null, ux)).text);
  assert.equal(upv.rows[0].agent, 'وكيل تجريبي');
  assert.equal(upv.rows[0].producer, 'TEST MAKER');
  const ures = JSON.parse((await req('POST', '/r/upcoming_molds/import', null, ux)).text);
  assert.deepEqual(ures, { ok: true, added: 1, updated: 0, skipped: 1 }); // ANMBBS027 RA موجودة في الإسطمبات
  // تسجيل إنتاج بالإسطمبة بس => المنتج بيتملى لوحده
  await req('POST', '/r/production_logs', { date: '2025-01-15', employee_id: '1', machine_id: '1', mold_id: '1', qty_produced: '10' });
  assert.match((await req('GET', '/r/production_logs?mold_id=1&from=2025-01-15&to=2025-01-15')).text, /data-label="المنتج">(?!—)[^<]+</);

  // صلاحيات: أمين مخزن مايقدرش يدخل الإنتاج أو الموظفين
  await req('POST', '/users', { username: 'store', full_name: 'أمين', role: 'storekeeper', password: 'store123', active: '1' });
  const s = client();
  await s('POST', '/login', { username: 'store', password: 'store123' });
  assert.equal((await s('GET', '/r/materials')).status, 200);
  assert.equal((await s('GET', '/r/production_logs')).status, 403);
  assert.equal((await s('GET', '/users')).status, 403);
  assert.equal((await s('POST', '/r/employees', { name: 'x' })).status, 403);
  assert.equal((await s('GET', '/r/molds/new')).status, 403); // يشوف الإسطمبات بس مايعدلش

  // المشرف بيشوف الموظفين بس من غير المرتب
  await req('POST', '/users', { username: 'sup', full_name: 'مشرف', role: 'supervisor', password: 'sup123', active: '1' });
  const sv = client();
  await sv('POST', '/login', { username: 'sup', password: 'sup123' });
  assert.equal((await sv('GET', '/r/employees')).status, 200);
  assert.doesNotMatch((await sv('GET', '/r/employees')).text, /المرتب/);
  assert.match((await req('GET', '/r/employees/new')).text, /المرتب/);
});

test('clear upcoming molds button empties the list', async () => {
  const req = client();
  await req('POST', '/login', { username: 'admin', password: 'admin123' });
  await req('POST', '/r/upcoming_molds/clear', {}); // نبدأ من قائمة فاضية
  for (const c of ['CL-1', 'CL-2']) await req('POST', '/r/upcoming_molds', { code: c, name: c, status: 'manufacturing' });
  assert.match((await req('GET', '/r/upcoming_molds')).text, /\(2\)/);
  await req('POST', '/r/upcoming_molds/clear', {});
  const after = (await req('GET', '/r/upcoming_molds')).text;
  assert.match(after, /\(0\)/);
  assert.doesNotMatch(after, /مسح القائمة كلها/);
});

test('finished goods stock, alerts under minimum, production plan', async () => {
  const req = client();
  await req('POST', '/login', { username: 'admin', password: 'admin123' });
  await req('POST', '/settings', { weekly_off: ['5'], product_min_stock: '100' });
  await req('POST', '/r/products', { code: 'PS-1', name: 'منتج مخزن تجريبي' });
  await req('POST', '/r/employees', { code: 'ST1', name: 'عامل مخزن', status: 'active' });
  await req('POST', '/r/machines', { code: 'MS1', name: 'ماكينة مخزن', status: 'running' });
  const pid = /<option value="(\d+)"\s*>PS-1 - /.exec((await req('GET', '/r/product_movements/new')).text)[1];
  const eid = /<option value="(\d+)"\s*>ST1 - /.exec((await req('GET', '/r/production_logs/new')).text)[1];
  const mid = /<option value="(\d+)"\s*>MS1 - /.exec((await req('GET', '/r/production_logs/new')).text)[1];
  const stockRow = async () => /PS-1<\/td><td[^>]*>[^<]*<\/td>\s*<td[^>]*class="([^"]*)"[^>]*><b>([^<]+)<\/b>/.exec((await req('GET', '/stock?q=PS-1')).text);

  // منتج من غير رصيد = مش متابَع ومالوش تنبيه
  assert.doesNotMatch((await req('GET', '/alerts')).text, /منتج مخزن تجريبي/);
  // جرد 120 ثم صرف 50 => 70 تحت الحد (100) => تنبيه
  await req('POST', '/r/product_movements', { date: '2026-10-01', product_id: pid, type: 'count', qty: '120' });
  assert.equal((await stockRow())[2], '120');
  await req('POST', '/r/product_movements', { date: '2026-10-02', product_id: pid, type: 'out', qty: '50' });
  const low = await stockRow();
  assert.equal(low[2], '70'); assert.equal(low[1], 'warn');
  assert.match((await req('GET', '/alerts')).text, /منتج مخزن تجريبي/);
  assert.match((await req('GET', '/r/products')).text, /class="bell on"/); // الجرس عليه رقم
  assert.ok(JSON.parse((await req('GET', '/api/alerts')).text).products.includes('منتج مخزن تجريبي'));
  // الإنتاج بيزوّد الرصيد: 70 + 200 = 270 => مفيش تنبيه
  await req('POST', '/r/production_logs', { date: '2026-10-03', employee_id: eid, machine_id: mid, product_id: pid, qty_produced: '200' });
  assert.equal((await stockRow())[2], '270');
  assert.doesNotMatch((await req('GET', '/alerts')).text, /منتج مخزن تجريبي/);
  // حد خاص بالمنتج (300) => تنبيه تاني
  await req('POST', `/r/products/${pid}`, { code: 'PS-1', name: 'منتج مخزن تجريبي', min_stock: '300' });
  assert.match((await req('GET', '/alerts')).text, /منتج مخزن تجريبي/);

  // خطة شهر أكتوبر: 1000 => اتنتج 200 = 20%
  await req('POST', '/plan', { type: 'month', date: '2026-10-10', product_id: pid, qty: '1000' });
  const plan = (await req('GET', '/plan?type=month&date=2026-10-25')).text;
  assert.match(plan, /منتج مخزن تجريبي/);
  assert.match(plan, /<em>20%<\/em>/);
  // المنتج تحت الحد ومش في خطة نوفمبر => مقترح
  assert.match((await req('GET', '/plan?type=month&date=2026-11-05')).text, /تحت الحد ومش في الخطة[\s\S]*منتج مخزن تجريبي/);
  // نسخ خطة أكتوبر لنوفمبر
  await req('POST', '/plan/copy', { type: 'month', date: '2026-11-05' });
  assert.match((await req('GET', '/plan?type=month&date=2026-11-05')).text, /value="1000"/);
  // الأسبوع بيبدأ السبت
  assert.match((await req('GET', '/plan?type=week&date=2026-11-16')).text, /2026-11-14 ← 2026-11-20/);

  // استيراد رصيد من شيت المخزن => جرد 35، ورقم مش موجود بيتعدّى
  const sx = fs.readFileSync(path.join(__dirname, 'fixtures', 'stock-sample.xlsx'));
  const r = JSON.parse((await req('POST', '/r/product_movements/import', null, sx)).text);
  assert.deepEqual(r, { ok: true, added: 1, updated: 0, skipped: 1 });
  assert.equal((await stockRow())[2], '35');

  // أمين المخزن يشوف المخزن ويسجل حركة، بس مايعدّلش الخطة
  const s = client();
  await s('POST', '/login', { username: 'store', password: 'store123' });
  assert.equal((await s('GET', '/stock')).status, 200);
  assert.equal((await s('GET', '/r/product_movements/new')).status, 200);
  assert.equal((await s('POST', '/plan', { type: 'week', product_id: pid, qty: '5' })).status, 403);
});

test('BOM: material cost, automatic consumption on production, plan requirements', async () => {
  const db = require('../src/db');
  const { materialStock } = require('../src/bom');
  const req = client();
  await req('POST', '/login', { username: 'admin', password: 'admin123' });
  await req('POST', '/r/materials', { code: 'M-B1', name: 'خامة BOM تجريبية', unit: 'كجم', min_stock: '10', unit_cost: '50' });
  const mid = db.prepare("SELECT id FROM materials WHERE code='M-B1'").get().id;
  await req('POST', '/r/stock_movements', { date: '2026-09-01', material_id: mid, type: 'in', qty: '100' });
  for (const c of ['PB-1', 'PB-2', 'PB-3']) await req('POST', '/r/products', { code: c, name: 'منتج BOM ' + c });
  const pid = (c) => db.prepare('SELECT id FROM products WHERE code=?').get(c).id;
  const emp = db.prepare('SELECT id FROM employees LIMIT 1').get().id, mach = db.prepare('SELECT id FROM machines LIMIT 1').get().id;
  const stock = () => Math.round(materialStock(db)[mid] * 1000) / 1000;

  // BOM: 0.5 كجم للقطعة + 10% فاقد => 0.55 كجم => التكلفة 27.5
  await req('POST', `/bom/${pid('PB-1')}`, { material_id: mid, qty: '0.5', scrap_pct: '10' });
  const page = (await req('GET', `/bom/${pid('PB-1')}`)).text;
  assert.match(page, /خامة BOM تجريبية/);
  assert.match(page, /<b>27.5<\/b><span>/);
  assert.match((await req('GET', '/bom?only=with&q=PB-1')).text, /منتج BOM PB-1/);

  // تسجيل إنتاج 100 قطعة => 55 كجم بتتخصم لوحدها
  await req('POST', '/r/production_logs', { date: '2026-09-02', employee_id: emp, machine_id: mach, product_id: pid('PB-1'), qty_produced: '90', qty_scrap: '10' });
  assert.equal(stock(), 45);
  const logId = db.prepare('SELECT id FROM production_logs WHERE product_id=?').get(pid('PB-1')).id;
  assert.match((await req('GET', '/r/stock_movements?material_id=' + mid)).text, new RegExp(`استهلاك إنتاج #${logId}`));
  // تعديل التسجيل لـ 200 => الخصم بيتحسب من جديد (110)
  await req('POST', `/r/production_logs/${logId}`, { date: '2026-09-02', employee_id: emp, machine_id: mach, product_id: pid('PB-1'), qty_produced: '200', qty_scrap: '0' });
  assert.equal(stock(), -10);
  // مسح التسجيل => الخامة بترجع
  await req('POST', `/r/production_logs/${logId}/delete`, {});
  assert.equal(stock(), 100);

  // الخطة: 300 قطعة => محتاج 165 كجم والموجود 100 => عجز 65
  await req('POST', '/plan', { type: 'month', date: '2026-09-10', product_id: pid('PB-1'), qty: '300' });
  const plan = (await req('GET', '/plan?type=month&date=2026-09-10')).text;
  assert.match(plan, /الخامات المطلوبة[\s\S]*خامة BOM تجريبية<\/td><td><b>165<\/b>[\s\S]*<td class="warn">65 /);

  // نسخ BOM لمنتج تاني
  await req('POST', `/bom/${pid('PB-2')}/copy`, { from: pid('PB-1') });
  assert.equal(db.prepare('SELECT qty FROM bom_lines WHERE product_id=?').get(pid('PB-2')).qty, 0.5);
  // استيراد BOM من Excel: سطر بيتضاف، وخامة مش موجودة بتتعدّى
  const bx = fs.readFileSync(path.join(__dirname, 'fixtures', 'bom-sample.xlsx'));
  assert.deepEqual(JSON.parse((await req('POST', '/r/bom/import', null, bx)).text), { ok: true, added: 1, updated: 0, skipped: 1 });
  assert.equal(db.prepare('SELECT scrap_pct FROM bom_lines WHERE product_id=?').get(pid('PB-3')).scrap_pct, 5);

  // إنتاج قديم قبل الـ BOM: إعادة الحساب من تاريخ
  db.prepare("INSERT INTO production_logs (date, employee_id, machine_id, product_id, qty_produced, qty_scrap) VALUES ('2026-08-01', ?, ?, ?, 50, 0)").run(emp, mach, pid('PB-3'));
  assert.equal(stock(), 100);
  await req('POST', `/bom/${pid('PB-3')}/recalc`, { from: '2026-08-01' });
  assert.equal(stock(), 89.5); // 50 × 0.2 × 1.05 = 10.5

  // أمين المخزن يشوف الـ BOM بس مايعدّلش
  const s = client();
  await s('POST', '/login', { username: 'store', password: 'store123' });
  assert.equal((await s('GET', `/bom/${pid('PB-1')}`)).status, 200);
  assert.equal((await s('POST', `/bom/${pid('PB-1')}`, { material_id: mid, qty: '9' })).status, 403);
});

test('Excel templates for materials and BOM import correctly', async () => {
  const db = require('../src/db');
  const { materialStock } = require('../src/bom');
  const req = client();
  await req('POST', '/login', { username: 'admin', password: 'admin123' });
  const tpl = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'templates', f));
  const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f));
  // التمبليت نفسه بيتحمل من البرنامج، ولو اتستورد فاضي بيقول مفيش بيانات
  assert.equal((await req('GET', '/templates/bom-template.xlsx')).status, 200);
  assert.match((await req('GET', '/r/materials/import')).text, /materials-template\.xlsx/);
  assert.equal(JSON.parse((await req('POST', '/r/materials/import', null, tpl('materials-template.xlsx'))).text).ok, false);
  assert.equal(JSON.parse((await req('POST', '/r/bom/import', null, tpl('bom-template.xlsx'))).text).ok, false);

  // شيت الخامات بعد ما اتملى: خامتين، والرصيد بيتظبط على الشيت
  assert.deepEqual(JSON.parse((await req('POST', '/r/materials/import', null, fx('materials-filled.xlsx'))).text), { ok: true, added: 2, updated: 0 });
  const m1 = db.prepare("SELECT * FROM materials WHERE code='TM1'").get();
  assert.equal(m1.unit_cost, 40);
  assert.equal(materialStock(db)[m1.id], 1000);
  // استيراده تاني بيحدّث ومش بيكرر، والرصيد يفضل 1000
  assert.deepEqual(JSON.parse((await req('POST', '/r/materials/import', null, fx('materials-filled.xlsx'))).text), { ok: true, added: 0, updated: 2 });
  assert.equal(materialStock(db)[m1.id], 1000);

  // شيت الـ BOM بعد ما اتملى: سطرين لأول منتج (بالكود وبالاسم)، والصفوف الفاضية بتتجاهل
  assert.deepEqual(JSON.parse((await req('POST', '/r/bom/import', null, fx('bom-filled.xlsx'))).text), { ok: true, added: 2, updated: 0, skipped: 0 });
  const pid = db.prepare("SELECT id FROM products WHERE code='ANMBBS027 RA'").get().id;
  assert.equal(db.prepare('SELECT qty FROM bom_lines WHERE product_id=? AND material_id=?').get(pid, m1.id).qty, 0.3);
});

test('Pre-BOM card: import sheet, save, photo, calculate BOM, copy, print layout', async () => {
  const db = require('../src/db');
  const req = client();
  await req('POST', '/login', { username: 'admin', password: 'admin123' });
  for (const c of ['PRE-1', 'PRE-2']) await req('POST', '/r/products', { code: c, name: 'منتج كارت ' + c });
  const pid = (c) => db.prepare('SELECT id FROM products WHERE code=?').get(c).id;
  const mats = {};
  for (const [c, n, u] of [['PM-1', 'خامة PP-T', 'كجم'], ['PM-2', 'ماستر أسود كارت', 'كجم'], ['PM-3', 'بوكس كارت', 'كرتونة'], ['PM-4', 'كليبس كارت', 'قطعة']]) {
    await req('POST', '/r/materials', { code: c, name: n, unit: u });
    mats[c] = db.prepare('SELECT id FROM materials WHERE code=?').get(c).id;
  }
  // كارت جديد فاضي فيه رقم القطعة، وبيتطبع بنفس الفورم
  const blank = (await req('GET', `/bom/${pid('PRE-1')}`)).text;
  assert.match(blank, /class="pb-title">PRE-BOM/);
  assert.match(blank, /name="f\[fpi_no\]" value="PRE-1"/);
  assert.match(blank, /FM-R&amp;D-12 REVISION :0/);

  // استيراد شيت Pre-BOM
  const x = fs.readFileSync(path.join(__dirname, 'fixtures', 'prebom-sample.xlsx'));
  assert.equal(JSON.parse((await req('POST', `/bom/${pid('PRE-1')}/card/import`, null, x)).text).ok, true);
  assert.equal(JSON.parse((await req('POST', `/bom/${pid('PRE-1')}/card/import`, null, Buffer.from('nope'))).text).ok, false);
  const page = (await req('GET', `/bom/${pid('PRE-1')}`)).text;
  for (const v of ['TST001', 'COROLLA 2008', '1,500g.', 'CLIP-01', 'SCREW-02', '50-TST001 NB', 'WITH FOG', 'WIP-77', 'first note line']) assert.ok(page.includes(v), v);

  // صورة للكارت
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const up = await fetch((await req.base()) + `/bom/${pid('PRE-1')}/card/photo?label=NA`, { method: 'POST', body: png, headers: { 'content-type': 'image/png', cookie: req.cookie() } });
  assert.equal((await up.json()).ok, true);
  const file = /\/photo\/(prebom-[^"]+)"/.exec((await req('GET', `/bom/${pid('PRE-1')}`)).text)[1];
  assert.equal((await req('GET', `/bom/${pid('PRE-1')}/photo/${file}`)).status, 200);
  assert.equal((await req('GET', `/bom/${pid('PRE-2')}/photo/${file}`)).status, 404); // صورة منتج تاني

  // اختيار الخامات من المخزن وحساب الـ BOM من الكارت:
  // (1500 جرام + رنر 100 ÷ 2 قطعة) = 1.55 كجم => PP 98% = 1.519، ماستر 2% = 0.031، بوكس 1÷10، كليبس 4
  await req('POST', `/bom/${pid('PRE-1')}/card`, { 'f[main_material_id]': mats['PM-1'], 'f[mb_material_id]': mats['PM-2'], 'f[runner_g]': '100',
    'f[box_material_id]': mats['PM-3'], 'components[0][material_id]': mats['PM-4'], 'components[0][qty]': '4', 'approvals[qa]': 'م. سامي', generate: '1' });
  const q = (m) => db.prepare('SELECT qty FROM bom_lines WHERE product_id=? AND material_id=?').get(pid('PRE-1'), mats[m])?.qty;
  assert.equal(q('PM-1'), 1.519); assert.equal(q('PM-2'), 0.031); assert.equal(q('PM-3'), 0.1); assert.equal(q('PM-4'), 4);
  const saved = (await req('GET', `/bom/${pid('PRE-1')}`)).text;
  assert.match(saved, /value="م. سامي"/);
  assert.match(saved, /COROLLA 2008/); // الحفظ ماضيعش بيانات الشيت

  // نسخ الكارت والخامات لمنتج تاني (من غير الصور)
  await req('POST', `/bom/${pid('PRE-2')}/copy`, { from: pid('PRE-1'), card: '1' });
  const copied = (await req('GET', `/bom/${pid('PRE-2')}`)).text;
  assert.match(copied, /COROLLA 2008/);
  assert.doesNotMatch(copied, /\/photo\/prebom-/);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM bom_lines WHERE product_id=?').get(pid('PRE-2')).c, 4);
  assert.match((await req('GET', '/bom?q=PRE-')).text, /✅/);

  // أمين المخزن يشوف الكارت بس مايعدّلش
  const s = client();
  await s('POST', '/login', { username: 'store', password: 'store123' });
  const view = await s('GET', `/bom/${pid('PRE-1')}`);
  assert.equal(view.status, 200); assert.doesNotMatch(view.text, /class="pb-in/);
  assert.equal((await s('POST', `/bom/${pid('PRE-1')}/card`, { 'f[car_name]': 'X' })).status, 403);
});

test('Pre-BOM cards sheet: one row per mold imports into each product card', async () => {
  const db = require('../src/db');
  const req = client();
  await req('POST', '/login', { username: 'admin', password: 'admin123' });
  assert.equal((await req('GET', '/templates/prebom-cards-template.xlsx')).status, 200);
  assert.match((await req('GET', '/bom')).text, /prebom-cards-template\.xlsx/);
  // الشيت الفاضي (أرقام القطع بس) => مفيش بيانات تتستورد
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'public', 'templates', 'prebom-cards-template.xlsx'));
  assert.equal(JSON.parse((await req('POST', '/r/bom_cards/import', null, tpl)).text).ok, false);
  // شيت فيه صف واحد متملي + رقم قطعة مش موجود => كارت واحد، والباقي بيتجاهل
  const fx = fs.readFileSync(path.join(__dirname, 'fixtures', 'prebom-cards-filled.xlsx'));
  assert.equal(JSON.parse((await req('POST', '/r/bom_cards/import?preview=1', null, fx)).text).rows.length, 2);
  const r = JSON.parse((await req('POST', '/r/bom_cards/import', null, fx)).text);
  assert.deepEqual(r, { ok: true, added: 1, updated: 0, skipped: 1 });
  const pid = db.prepare("SELECT id FROM products WHERE code='ANMBBS027 RA'").get().id;
  const page = (await req('GET', `/bom/${pid}`)).text;
  for (const v of ['MITSUBISHI', 'LANCER 2007', '2,000g.', '50-MBBS027 NA', 'LEFT']) assert.ok(page.includes(v), v);
  // الربط بالمخزن: 2 كجم => الخامة 98% = 1.96، الماستر 2% = 0.04، والمكون 1 كوده TM1 => 0.5 كمان على نفس الخامة
  const tm1 = db.prepare("SELECT id FROM materials WHERE code='TM1'").get().id;
  const mb = db.prepare("SELECT id FROM materials WHERE name='خامة نموذج ماستر'").get().id;
  const q = (m) => db.prepare('SELECT qty FROM bom_lines WHERE product_id=? AND material_id=?').get(pid, m)?.qty;
  assert.equal(q(tm1), 2.46); assert.equal(q(mb), 0.04);
  // استيراد تاني بعد ما الكارت اتعدّل في البرنامج: الخانات الفاضية في الشيت مابتمسحش
  await req('POST', `/bom/${pid}/card`, { 'f[inj_price]': '99' });
  await req('POST', '/r/bom_cards/import', null, fx);
  assert.match((await req('GET', `/bom/${pid}`)).text, /name="f\[inj_price\]" value="99"/);
});

test('work orders: auto number, in progress on first production, order page with materials', async () => {
  const db = require('../src/db');
  const req = client();
  await req('POST', '/login', { username: 'admin', password: 'admin123' });
  const form = (await req('GET', '/r/production_orders/new')).text;
  const code = /name="code" type="text"\s*value="(PO-\d+)"/.exec(form)[1];
  const pid = db.prepare("SELECT id FROM products WHERE code='PB-1'").get().id; // ليه BOM من اختبار الـ BOM
  const mach = db.prepare('SELECT id FROM machines LIMIT 1').get().id, emp = db.prepare('SELECT id FROM employees LIMIT 1').get().id;
  await req('POST', '/r/production_orders', { code, product_id: pid, qty_planned: '100', machine_id: mach, status: 'open', priority: 'urgent' });
  const o = db.prepare('SELECT * FROM production_orders WHERE code=?').get(code);
  assert.equal(o.status, 'open');
  assert.match((await req('GET', `/r/production_logs/new?order_id=${o.id}`)).text, new RegExp(`<option value="${o.id}"\\s*selected`));
  await req('POST', '/r/production_logs', { date: '2026-09-20', employee_id: emp, machine_id: mach, order_id: o.id, qty_produced: '40', qty_scrap: '0' });
  assert.equal(db.prepare('SELECT status FROM production_orders WHERE id=?').get(o.id).status, 'in_progress');
  const page = (await req('GET', `/orders/${o.id}`)).text;
  assert.match(page, /<b>40<\/b><span>/); // اتنتج
  assert.match(page, /40%/);
  assert.match(page, /خامة BOM تجريبية<\/td><td><b>55<\/b>/); // 100 × 0.55
  assert.match(page, /<td>22<\/td>/); // اتصرف على الأمر: 40 × 0.55
  assert.match((await req('GET', '/r/production_orders')).text, new RegExp(`href="/orders/${o.id}"`));
});

test('maintenance: breakdown sets machine broken, finishing restores it; plans open orders automatically', async () => {
  const db = require('../src/db');
  const MT = require('../src/maintenance');
  const req = client();
  await req('POST', '/login', { username: 'admin', password: 'admin123' });
  await req('POST', '/r/machines', { code: 'MT-1', name: 'ماكينة صيانة', status: 'running', hourly_capacity: '50' });
  const m = db.prepare("SELECT id FROM machines WHERE code='MT-1'").get().id;
  const status = () => db.prepare('SELECT status FROM machines WHERE id=?').get(m).status;
  // بلاغ عطل
  const form = (await req('GET', '/r/maintenance_orders/new')).text;
  const code = /name="code" type="text"\s*value="(MO-\d+)"/.exec(form)[1];
  assert.match((await req('POST', '/r/maintenance_orders', { code, type: 'breakdown', title: 'عطل', status: 'open' })).text, /واحدة بس/); // لازم معدة
  await req('POST', '/r/maintenance_orders', { code, type: 'breakdown', machine_id: m, title: 'الماكينة مش بتقفل', status: 'open', reported_at: '2026-09-21T08:00' });
  assert.equal(status(), 'broken');
  const id = db.prepare('SELECT id FROM maintenance_orders WHERE code=?').get(code).id;
  assert.match((await req('GET', '/maintenance')).text, /الماكينة مش بتقفل/);
  assert.match((await req('GET', '/alerts')).text, /الماكينة مش بتقفل/);
  await req('POST', `/r/maintenance_orders/${id}/start`, {});
  assert.equal(db.prepare('SELECT status FROM maintenance_orders WHERE id=?').get(id).status, 'in_progress');
  const fin = await req('POST', `/r/maintenance_orders/${id}/finish`, {});
  assert.equal(fin.location, `/r/maintenance_orders/${id}/edit`); // يكتب اللي اتعمل بعدها
  const done = db.prepare('SELECT * FROM maintenance_orders WHERE id=?').get(id);
  assert.equal(done.status, 'done'); assert.ok(done.finished_at); assert.ok(done.downtime_minutes > 0); // من وقت البلاغ
  assert.equal(status(), 'running');

  // خطة كل 7 أيام، آخر مرة من 10 أيام => أمر وقائي بيتفتح لوحده (مرة واحدة بس)
  await req('POST', '/r/maintenance_plans', { title: 'تشحيم تجريبي', machine_id: m, interval_type: 'days', interval_value: '7', last_done: new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10), active: 'yes' });
  assert.match((await req('POST', '/r/maintenance_plans', { title: 'غلط', machine_id: m, interval_type: 'shots', interval_value: '5' })).text, /للإسطمبات بس/);
  MT.createDueOrders(db); MT.createDueOrders(db);
  const auto = db.prepare("SELECT * FROM maintenance_orders WHERE title='تشحيم تجريبي'").all();
  assert.equal(auto.length, 1); assert.equal(auto[0].type, 'preventive');
  // إنهاؤه بيحدّث آخر مرة في الخطة
  await req('POST', `/r/maintenance_orders/${auto[0].id}/finish`, {});
  assert.equal(db.prepare("SELECT last_done FROM maintenance_plans WHERE title='تشحيم تجريبي'").get().last_done, new Date().toISOString().slice(0, 10));

  // فني الصيانة يقدر يشتغل على الصيانة بس مايقدرش يعدّل الإنتاج
  await req('POST', '/users', { username: 'tech', full_name: 'فني', role: 'technician', password: 'tech123', active: '1' });
  const t = client();
  await t('POST', '/login', { username: 'tech', password: 'tech123' });
  assert.equal((await t('GET', '/maintenance')).status, 200);
  assert.equal((await t('GET', '/r/maintenance_orders/new')).status, 200);
  assert.equal((await t('GET', '/r/production_logs/new')).status, 403);
});

test('shift sheet: hourly entry within 3 minutes, locked after, photo/video to unlock, totals feed production', async () => {
  const db = require('../src/db');
  const SH = require('../src/shifts');
  const req = client();
  await req('POST', '/login', { username: 'admin', password: 'admin123' });
  await req('POST', '/r/machines', { code: 'SM-1', name: 'ماكينة محضر', status: 'running' });
  await req('POST', '/r/employees', { code: 'SW1', name: 'عامل محضر', worker_type: 'regular', status: 'active' });
  await req('POST', '/r/employees', { code: 'ST2', name: 'فني محضر', worker_type: 'tech', status: 'active' });
  const id = (t, c) => db.prepare(`SELECT id FROM ${t} WHERE code=?`).get(c).id;
  const pid = id('products', 'PB-1');
  await req('POST', '/r/production_orders', { code: 'PO-SH1', product_id: pid, qty_planned: '1000', status: 'open' });
  const at = (h, m, d = 5) => SH.setClock(new Date(2026, 9, d, h, m));
  try {
    at(8, 10);
    const open = await req('POST', '/shifts', { machine_id: id('machines', 'SM-1'), date: '2026-10-05', order_id: id('production_orders', 'PO-SH1'),
      day_worker_id: id('employees', 'SW1'), day_tech_id: id('employees', 'ST2') });
    const sid = Number(/\/shifts\/(\d+)/.exec(open.location)[1]);
    const sheet = (await req('GET', `/shifts/${sid}`)).text;
    assert.match(sheet, /محضر استلام ورديه/); assert.match(sheet, /منتج BOM PB-1/); // المنتج من أمر التشغيل
    const slot = (i, form, file) => file
      ? fetch(`${base}/shifts/${sid}/slot/${i}?${new URLSearchParams(form)}`, { method: 'POST', body: file, headers: { 'content-type': 'image/jpeg', cookie: req.cookie() } }).then((r) => r.json())
      : req('POST', `/shifts/${sid}/slot/${i}`, form).then((r) => JSON.parse(r.text));

    // قبل ما الساعة تخلص: ممنوع
    at(8, 30); assert.match((await slot(0, { qty: '10' })).error, /لسه ماخلصتش/);
    // في الـ 5 دقايق بعد الساعة: في الميعاد (المشرف مش محتاج صورة)
    at(9, 2); assert.deepEqual(await slot(0, { qty: '100', scrap: '5', cycle_time: '36' }), { ok: true, status: 'on_time' });
    const log = () => db.prepare('SELECT * FROM production_logs WHERE source_key LIKE ?').get(`sheet:${sid}:day:%`);
    assert.equal(log().qty_produced, 100); assert.equal(log().qty_scrap, 5); assert.equal(log().hours_worked, 1);
    assert.equal(db.prepare('SELECT status FROM production_orders WHERE id=?').get(id('production_orders', 'PO-SH1')).status, 'in_progress');

    // عامل الإنتاج: في الـ 5 دقايق بعد الساعة، والبيانات لازم معاها صورة أو فيديو
    await req('POST', '/users', { username: 'worker1', full_name: 'عامل', role: 'operator', password: 'work123', active: '1', employee_id: id('employees', 'SW1') });
    const w = client();
    assert.equal((await w('POST', '/login', { username: 'worker1', password: 'work123' })).location, '/floor');
    assert.equal((await w('POST', '/shifts', { machine_id: id('machines', 'SM-1') })).status, 403); // مايفتحش محاضر
    at(10, 3);
    assert.match((await w('GET', '/floor')).text, /صورة أو فيديو \(إجباري\)/);
    assert.match(JSON.parse((await w('POST', `/shifts/${sid}/slot/1`, { qty: '90' })).text).error, /لازم ترفع صورة أو فيديو/);
    const up = await fetch(`${base}/shifts/${sid}/slot/1?qty=90&scrap=2`, { method: 'POST', body: Buffer.from('fakejpeg'), headers: { 'content-type': 'image/jpeg', cookie: w.cookie() } }).then((r) => r.json());
    assert.deepEqual(up, { ok: true, status: 'on_time' });
    const proof = db.prepare('SELECT proof_file FROM hourly_logs WHERE sheet_id=? AND slot=1').get(sid).proof_file;
    assert.equal((await req('GET', `/shifts/${sid}/proof/${proof}`)).status, 200);
    assert.equal(log().qty_produced, 190); assert.equal(log().hours_worked, 2);

    // الساعة التالتة: عدّى الـ 5 دقايق => اتقفلت "ماشتغلش"، والعامل مايقدرش يسجلها حتى بصورة
    at(11, 6); SH.markMissed(db);
    assert.equal(db.prepare('SELECT status FROM hourly_logs WHERE sheet_id=? AND slot=2').get(sid).status, 'missed');
    assert.match(log().notes, /1 ساعة ماتسجلتش/);
    assert.equal(log().hours_worked, 2);
    const late = await fetch(`${base}/shifts/${sid}/slot/2?qty=40`, { method: 'POST', body: Buffer.from('x'), headers: { 'content-type': 'image/jpeg', cookie: w.cookie() } }).then((r) => r.json());
    assert.equal(late.ok, false); assert.match(late.error, /اتقفلت/);
    assert.match((await w('GET', '/floor')).text, /اتقفلت واتحسبت ماشتغلش/);
    // المشرف بس يقدر يعدّلها (من غير صورة)
    assert.deepEqual(await slot(2, { qty: '50' }), { ok: true, status: 'edited' });
    assert.equal(log().hours_worked, 3);
    // توقف 30 دقيقة بيتحسب على الإنتاج
    await req('POST', `/shifts/${sid}/downtime`, { from_time: '10:15', to_time: '10:45', reason: 'تغيير إسطمبة' });
    assert.equal(log().downtime_minutes, 30);
    // شاشة الصالة: في الدقايق اللي بعد الساعة فيه عداد تنازلي
    at(12, 1);
    const floor = (await w('GET', '/floor')).text;
    assert.match(floor, /ماكينة محضر/); assert.match(floor, /class="countdown"/);
    // اليوم اللي بعده: المحضر بيتقفل لوحده وكل الساعات اللي ماتسجلتش بتتحسب
    at(8, 10, 6); SH.markMissed(db);
    assert.ok(db.prepare('SELECT closed_at FROM shift_sheets WHERE id=?').get(sid).closed_at);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM hourly_logs WHERE sheet_id=? AND status='missed'").get(sid).c, 9 + 12 - 0); // ساعات 3..11 نهاري + 12 ليلي
    assert.match((await req('GET', '/shifts?date=2026-10-05')).text, /SM-1/);
  } finally { SH.setClock(null); }
});

test('shift report is emailed automatically once after each shift ends', async () => {
  const db = require('../src/db');
  const SH = require('../src/shifts');
  const MAIL = require('../src/mailer');
  const req = client();
  await req('POST', '/login', { username: 'admin', password: 'admin123' });
  await req('POST', '/settings/mail', { mail_enabled: '1', mail_to: 'boss@example.com', mail_user: 'factory@example.com', mail_pass: 'abcd efgh ijkl mnop' });
  assert.equal(db.getSetting('mail_pass'), 'abcdefghijklmnop'); // المسافات اتشالت
  const page = (await req('GET', '/settings')).text;
  assert.match(page, /boss@example.com/); assert.doesNotMatch(page, /abcdefghijklmnop/); // الباسورد مابيظهرش
  try {
    SH.setClock(new Date(2026, 9, 5, 20, 3)); MAIL.resetRetry();
    assert.equal(await MAIL.sendDueReports(db), 0); // الوردية خلصت 8، ولسه دقايق التسجيل
    SH.setClock(new Date(2026, 9, 5, 20, 7));
    assert.equal(await MAIL.sendDueReports(db), 1);
    const m = MAIL.lastTest();
    assert.deepEqual(m.to, ['boss@example.com']);
    assert.match(m.subject, /تقرير الوردية النهاري - 2026-10-05/);
    assert.match(m.html, /SM-1/); assert.match(m.html, /ساعات اتقفلت ماتسجلتش/); assert.match(m.html, /تغيير إسطمبة/);
    assert.equal(await MAIL.sendDueReports(db), 0); // مرة واحدة بس
    SH.setClock(new Date(2026, 9, 6, 8, 7));
    assert.equal(await MAIL.sendDueReports(db), 1);
    assert.match(MAIL.lastTest().subject, /الوردية الليلي - 2026-10-05/);
    assert.match(db.getSetting('mail_last_sent'), /الوردية الليلي/);
    // زرار الإيميل التجريبي
    await req('POST', '/settings/mail-test', {});
    assert.match(MAIL.lastTest().subject, /^\[تجربة\]/);
    // لو الإرسال مقفول مفيش حاجة بتتبعت
    await req('POST', '/settings/mail', { mail_to: 'boss@example.com', mail_user: 'factory@example.com' });
    SH.setClock(new Date(2026, 9, 6, 20, 7));
    assert.equal(await MAIL.sendDueReports(db), 0);
    assert.equal(db.getSetting('mail_pass'), 'abcdefghijklmnop'); // الحفظ من غير باسورد مابيمسحوش
  } finally { SH.setClock(null); }
});
