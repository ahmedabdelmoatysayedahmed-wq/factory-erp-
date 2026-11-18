// إرسال تقرير الوردية بالإيميل أوتوماتيك بعد ما كل وردية تخلص (نهاري / ليلي)
// الإعدادات (SMTP والمستلمين) متخزنة في قاعدة البيانات على جهاز المصنع، مش في الكود
const nodemailer = require('nodemailer');
const SH = require('./shifts');
const { getAlerts } = require('./stock');

const cfg = (db) => ({
  enabled: db.getSetting('mail_enabled') === '1',
  to: (db.getSetting('mail_to') || '').split(/[,;\s]+/).filter((x) => /@/.test(x)),
  host: db.getSetting('mail_host') || 'smtp.gmail.com',
  port: Number(db.getSetting('mail_port') || 465),
  user: db.getSetting('mail_user') || '',
  pass: db.getSetting('mail_pass') || '',
});

let lastTestMessage = null; // للاختبارات (MAIL_TEST=1)
function transport(c) {
  if (process.env.MAIL_TEST) return nodemailer.createTransport({ jsonTransport: true });
  return nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass } });
}
async function send(db, { subject, html, text }) {
  const c = cfg(db);
  if (!c.to.length) throw new Error('مفيش إيميل مستلم');
  if (!process.env.MAIL_TEST && (!c.user || !c.pass)) throw new Error('بيانات حساب الإرسال ناقصة');
  const info = await transport(c).sendMail({ from: `"إدارة المصنع" <${c.user || 'factory@localhost'}>`, to: c.to.join(', '), subject, html, text });
  if (process.env.MAIL_TEST) lastTestMessage = { subject, html, text, to: c.to };
  return info;
}

// ---------- تقرير الوردية ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (x) => Number(Number(x || 0).toFixed(1)).toLocaleString('en');
const TD = 'style="border:1px solid #cfd5df;padding:5px 8px;text-align:right"';
const TH = 'style="border:1px solid #cfd5df;padding:5px 8px;background:#eef2f7;text-align:right"';
const table = (head, rows) => `<table style="border-collapse:collapse;width:100%;margin:6px 0 14px;font-size:13px"><tr>${head.map((h) => `<th ${TH}>${esc(h)}</th>`).join('')}</tr>${rows.join('') || `<tr><td ${TD} colspan="${head.length}">—</td></tr>`}</table>`;

function buildShiftReport(db, date, half) {
  const from = half === 'day' ? 0 : 12, to = from + 11;
  const label = half === 'day' ? 'الوردية النهاري' : 'الوردية الليلي';
  const h0 = SH.startHour(db) + from;
  const range = `${SH.hour12(h0 % 24)} → ${SH.hour12((h0 + 12) % 24)}`;
  const sheets = db.prepare(`SELECT s.*, m.code mcode, m.name mname, p.name pname, p.code pcode,
      w.name wname, t.name tname FROM shift_sheets s JOIN machines m ON m.id=s.machine_id LEFT JOIN products p ON p.id=s.product_id
      LEFT JOIN employees w ON w.id=CASE WHEN ?='day' THEN s.day_worker_id ELSE s.night_worker_id END
      LEFT JOIN employees t ON t.id=CASE WHEN ?='day' THEN s.day_tech_id ELSE s.night_tech_id END WHERE s.date=? ORDER BY m.code`).all(half, half, date);
  let tq = 0, ts = 0, tm = 0, td = 0;
  const mRows = [], detail = [], missedList = [], downs = [];
  for (const sh of sheets) {
    const hs = db.prepare(`SELECT h.*, e.name ename FROM hourly_logs h LEFT JOIN employees e ON e.id=h.employee_id WHERE h.sheet_id=? AND h.slot BETWEEN ? AND ? ORDER BY h.slot`).all(sh.id, from, to);
    const q = hs.reduce((a, h) => a + (h.qty || 0), 0), s = hs.reduce((a, h) => a + (h.scrap || 0), 0);
    const missed = hs.filter((h) => h.status === 'missed'), ok = hs.filter((h) => h.status !== 'missed').length;
    const dt = db.prepare('SELECT * FROM sheet_downtimes WHERE sheet_id=? AND slot BETWEEN ? AND ?').all(sh.id, from, to);
    const dmin = dt.reduce((a, d) => a + (d.minutes || 0), 0);
    tq += q; ts += s; tm += missed.length; td += dmin;
    mRows.push(`<tr><td ${TD}><b>${esc(sh.mcode)}</b> ${esc(sh.mname)}</td><td ${TD}>${esc(sh.pname || '—')}</td><td ${TD}>${esc(sh.wname || '—')}${sh.tname ? ' / ' + esc(sh.tname) : ''}</td>
      <td ${TD}><b>${n(q)}</b></td><td ${TD}>${n(s)}</td><td ${TD}>${ok}</td><td ${TD}${missed.length ? ' style="border:1px solid #cfd5df;padding:5px 8px;color:#c0392b;font-weight:700"' : ''}>${missed.length}</td><td ${TD}>${n(dmin)}</td></tr>`);
    for (const m of missed) { const h = (SH.startHour(db) + m.slot) % 24; missedList.push(`<li>${esc(sh.mcode)}: ${SH.hour12(h)} → ${SH.hour12(h + 1)} (${esc(m.ename || '—')})</li>`); }
    for (const d of dt) downs.push(`<tr><td ${TD}>${esc(sh.mcode)}</td><td ${TD}>${esc(d.from_time)}</td><td ${TD}>${esc(d.to_time)}</td><td ${TD}>${n(d.minutes)}</td><td ${TD}>${esc(d.reason)}</td></tr>`);
    detail.push(`<h4 style="margin:12px 0 4px">${esc(sh.mcode)} ${esc(sh.mname)} — ${esc(sh.pname || '')}</h4>` + table(['من', 'إلى', 'الإنتاج', 'التوالف', 'العامل', 'زمن الدورة', 'الحالة'],
      Array.from({ length: 12 }, (x, k) => {
        const h = hs.find((r) => r.slot === from + k), hr = (SH.startHour(db) + from + k) % 24;
        const st = !h ? '—' : h.status === 'missed' ? '⛔ ماشتغلش' : h.status === 'edited' ? 'اتعدّل من المشرف' : '✓';
        return `<tr><td ${TD}>${SH.hour12(hr)}</td><td ${TD}>${SH.hour12(hr + 1)}</td><td ${TD}>${h ? n(h.qty) : ''}</td><td ${TD}>${h ? n(h.scrap) : ''}</td><td ${TD}>${esc(h ? h.ename || '' : '')}</td><td ${TD}>${h && h.cycle_time ? n(h.cycle_time) : ''}</td><td ${TD}>${st}</td></tr>`;
      })));
  }
  const a = getAlerts(db, { fresh: true });
  const scrapPct = tq + ts ? (ts * 100) / (tq + ts) : 0;
  const subject = `تقرير ${label} - ${date} - إنتاج ${n(tq)}${tm ? ` - ${tm} ساعة ماتسجلتش` : ''}`;
  const kpi = (v, l, c = '#1d2533') => `<td style="padding:10px 14px;border:1px solid #e3e7ee;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700;color:${c}">${v}</div><div style="font-size:12px;color:#6b7585">${l}</div></td>`;
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;color:#1d2533;max-width:900px">
  <h2 style="margin:0 0 4px">🏭 تقرير ${label}</h2><div style="color:#6b7585;margin-bottom:12px">${esc(date)} — من ${range}</div>
  <table style="border-collapse:separate;border-spacing:6px;margin-bottom:10px"><tr>${kpi(n(tq), 'الإنتاج السليم', '#1b8a4b')}${kpi(`${n(ts)} (${scrapPct.toFixed(1)}%)`, 'التوالف', '#c0392b')}
  ${kpi(tm, 'ساعات ماتسجلتش', tm ? '#c0392b' : '#1d2533')}${kpi(n(td), 'دقايق توقف')}${kpi(sheets.length, 'ماكينات')}</tr></table>
  <h3>الماكينات</h3>${table(['الماكينة', 'المنتج', 'العامل / الفني', 'الإنتاج', 'التوالف', 'ساعات متسجلة', 'ساعات ماتسجلتش', 'دقايق توقف'], mRows)}
  ${missedList.length ? `<h3 style="color:#c0392b">⛔ ساعات اتقفلت ماتسجلتش (اتحسبت ماشتغلش)</h3><ul>${missedList.join('')}</ul>` : ''}
  ${downs.length ? `<h3>التوقفات</h3>${table(['الماكينة', 'من', 'إلى', 'الدقايق', 'السبب'], downs)}` : ''}
  <h3>🔔 التنبيهات دلوقتي</h3><ul>
    <li>منتجات محتاجة إنتاج: <b>${a.products.length}</b>${a.products.length ? ' — ' + a.products.slice(0, 8).map((p) => esc(p.name)).join('، ') : ''}</li>
    <li>مواد خام وصلت لحد الطلب: <b>${a.materials.length}</b>${a.materials.length ? ' — ' + a.materials.slice(0, 8).map((m) => esc(m.name)).join('، ') : ''}</li>
    <li>أوامر صيانة مفتوحة: <b>${a.maintenance.length}</b></li></ul>
  <h3>تفاصيل الساعات</h3>${detail.join('') || '<p>مفيش محاضر للوردية دي</p>'}
  <p style="color:#6b7585;font-size:12px;margin-top:18px">اتبعت أوتوماتيك من برنامج إدارة المصنع.</p></div>`;
  const text = `تقرير ${label} - ${date}\nالإنتاج: ${n(tq)} | التوالف: ${n(ts)} | ساعات ماتسجلتش: ${tm} | دقايق توقف: ${n(td)} | ماكينات: ${sheets.length}`;
  return { subject, html, text, sheets: sheets.length };
}

// كل دقيقة: لو وردية خلصت (+ دقايق التسجيل) ولسه تقريرها ماتبعتش => ابعته (مرة واحدة)
let retryAt = 0;
async function sendDueReports(db, at = SH.now()) {
  const c = cfg(db);
  if (!c.enabled || !c.to.length || at.getTime() < retryAt) return 0;
  let sent = 0;
  const today = SH.currentSheetDate(db, at);
  const [y, m, dd] = today.split('-').map(Number);
  const yesterday = SH.localDate(new Date(y, m - 1, dd - 1));
  for (const date of [...new Set([yesterday, today])]) {
    for (const half of ['day', 'night']) {
      const end = SH.slotEnd(db, date, half === 'day' ? 11 : 23).getTime() + (SH.windowMin(db) + 1) * 60e3;
      const key = `mail_sent_${date}_${half}`;
      if (at.getTime() < end || at.getTime() - end > 864e5 || db.getSetting(key)) continue;
      const r = buildShiftReport(db, date, half);
      if (!r.sheets) { db.setSetting(key, 'no-sheets'); continue; }
      try {
        await send(db, r);
        db.setSetting(key, SH.localStamp(at)); db.setSetting('mail_last_error', ''); db.setSetting('mail_last_sent', `${SH.localStamp(at)} — ${r.subject}`);
        sent++;
      } catch (e) {
        db.setSetting('mail_last_error', `${SH.localStamp(at)} — ${e.message}`);
        retryAt = at.getTime() + 15 * 60e3; // نحاول تاني بعد ربع ساعة
        return sent;
      }
    }
  }
  return sent;
}

module.exports = { cfg, send, buildShiftReport, sendDueReports, lastTest: () => lastTestMessage, resetRetry: () => { retryAt = 0; } };
