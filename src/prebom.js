// كارت Pre-BOM لكل منتج (زي فورم FM-R&D-12): بيانات المنتج والإسطمبة والتغليف والمكونات والأصناف والموديلات
// والبرنامج بيحسب منه خامات الـ BOM (اللي بتتخصم من المخزن مع الإنتاج)
const { readSheet } = require('read-excel-file/node');

const VARIANTS = ['NA', 'NB', 'NC', 'ND', 'NE'];
const ITEMS = 11, COMPONENTS = 9, NOTES = 15;

// خانات الكارت بنفس أسامي الفورم
const HEAD_A = [['fpi_no', 'FPI NO.'], ['car_name', 'Car name'], ['car_model', 'Car model'], ['product_name', 'Product name'], ['supplier', 'Supplier name'],
  ['machine', 'Machine name'], ['pcs_per_shot', 'piece / shot'], ['weight_g', 'Weight (g)'], ['mat_name', "Mat'l name"], ['mat_code', "Mat'l code"],
  ['mat_full_name', "Mat'l name (full)"], ['ratio', 'Ratio'], ['masterbatch', 'Masterbatch'], ['mb_pct', '%']];
const HEAD_C = [['mold_h', 'Mold height (mm.)'], ['mold_w', 'Mold wide (mm.)'], ['mold_l', 'Mold long (mm)'], ['box_name', 'box name'], ['box_l', 'box long (in)'],
  ['box_w', 'box wide (in)'], ['box_h', 'box hight (in)'], ['box_pcs', 'piece / unit'], ['packing', 'packing'], ['partition_no', 'partition no'],
  ['partition_unit', 'partition / unit'], ['bag_size', 'bag size'], ['bag_thickness', 'bag thickness'], ['bag_pcs', 'piece']];

function empty() {
  return {
    items: Array.from({ length: ITEMS }, () => ({})), components: Array.from({ length: COMPONENTS }, () => ({})),
    variants: Object.fromEntries(VARIANTS.map((v) => [v, {}])), notes: Array(NOTES).fill(''), approvals: {}, photos: [],
  };
}
function normalize(d) {
  const e = empty(); d = d || {};
  return { ...e, ...d,
    items: e.items.map((x, i) => ({ ...(d.items || [])[i] })), components: e.components.map((x, i) => ({ ...(d.components || [])[i] })),
    variants: Object.fromEntries(VARIANTS.map((v) => [v, { ...(d.variants || {})[v] }])), notes: e.notes.map((x, i) => (d.notes || [])[i] || ''),
    approvals: { ...d.approvals }, photos: d.photos || [] };
}
// رقم من نص زي "3,826g." أو "1 PCS." أو "2400 mm."
const num = (v) => { const m = String(v ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };

// ---------- قراءة شيت Pre-BOM (xlsx) ----------
const key = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9%]/g, '');
const txt = (v) => (v === null || v === undefined || v === '' ? '' : String(v).replace(/\s+/g, ' ').trim());
async function parseSheet(buffer) {
  const rows = await readSheet(buffer);
  const d = empty();
  const cell = (r, c) => (rows[r] ? rows[r][c] : null);
  if (!rows.some((r) => r.some((c) => key(c) === 'fpino' || key(c) === 'prebom'))) throw new Error('not a pre-bom');
  // العمودين A/B
  let matNames = 0;
  const aMap = { fpino: 'fpi_no', carname: 'car_name', carmodel: 'car_model', produtname: 'product_name', productname: 'product_name', suprierfname: 'supplier',
    supriername: 'supplier', suppliername: 'supplier', machinename: 'machine', pieceshot: 'pcs_per_shot', weightg: 'weight_g', matlcode: 'mat_code',
    ratio: 'ratio', masterbatch: 'masterbatch', '%': 'mb_pct' };
  // العمودين C/D و E/F (فيهم "piece / unit" بيتكرر بعد كل حاجة)
  const cMap = { moldheightmm: 'mold_h', moldwidemm: 'mold_w', moldlongmm: 'mold_l', boxname: 'box_name', boxlongin: 'box_l', boxwidein: 'box_w',
    boxhightin: 'box_h', packing: 'packing', partitionno: 'partition_no', partitionunit: 'partition_unit', bagsize: 'bag_size', bagthickness: 'bag_thickness', piece: 'bag_pcs' };
  let itemRow = -1;
  rows.forEach((r, i) => {
    const a = key(r[0]);
    if (a === 'itemcode') itemRow = i;
    if (itemRow < 0 && i < 30) {
      if (a === 'matlname') { d[matNames++ ? 'mat_full_name' : 'mat_name'] = txt(r[1]); }
      else if (aMap[a]) d[aMap[a]] = txt(r[1]);
    }
  });
  for (const col of [2, 4]) {
    let ctx = null;
    for (let i = 0; i < (itemRow > 0 ? itemRow : rows.length); i++) {
      const k = key(cell(i, col)); const v = txt(cell(i, col + 1));
      const comp = /^componants?(\d+)$|^components?(\d+)$/.exec(k);
      if (comp) { ctx = Number(comp[1] || comp[2]) - 1; if (d.components[ctx]) d.components[ctx].code = v; }
      else if (k === 'pieceuit' || k === 'pieceunit') {
        if (ctx === 'box') d.box_pcs = v; else if (typeof ctx === 'number' && d.components[ctx]) d.components[ctx].qty_text = v;
      } else if (cMap[k]) { d[cMap[k]] = v; if (k === 'boxhightin') ctx = 'box'; }
    }
  }
  // جدول الأصناف والموديلات وسعر الحقن والملاحظات
  const iMap = { description: 'desc', mat: 'mat', cavityshot: 'cavity', moldsize: 'mold_size', wipcode: 'wip' };
  let variant = null, noteStart = -1;
  rows.forEach((r, i) => {
    if (i <= itemRow) return;
    const a = key(r[0]);
    if (iMap[a]) for (let k = 0; k < ITEMS; k++) d.items[k][iMap[a]] = txt(r[k + 1]);
    else if (VARIANTS.includes(String(r[0] ?? '').trim().toUpperCase())) { variant = String(r[0]).trim().toUpperCase(); d.variants[variant].desc = txt(r[1]); }
    else if (a === 'fgcode' && variant) d.variants[variant].fg = txt(r[1]);
    else if (a === 'oemno' && variant) d.variants[variant].oem = txt(r[1]);
    else if (a === 'injprice') d.inj_price = txt(r[1]);
    else if (/^revision/.test(a) && !d.revision) d.revision = String(r[0]).replace(/[^0-9.]/g, '');
    if (noteStart < 0 && String(r[0]) === '1' && i > itemRow + 10) noteStart = i;
  });
  if (noteStart > 0) for (let k = 0; k < NOTES; k++) d.notes[k] = txt(cell(noteStart + k, 1));
  return d;
}

// ---------- حساب خامات الـ BOM من الكارت ----------
// الخامة الأساسية والماستر باتش: (وزن القطعة + الرنر ÷ عدد القطع في الضربة) مقسومين بنسبة الماستر باتش
// التغليف والمكونات: الكمية للقطعة اللي مكتوبة قصادها
function bomFromCard(d) {
  const lines = [];
  const pcs = num(d.pcs_per_shot) || 1;
  const kg = ((num(d.weight_g) || 0) + (num(d.runner_g) || 0) / pcs) / 1000;
  const mb = num(d.mb_pct) || 0;
  const scrap = num(d.scrap_pct) || 0;
  const add = (material_id, qty, scrap_pct = 0) => { if (material_id && qty > 0) lines.push({ material_id: Number(material_id), qty: Math.round(qty * 1e6) / 1e6, scrap_pct }); };
  add(d.main_material_id, kg * (1 - mb / 100), scrap);
  add(d.mb_material_id, kg * mb / 100, scrap);
  if (num(d.box_pcs)) add(d.box_material_id, 1 / num(d.box_pcs));
  add(d.partition_material_id, num(d.partition_qty));
  add(d.bag_material_id, num(d.bag_qty));
  for (const c of d.components) add(c.material_id, num(c.qty));
  // لو نفس الخامة اتكررت نجمعها
  const by = {};
  for (const l of lines) by[l.material_id] = by[l.material_id] ? { ...l, qty: by[l.material_id].qty + l.qty } : l;
  return Object.values(by);
}

// ---------- الكارت في قاعدة البيانات ----------
function getCard(db, p) {
  const r = db.prepare('SELECT data FROM pre_bom WHERE product_id=?').get(p.id);
  const d = normalize(r ? JSON.parse(r.data) : null);
  if (!r) { d.fpi_no = p.code || ''; d.product_name = p.name_en || p.name; }
  return d;
}
function saveCard(db, pid, d, userId = null) {
  db.prepare(`INSERT INTO pre_bom (product_id, data, updated_at, updated_by) VALUES (?,?,datetime('now'),?)
    ON CONFLICT(product_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
    .run(pid, JSON.stringify(d), userId);
}
// خامات الـ BOM من الكارت: بتمسح سطور الـ BOM القديمة وتحط الجديدة
function generateFromCard(db, pid, d) {
  const lines = bomFromCard(d);
  db.transaction(() => {
    db.prepare('DELETE FROM bom_lines WHERE product_id=?').run(pid);
    for (const l of lines) db.prepare('INSERT INTO bom_lines (product_id, material_id, qty, scrap_pct, notes) VALUES (?,?,?,?,?)').run(pid, l.material_id, l.qty, l.scrap_pct, 'من كارت Pre-BOM');
  })();
  return lines.length;
}

// ---------- شيت الكروت (صف لكل إسطمبة) ----------
// [مفتاح، عنوان العمود، القسم]. "c1" = المكون 1 ... "i1_desc" = الصنف 1 ... "NA_fg" = الموديل NA
const SHEET_COLS = [
  ['code', 'part number', 'المنتج'], ['_name', 'اسم المنتج (للعلم بس)', 'المنتج'],
  ['fpi_no', 'FPI NO.', 'بيانات المنتج'], ['car_name', 'Car name', 'بيانات المنتج'], ['car_model', 'Car model', 'بيانات المنتج'],
  ['product_name', 'Product name', 'بيانات المنتج'], ['supplier', 'Supplier name', 'بيانات المنتج'], ['machine', 'Machine name', 'بيانات المنتج'],
  ['pcs_per_shot', 'piece / shot', 'بيانات المنتج'], ['weight_g', 'Weight (g)', 'بيانات المنتج'],
  ['mat_name', "Mat'l name", 'الخامة'], ['mat_code', "Mat'l code", 'الخامة'], ['mat_full_name', "Mat'l name (full)", 'الخامة'],
  ['ratio', 'Ratio', 'الخامة'], ['masterbatch', 'Masterbatch', 'الخامة'], ['mb_pct', 'Masterbatch %', 'الخامة'],
  ['mold_h', 'Mold height (mm)', 'الإسطمبة'], ['mold_w', 'Mold wide (mm)', 'الإسطمبة'], ['mold_l', 'Mold long (mm)', 'الإسطمبة'],
  ['box_name', 'box name', 'التغليف'], ['box_l', 'box long (in)', 'التغليف'], ['box_w', 'box wide (in)', 'التغليف'], ['box_h', 'box hight (in)', 'التغليف'],
  ['box_pcs', 'piece / box', 'التغليف'], ['packing', 'packing', 'التغليف'], ['partition_no', 'partition no', 'التغليف'], ['partition_unit', 'partition / unit', 'التغليف'],
  ['bag_size', 'bag size', 'التغليف'], ['bag_thickness', 'bag thickness', 'التغليف'], ['bag_pcs', 'bag piece', 'التغليف'],
  ...Array.from({ length: COMPONENTS }, (x, i) => [[`c${i + 1}`, `Component ${i + 1}`, 'المكونات'], [`c${i + 1}_q`, `Component ${i + 1} piece / unit`, 'المكونات']]).flat(),
  ...Array.from({ length: 3 }, (x, i) => [['desc', 'description'], ['mat', 'MAT'], ['cavity', 'cavity / shot'], ['mold_size', 'mold size'], ['wip', 'WIP code']]
    .map(([k, h]) => [`i${i + 1}_${k}`, `Item ${i + 1} ${h}`, 'الأصناف'])).flat(),
  ...VARIANTS.map((v) => [[`${v}_desc`, `${v} description`, 'الموديلات'], [`${v}_fg`, `${v} FG CODE`, 'الموديلات'], [`${v}_oem`, `${v} OEM NO.`, 'الموديلات']]).flat(),
  ['inj_price', 'INJ PRICE', 'أخرى'], ['revision', 'REVISION', 'أخرى'],
  ['main_mat', 'خامة المخزن - الخامة الأساسية', 'الربط بالمخزن'], ['mb_mat', 'خامة المخزن - الماستر باتش', 'الربط بالمخزن'],
  ['runner_g', 'وزن الرنر للضربة (جرام)', 'الربط بالمخزن'], ['scrap_pct', 'نسبة الفاقد %', 'الربط بالمخزن'],
  ['box_mat', 'خامة المخزن - البوكس', 'الربط بالمخزن'], ['bag_mat', 'خامة المخزن - الكيس', 'الربط بالمخزن'], ['bag_qty', 'الكيس - الكمية للقطعة', 'الربط بالمخزن'],
  ['partition_mat', 'خامة المخزن - البارتيشن', 'الربط بالمخزن'], ['partition_qty', 'البارتيشن - الكمية للقطعة', 'الربط بالمخزن'],
];

module.exports = { VARIANTS, ITEMS, COMPONENTS, NOTES, HEAD_A, HEAD_C, empty, normalize, parseSheet, bomFromCard, num, getCard, saveCard, generateFromCard, SHEET_COLS };
