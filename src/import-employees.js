// استيراد الموظفين من ملف Excel
// بيدوّر على صف العناوين (اللي فيه "الاسم") وبيطابق الأعمدة بالاسم، فترتيب الأعمدة مش مهم
const { readSheet } = require('read-excel-file/node');

const COLUMNS = {
  code: ['الكود', 'كود', 'رقم الموظف', 'code'],
  name: ['الاسم', 'اسم الموظف', 'name'],
  national_id: ['الرقم القومي', 'رقم قومي', 'national id'],
  phone: ['الهاتف', 'التليفون', 'الموبايل', 'رقم الهاتف', 'phone', 'mobile'],
  department: ['القسم', 'الإدارة', 'department'],
  job_title: ['الوظيفة', 'المسمى الوظيفي', 'job title', 'job'],
  salary: ['المرتب', 'الراتب', 'salary'],
  hire_date: ['تاريخ التعيين', 'hire date'],
  status: ['نشط', 'نشط؟', 'الحالة', 'active', 'status'],
  daily_target: ['المستهدف', 'المستهدف اليومي', 'daily target'],
};
const norm = (s) => String(s ?? '').replace(/[*؟?:]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const clean = (v) => (v === null || v === undefined ? null : String(v).replace(/\s+/g, ' ').trim() || null);

function toDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(s); // يوم/شهر/سنة
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
// Excel بيشيل الصفر اللي على الشمال من أرقام الموبايل (1012345678 بدل 01012345678)
function toPhone(v) {
  const s = clean(v); if (!s) return null;
  const d = s.replace(/[^\d+]/g, '');
  return /^1[0125]\d{8}$/.test(d) ? '0' + d : d || s;
}
function toStatus(v) {
  const s = norm(v);
  if (!s) return 'active';
  return ['لا', 'no', 'false', '0', 'متوقف', 'غير نشط', 'inactive'].includes(s) ? 'inactive' : 'active';
}
const toNum = (v) => { if (v === null || v === '' || v === undefined) return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

async function parseEmployees(buffer) {
  const rows = await readSheet(buffer);
  const headerIdx = rows.findIndex((r) => r.some((c) => COLUMNS.name.includes(norm(c))));
  if (headerIdx < 0) throw new Error('ماقدرتش ألاقي عمود "الاسم" في الملف');
  const header = rows[headerIdx].map(norm);
  const col = {};
  for (const [key, names] of Object.entries(COLUMNS)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) col[key] = i;
  }
  const out = [];
  rows.slice(headerIdx + 1).forEach((r, i) => {
    const get = (k) => (col[k] === undefined ? null : r[col[k]]);
    const name = clean(get('name'));
    if (!name) return; // صف فاضي
    out.push({
      line: headerIdx + i + 2,
      code: clean(get('code')),
      name,
      national_id: clean(get('national_id')),
      phone: toPhone(get('phone')),
      department: clean(get('department')),
      job_title: clean(get('job_title')),
      salary: toNum(get('salary')),
      hire_date: toDate(get('hire_date')),
      status: toStatus(get('status')),
      daily_target: toNum(get('daily_target')),
    });
  });
  return out;
}

// إضافة أو تحديث: بنطابق بالكود، ولو مفيش كود بالرقم القومي، ولو مفيش بالاسم
function importEmployees(db, list) {
  const find = (e) =>
    (e.code && db.prepare('SELECT id FROM employees WHERE code=?').get(e.code)) ||
    (e.national_id && db.prepare('SELECT id FROM employees WHERE national_id=?').get(e.national_id)) ||
    db.prepare('SELECT id FROM employees WHERE name=?').get(e.name);
  const res = { added: 0, updated: 0 };
  db.transaction(() => {
    for (const e of list) {
      const { line, ...row } = e;
      const ex = find(e);
      if (ex) {
        // التحديث مابيمسحش بيانات موجودة لو الخانة فاضية في الملف
        const cols = Object.keys(row).filter((k) => row[k] !== null);
        db.prepare(`UPDATE employees SET ${cols.map((c) => c + '=?').join(',')} WHERE id=?`).run(...cols.map((c) => row[c]), ex.id);
        res.updated++;
      } else {
        const cols = Object.keys(row);
        db.prepare(`INSERT INTO employees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c]));
        res.added++;
      }
    }
  })();
  return res;
}

module.exports = { parseEmployees, importEmployees };
