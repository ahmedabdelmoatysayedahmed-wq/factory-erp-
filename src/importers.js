// استيراد البيانات من ملفات Excel (الموظفين والإسطمبات)
// بيدوّر على صف العناوين وبيطابق الأعمدة بالاسم (عربي أو إنجليزي)، فترتيب الأعمدة مش مهم
const { readSheet } = require('read-excel-file/node');

const norm = (s) => String(s ?? '').replace(/[*؟?:]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const clean = (v) => (v === null || v === undefined ? null : String(v).replace(/\s+/g, ' ').trim() || null);
const toNum = (v) => { if (v === null || v === '' || v === undefined) return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
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
const isNo = (v) => ['لا', 'no', 'false', '0', 'متوقف', 'غير نشط', 'inactive'].includes(norm(v));

// بيقرا الجدول ويرجع صفوف فيها المفاتيح المطلوبة
async function readTable(buffer, columns, requiredKey) {
  const rows = await readSheet(buffer);
  const headerIdx = rows.findIndex((r) => r.some((c) => columns[requiredKey].includes(norm(c))));
  if (headerIdx < 0) throw Object.assign(new Error('missing column'), { tr: ['ماقدرتش ألاقي عمود "{0}" في الملف', columns[requiredKey][0]] });
  const header = rows[headerIdx].map(norm);
  const col = {};
  for (const [key, names] of Object.entries(columns)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) col[key] = i;
  }
  // عمود من غير عنوان جنب عمود معروف (زي الوكيل جنب المصنّع)
  for (const [key, names] of Object.entries(columns)) {
    const after = names.find((n) => n.startsWith('@after:'));
    if (col[key] === undefined && after) {
      const i = col[after.slice(7)];
      if (i !== undefined && !header[i + 1]) col[key] = i + 1;
    }
  }
  return rows.slice(headerIdx + 1).map((r) => {
    const o = {};
    for (const k of Object.keys(columns)) o[k] = col[k] === undefined ? null : r[col[k]];
    return o;
  });
}

// إضافة أو تحديث صف: لو موجود بيتحدث (والخانات الفاضية في الملف مابتمسحش بيانات موجودة)
function upsert(db, table, row, existingId) {
  if (existingId) {
    const cols = Object.keys(row).filter((k) => row[k] !== null);
    if (cols.length) db.prepare(`UPDATE ${table} SET ${cols.map((c) => c + '=?').join(',')} WHERE id=?`).run(...cols.map((c) => row[c]), existingId);
    return existingId;
  }
  const cols = Object.keys(row);
  return Number(db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c])).lastInsertRowid);
}

const importers = {
  employees: {
    title: 'استيراد الموظفين من Excel',
    columnsHint: 'الكود، الاسم، الرقم القومي، الهاتف، القسم، الوظيفة، المرتب، تاريخ التعيين، نشط، المستهدف اليومي',
    matchHint: 'لو الموظف موجود قبل كده (نفس الكود أو الرقم القومي أو الاسم) بياناته بتتحدث، ومش بيتكرر.',
    preview: [['code', 'الكود'], ['name', 'الاسم'], ['national_id', 'الرقم القومي'], ['phone', 'التليفون'], ['job_title', 'الوظيفة'], ['hire_date', 'تاريخ التعيين']],
    async parse(buffer) {
      const rows = await readTable(buffer, {
        code: ['الكود', 'كود', 'رقم الموظف', 'code'],
        name: ['الاسم', 'اسم الموظف', 'name'],
        national_id: ['الرقم القومي', 'رقم قومي', 'national id'],
        phone: ['الهاتف', 'التليفون', 'الموبايل', 'رقم الهاتف', 'phone', 'mobile'],
        department: ['القسم', 'الإدارة', 'department'],
        job_title: ['الوظيفة', 'المسمى الوظيفي', 'job title', 'job'],
        salary: ['المرتب', 'الراتب', 'salary'],
        hire_date: ['تاريخ التعيين', 'hire date'],
        status: ['نشط', 'الحالة', 'active', 'status'],
        daily_target: ['المستهدف', 'المستهدف اليومي', 'daily target'],
      }, 'name');
      return rows.filter((r) => clean(r.name)).map((r) => ({
        code: clean(r.code), name: clean(r.name), national_id: clean(r.national_id), phone: toPhone(r.phone),
        department: clean(r.department), job_title: clean(r.job_title), salary: toNum(r.salary), hire_date: toDate(r.hire_date),
        status: isNo(r.status) ? 'inactive' : 'active', daily_target: toNum(r.daily_target),
      }));
    },
    // بنطابق بالكود، ولو مفيش كود بالرقم القومي، ولو مفيش بالاسم
    importRows(db, list) {
      const res = { added: 0, updated: 0 };
      db.transaction(() => {
        for (const e of list) {
          const ex = (e.code && db.prepare('SELECT id FROM employees WHERE code=?').get(e.code)) ||
            (e.national_id && db.prepare('SELECT id FROM employees WHERE national_id=?').get(e.national_id)) ||
            db.prepare('SELECT id FROM employees WHERE name=?').get(e.name);
          upsert(db, 'employees', e, ex && ex.id); res[ex ? 'updated' : 'added']++;
        }
      })();
      return res;
    },
  },

  molds: {
    title: 'استيراد الإسطمبات من Excel',
    columnsHint: 'رقم القطعة (Part Number)، المسمى، الوصف بالإنجليزي (Description)، عدد العيون، المكان، صيانة كل (ضربة)، الحالة',
    matchHint: 'لو الإسطمبة موجودة (نفس رقم القطعة) بياناتها بتتحدث. وكل إسطمبة بيتعملها منتج بنفس الرقم والاسم علشان تسجّل عليه الإنتاج.',
    preview: [['code', 'رقم القطعة'], ['name', 'الاسم'], ['name_en', 'الوصف بالإنجليزي']],
    async parse(buffer) {
      const rows = await readTable(buffer, {
        code: ['part number', 'part no', 'part', 'رقم القطعة', 'الكود', 'كود', 'code'],
        name: ['المسمى', 'الاسم', 'اسم الإسطمبة', 'اسم القطعة'],
        name_en: ['description', 'الوصف', 'الوصف بالإنجليزي', 'name'],
        cavities: ['عدد العيون', 'العيون', 'cavities'],
        location: ['المكان', 'مكان التخزين', 'location'],
        maintenance_every: ['صيانة كل', 'صيانة كل (ضربة)', 'maintenance every'],
        status: ['الحالة', 'status'],
      }, 'code');
      const st = { 'متاحة': 'available', 'على الماكينة': 'in_use', 'صيانة': 'maintenance', 'تالفة': 'damaged' };
      return rows.filter((r) => clean(r.code) && (clean(r.name) || clean(r.name_en))).map((r) => ({
        code: clean(r.code), name: clean(r.name) || clean(r.name_en), name_en: clean(r.name_en),
        cavities: toNum(r.cavities), location: clean(r.location), maintenance_every: toNum(r.maintenance_every),
        status: st[clean(r.status)] || null,
      }));
    },
    importRows(db, list) {
      const res = { added: 0, updated: 0 };
      db.transaction(() => {
        for (const m of list) {
          // المنتج اللي الإسطمبة بتعمله (بنفس رقم القطعة)
          const p = db.prepare('SELECT id FROM products WHERE code=?').get(m.code);
          const productId = upsert(db, 'products', { code: m.code, name: m.name, name_en: m.name_en, unit: p ? null : 'قطعة' }, p && p.id);
          const ex = db.prepare('SELECT id FROM molds WHERE code=?').get(m.code);
          const row = { ...m, product_id: productId };
          if (!ex) { row.cavities = row.cavities || 1; row.status = row.status || 'available'; }
          upsert(db, 'molds', row, ex && ex.id); res[ex ? 'updated' : 'added']++;
        }
      })();
      return res;
    },
  },
};

importers.upcoming_molds = {
  title: 'استيراد الإسطمبات القادمة من Excel',
  columnsHint: 'رقم القطعة (Part Number)، المسمى، الوصف (Description)، المصنّع (Producer)، الوكيل / المسؤول (العمود اللي جنب المصنّع لو مالوش عنوان)، الحالة، الوصول المتوقع، عدد العيون، السعر',
  matchHint: 'لو الإسطمبة موجودة في القادمة (نفس رقم القطعة) بياناتها بتتحدث. ولو اتستلمت خلاص وموجودة في الإسطمبات، مش بتتضاف تاني.',
  preview: [['code', 'رقم القطعة'], ['name', 'الاسم'], ['producer', 'المصنّع'], ['agent', 'الوكيل / المسؤول']],
  async parse(buffer) {
    const rows = await readTable(buffer, {
      code: ['مرجع المورد', 'part number', 'part no', 'part no.', 'رقم القطعة', 'الكود', 'code'],
      name: ['المسمى', 'الاسم', 'اسم القطعة'],
      name_en: ['description', 'الوصف', 'الوصف بالإنجليزي', 'name'],
      producer: ['producer', 'المصنع', 'المصنّع', 'المورد', 'supplier', 'maker'],
      agent: ['الوكيل', 'المسؤول', 'الوكيل / المسؤول', 'agent', '@after:producer'],
      part_no: ['رقم القطعة عندنا', 'our part no'],
      oem_no: ['oem', 'oem number', 'رقم oem'],
      material: ['الخامة', 'خامة المنتج', 'plastic material', 'product material', 'material'],
      t0_date: ['t0', 'تاريخ التجربة', 'testing date'],
      status: ['الحالة', 'status'],
      expected_date: ['الوصول المتوقع', 'تاريخ الوصول', 'eta', 'expected'],
      cavities: ['عدد العيون', 'cavities', 'cavity no'],
      price: ['السعر', 'price'],
    }, 'code');
    const st = { 'قيد التصنيع': 'manufacturing', 'تجربة': 'trial', 'في الشحن': 'shipping', 'في الجمرك': 'customs' };
    return rows.filter((r) => clean(r.code) && (clean(r.name) || clean(r.name_en))).map((r) => ({
      code: clean(r.code), name: clean(r.name) || clean(r.name_en), name_en: clean(r.name_en),
      producer: clean(r.producer) && clean(r.producer).toUpperCase(), agent: clean(r.agent),
      status: st[clean(r.status)] || null, expected_date: toDate(r.expected_date), cavities: clean(r.cavities), price: toNum(r.price),
      part_no: clean(r.part_no), oem_no: clean(r.oem_no), material: clean(r.material), t0_date: toDate(r.t0_date),
    }));
  },
  importRows(db, list) {
    const res = { added: 0, updated: 0, skipped: 0 };
    db.transaction(() => {
      for (const m of list) {
        if (db.prepare('SELECT 1 FROM molds WHERE code=?').get(m.code)) { res.skipped++; continue; } // اتستلمت خلاص
        const ex = db.prepare('SELECT id FROM upcoming_molds WHERE code=?').get(m.code);
        upsert(db, 'upcoming_molds', ex ? m : { ...m, status: m.status || 'manufacturing' }, ex && ex.id); res[ex ? 'updated' : 'added']++;
      }
    })();
    return res;
  },
};

module.exports = { importers };
