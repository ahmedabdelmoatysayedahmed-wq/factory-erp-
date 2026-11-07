// قاعدة بيانات قديمة فيها الموظفين الوهميين بس => بتتحدث لقائمة موظفين المصنع مرة واحدة عند التشغيل
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');

test('old fake demo employees are replaced by the factory roster on startup', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-m-'));
  process.env.DB_FILE = path.join(tmp, 'old.db'); process.env.NO_BACKUP = '1';
  const db = require('../src/db');
  ['محمد علي', 'أحمد حسن'].forEach((n, i) => db.prepare('INSERT INTO employees (code, name) VALUES (?, ?)').run('E0' + (i + 1), n));
  require('../src/app');
  const names = db.prepare('SELECT name FROM employees').all().map((r) => r.name);
  assert.equal(names.length, 16);
  assert.ok(names.includes('يوسف احمد عبدالمعطى'));
  assert.ok(db.prepare('SELECT COUNT(*) c FROM production_logs').get().c > 0);
  assert.equal(db.getSetting('roster_v1'), '1');
});
