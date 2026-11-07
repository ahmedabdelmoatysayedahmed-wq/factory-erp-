const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-'));
process.env.DB_FILE = path.join(tmp, 'test.db');
const app = require('../src/app');
let server, base;

function client() {
  const jar = {};
  return async (method, url, form) => {
    const res = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; '), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
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

  // صلاحيات: أمين مخزن مايقدرش يدخل الإنتاج أو الموظفين
  await req('POST', '/users', { username: 'store', full_name: 'أمين', role: 'storekeeper', password: 'store123', active: '1' });
  const s = client();
  await s('POST', '/login', { username: 'store', password: 'store123' });
  assert.equal((await s('GET', '/r/materials')).status, 200);
  assert.equal((await s('GET', '/r/production_logs')).status, 403);
  assert.equal((await s('GET', '/users')).status, 403);
  assert.equal((await s('POST', '/r/employees', { name: 'x' })).status, 403);
  assert.equal((await s('GET', '/r/molds/new')).status, 403); // يشوف الإسطمبات بس مايعدلش
});
