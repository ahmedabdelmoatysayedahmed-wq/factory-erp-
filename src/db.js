const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbFile = process.env.DB_FILE || path.join(dataDir, 'factory.db');
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  full_name TEXT, role TEXT NOT NULL, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT NOT NULL, job_title TEXT, department TEXT,
  phone TEXT, hire_date TEXT, daily_target REAL, annual_leave_balance REAL DEFAULT 21,
  status TEXT DEFAULT 'active', notes TEXT);
CREATE TABLE IF NOT EXISTS machines (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT NOT NULL, type TEXT, location TEXT,
  hourly_capacity REAL, status TEXT DEFAULT 'running', notes TEXT);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT NOT NULL, unit TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS molds (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT NOT NULL, product_id INTEGER REFERENCES products(id),
  cavities INTEGER DEFAULT 1, status TEXT DEFAULT 'available', location TEXT,
  initial_shots INTEGER DEFAULT 0, maintenance_every INTEGER, last_maintenance TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT NOT NULL, category TEXT, location TEXT,
  purchase_date TEXT, purchase_cost REAL, supplier TEXT, custodian_id INTEGER REFERENCES employees(id),
  status TEXT DEFAULT 'in_service', notes TEXT);
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT NOT NULL, unit TEXT, min_stock REAL DEFAULT 0,
  unit_cost REAL, supplier TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, material_id INTEGER NOT NULL REFERENCES materials(id),
  type TEXT NOT NULL, qty REAL NOT NULL, order_id INTEGER REFERENCES production_orders(id),
  reference TEXT, notes TEXT, user_id INTEGER);
CREATE TABLE IF NOT EXISTS production_orders (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, product_id INTEGER NOT NULL REFERENCES products(id),
  qty_planned REAL NOT NULL, start_date TEXT, due_date TEXT, status TEXT DEFAULT 'open', notes TEXT);
CREATE TABLE IF NOT EXISTS production_logs (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, shift TEXT, employee_id INTEGER REFERENCES employees(id),
  machine_id INTEGER REFERENCES machines(id), mold_id INTEGER REFERENCES molds(id),
  order_id INTEGER REFERENCES production_orders(id), product_id INTEGER REFERENCES products(id),
  qty_produced REAL DEFAULT 0, qty_scrap REAL DEFAULT 0, hours_worked REAL DEFAULT 0,
  downtime_minutes REAL DEFAULT 0, downtime_reason TEXT, notes TEXT, user_id INTEGER);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), date TEXT NOT NULL,
  check_in TEXT, check_out TEXT, status TEXT NOT NULL, notes TEXT, UNIQUE(employee_id, date));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS leaves (
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), type TEXT NOT NULL,
  from_date TEXT NOT NULL, to_date TEXT NOT NULL, days REAL, status TEXT DEFAULT 'pending', reason TEXT);
`);

if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)')
    .run('admin', bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10), 'مدير النظام', 'admin');
}

// الإعدادات الافتراضية: الجمعة راحة أسبوعية، وقسم الإجازات مقفول
const defaults = { weekly_off: '5', leaves_enabled: '0' };
for (const [k, v] of Object.entries(defaults)) db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(k, v);

db.getSettings = () => {
  const s = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  return {
    weeklyOff: (s.weekly_off || '').split(',').filter(Boolean).map(Number), // 0 = الأحد ... 5 = الجمعة، 6 = السبت
    leavesEnabled: s.leaves_enabled === '1',
  };
};
db.setSetting = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
// هل التاريخ ده يوم راحة أسبوعية؟
db.isOffDay = (date, settings = db.getSettings()) => settings.weeklyOff.includes(new Date(date + 'T00:00:00Z').getUTCDay());

// نسخة احتياطية يومية (أول تشغيل في اليوم) - بنحتفظ بآخر 30 نسخة
if (!process.env.NO_BACKUP) {
  const dir = path.join(path.dirname(dbFile), 'backups');
  const file = path.join(dir, `factory-${new Date().toISOString().slice(0, 10)}.db`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    db.backup(file).then(() => {
      const old = fs.readdirSync(dir).filter((f) => /^factory-.*\.db$/.test(f)).sort().slice(0, -30);
      old.forEach((f) => fs.unlinkSync(path.join(dir, f)));
    }).catch((e) => console.error('Backup failed:', e.message));
  }
}

module.exports = db;
