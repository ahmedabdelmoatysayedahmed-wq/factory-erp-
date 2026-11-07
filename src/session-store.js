// حفظ جلسات الدخول في قاعدة البيانات علشان محدش يخرج لما السيرفر يعيد التشغيل
const session = require('express-session');

class SqliteStore extends session.Store {
  constructor(db) {
    super();
    db.exec('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL)');
    this.q = {
      get: db.prepare('SELECT data FROM sessions WHERE sid=? AND expires>?'),
      set: db.prepare('INSERT INTO sessions (sid, data, expires) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expires=excluded.expires'),
      touch: db.prepare('UPDATE sessions SET expires=? WHERE sid=?'),
      del: db.prepare('DELETE FROM sessions WHERE sid=?'),
      prune: db.prepare('DELETE FROM sessions WHERE expires<=?'),
    };
    setInterval(() => this.q.prune.run(Date.now()), 3600e3).unref();
  }
  exp(s) { return s.cookie && s.cookie.expires ? new Date(s.cookie.expires).getTime() : Date.now() + 864e5; }
  get(sid, cb) { try { const r = this.q.get.get(sid, Date.now()); cb(null, r ? JSON.parse(r.data) : null); } catch (e) { cb(e); } }
  set(sid, s, cb) { try { this.q.set.run(sid, JSON.stringify(s), this.exp(s)); cb && cb(null); } catch (e) { cb && cb(e); } }
  touch(sid, s, cb) { try { this.q.touch.run(this.exp(s), sid); cb && cb(null); } catch (e) { cb && cb(e); } }
  destroy(sid, cb) { try { this.q.del.run(sid); cb && cb(null); } catch (e) { cb && cb(e); } }
}
module.exports = SqliteStore;
