// Teacher accounts (scrypt password hashes) and panel sessions.

import crypto from 'node:crypto';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function checkPassword(password, stored) {
  const [kind, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export function setTeacher(db, login, password) {
  db.prepare(`INSERT INTO teachers (login, password_hash, created_at) VALUES (?, ?, ?)
    ON CONFLICT (login) DO UPDATE SET password_hash = excluded.password_hash`).run(login, hashPassword(password), Date.now());
}

const SESSION_HOURS = 12;

export class TeacherAuth {
  constructor(db) {
    this.db = db;
    this.sessions = new Map(); // sid -> { login, expires }
    this.failures = new Map(); // ip -> { count, until }
  }

  /** Creates the first account from the configuration when there is none. */
  ensureAccount(login, password) {
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM teachers').get().n;
    if (count > 0) return null;
    const generated = !password;
    const pass = password || crypto.randomBytes(9).toString('base64url');
    setTeacher(this.db, login, pass);
    return { login, password: generated ? pass : null };
  }

  blocked(ip) {
    const f = this.failures.get(ip);
    return f && f.count >= 5 && f.until > Date.now();
  }

  login(login, password, ip) {
    if (this.blocked(ip)) return { error: 'blocked' };
    const row = this.db.prepare('SELECT * FROM teachers WHERE login = ?').get(String(login ?? ''));
    if (!row || !checkPassword(password ?? '', row.password_hash)) {
      const f = this.failures.get(ip) ?? { count: 0, until: 0 };
      f.count = f.until > Date.now() ? f.count + 1 : 1;
      f.until = Date.now() + 10 * 60 * 1000;
      this.failures.set(ip, f);
      return { error: 'invalid' };
    }
    this.failures.delete(ip);
    const sid = crypto.randomBytes(32).toString('base64url');
    this.sessions.set(sid, { login: row.login, expires: Date.now() + SESSION_HOURS * 3600 * 1000 });
    return { sid, login: row.login, maxAge: SESSION_HOURS * 3600 };
  }

  check(sid) {
    const s = sid && this.sessions.get(sid);
    if (!s) return null;
    if (s.expires < Date.now()) {
      this.sessions.delete(sid);
      return null;
    }
    return s.login;
  }

  logout(sid) {
    this.sessions.delete(sid);
  }
}
