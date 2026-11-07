const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-'));
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.NO_BACKUP = '1';
const app = require('../src/app');
let server, base;

function client() {
  const jar = {};
  return async (method, url, form, raw) => {
    const res = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; '), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(raw ? { 'content-type': 'application/octet-stream' } : {}) },
      body: raw || (form ? new URLSearchParams(form).toString() : undefined),
    });
    for (const c of res.headers.getSetCookie()) { const [k, v] = c.split(';')[0].split('='); jar[k] = v; }
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  };
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
  await req('POST', '/settings/clear', { confirm: 'مسح', keep_employees: '1' });
  assert.doesNotMatch((await req('GET', '/r/production_logs')).text, /مكبس حقن 1/);
  assert.match((await req('GET', '/r/employees')).text, /موظف تجريبي أول/);

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
  const up = (await req('GET', '/r/upcoming_molds')).text;
  assert.match(up, /\(83\)/);
  assert.match(up, /CYNTIA-01/);
  assert.doesNotMatch(up, /ANMBBS027 RA/);
  assert.match((await req('GET', '/r/upcoming_molds?producer=SHIDA')).text, /\(17\)/);
  assert.match((await req('GET', '/?date=2026-11-07')).text, /إسطمبات قادمة/);

  // استلام إسطمبة قادمة => بتتنقل للإسطمبات ومعاها منتج
  // CYNTIA-01 ليها رقم قطعة مزدوج (L/R) => كود الإسطمبة بيبقى مرجع المورد، والعيون R+L 2 => 2
  const cy = /action="\/r\/upcoming_molds\/(\d+)\/receive"[\s\S]*?CYNTIA-01/.exec(up)[1];
  const recv = await req('POST', `/r/upcoming_molds/${cy}/receive`, {});
  assert.equal(recv.location, '/r/upcoming_molds');
  assert.match((await req('GET', '/r/upcoming_molds')).text, /\(82\)/);
  const molds2 = (await req('GET', '/r/molds?q=CYNTIA-01')).text;
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
