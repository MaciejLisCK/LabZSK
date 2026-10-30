// Attempts opened with links signed by Lab Manager: one attempt per student and task, a single browser
// session, the step log with its synchronisation, the live simulator state and the final log.

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { transaction } from './db.js';
import { buildLog } from './logfile.js';

export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const random = () => crypto.randomBytes(32).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

const MAX_EVENTS_PER_SYNC = 500;
const MAX_EVENT_TEXT = 64 * 1024;
const MAX_STATE = 512 * 1024;

export const LINK_PARAMS = ['user', 'course', 'session', 'task'];
const PARAM = /^[A-Za-z0-9_-]{1,64}$/;

/** Text signed in a task link: user=17&course=8&session=11&task=26. */
export function linkMessage(p) {
  return LINK_PARAMS.map((k) => `${k}=${p[k]}`).join('&');
}

export function linkSignature(secret, p) {
  return crypto.createHmac('sha256', secret).update(linkMessage(p), 'utf8').digest('hex');
}

export function linkParams(input) {
  const p = {};
  for (const k of LINK_PARAMS) {
    const v = String(input?.[k] ?? '');
    if (!PARAM.test(v)) throw new ApiError(400, 'invalid_link', 'Link do zadania jest niepełny lub nieprawidłowy.');
    p[k] = v;
  }
  return p;
}

export class Attempts {
  constructor(db, config) {
    this.db = db;
    this.config = config;
    this.bus = new EventEmitter();
    this.bus.setMaxListeners(0);
  }

  // ---------------------------------------------------------------- shared secret
  secret() {
    return this.db.prepare("SELECT value FROM settings WHERE key = 'secret'").get()?.value ?? null;
  }

  setSecret(value) {
    const secret = value == null || value === '' ? crypto.randomBytes(32).toString('hex') : String(value).trim();
    if (secret.length < 32 || /\s/.test(secret)) throw new ApiError(400, 'invalid', 'Sekret musi mieć co najmniej 32 znaki, bez spacji.');
    this.db.prepare("INSERT INTO settings (key, value) VALUES ('secret', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(secret);
    return secret;
  }

  requireSecret() {
    const secret = this.secret();
    if (!secret) throw new ApiError(503, 'not_configured', 'LabZSK nie ma jeszcze ustawionego sekretu – prowadzący ustawia go w panelu (Ustawienia).');
    return secret;
  }

  /** Checks the link signature and returns its parameters. */
  checkLink(input) {
    const p = linkParams(input);
    const expected = Buffer.from(linkSignature(this.requireSecret(), p), 'hex');
    const given = Buffer.from(/^[0-9a-f]{64}$/i.test(input?.sig ?? '') ? input.sig.toLowerCase() : '', 'hex');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      throw new ApiError(403, 'invalid_link', 'Link do zadania ma nieprawidłowy podpis.');
    }
    return p;
  }

  /** Signed link for the given parameters (Lab Manager builds the same one). */
  link(baseUrl, input) {
    const p = linkParams(input);
    return `${baseUrl}/?${linkMessage(p)}&sig=${linkSignature(this.requireSecret(), p)}`;
  }

  // ---------------------------------------------------------------- attempts
  get(id) {
    return this.db.prepare('SELECT * FROM attempts WHERE id = ?').get(String(id ?? ''));
  }

  require(id) {
    const a = this.get(id);
    if (!a) throw new ApiError(404, 'cleared', 'Nie ma takiego podejścia (mogło zostać wyczyszczone przez prowadzącego).');
    return a;
  }

  audit(attemptId, kind, detail = null) {
    this.db.prepare('INSERT INTO audit (attempt_id, at, kind, detail) VALUES (?, ?, ?, ?)').run(attemptId, Date.now(), kind, detail);
  }

  info(a, extra = {}) {
    return { attemptId: a.id, user: a.user_id, course: a.course, session: a.lab_session, task: a.task, status: a.status, lastSeq: a.last_seq, ...extra };
  }

  /**
   * Opens the attempt of a signed link. No attempt yet: a new one. An attempt of this browser
   * (sessionKey): continued. Started in another browser, or finished elsewhere: refused.
   */
  open(input) {
    const p = this.checkLink(input);
    return transaction(this.db, () => {
      const a = this.db.prepare('SELECT * FROM attempts WHERE user_id = ? AND course = ? AND lab_session = ? AND task = ?')
        .get(p.user, p.course, p.session, p.task);
      const now = Date.now();
      if (!a) {
        const id = crypto.randomUUID();
        const sessionKey = random();
        const offline = input.offlineStart === true;
        const startedAt = offline && Number(input.startedAt) < now ? Number(input.startedAt) : now;
        this.db.prepare(`INSERT INTO attempts (id, user_id, course, lab_session, task, status, session_hash, offline_start, created_at, last_seen)
          VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`).run(id, p.user, p.course, p.session, p.task, sha256(sessionKey), offline ? 1 : 0, startedAt, now);
        this.audit(id, offline ? 'offline_start' : 'opened');
        this.bus.emit('change', id, []);
        return this.info(this.get(id), { mode: 'new', sessionKey });
      }
      if (input.sessionKey && a.session_hash === sha256(input.sessionKey)) {
        this.db.prepare('UPDATE attempts SET last_seen = ? WHERE id = ?').run(now, a.id);
        if (a.status === 'active') this.audit(a.id, 'continued');
        this.bus.emit('change', a.id, []);
        return this.info(this.get(a.id), { mode: 'continue' });
      }
      this.audit(a.id, 'denied', input.offlineStart ? 'start offline w innej przeglądarce' : 'inna przeglądarka lub komputer');
      this.bus.emit('change', a.id, []);
      if (a.status === 'finished') throw new ApiError(409, 'finished', 'To zadanie zostało już zakończone.');
      throw new ApiError(409, 'used', 'To zadanie jest już otwarte w innej przeglądarce lub na innym komputerze.');
    });
  }

  session(attemptId, sessionKey) {
    const a = this.require(attemptId);
    if (!a.session_hash || sha256(sessionKey ?? '') !== a.session_hash) {
      throw new ApiError(401, 'session', 'To zadanie jest otwarte w innej przeglądarce.');
    }
    return a;
  }

  /** Accepts the next steps in order (duplicates skipped, a gap stops the batch) and the live state. */
  sync({ attemptId, sessionKey, events = [], state, sentAt }) {
    if (!Array.isArray(events) || events.length > MAX_EVENTS_PER_SYNC) throw new ApiError(400, 'invalid', 'Za dużo zdarzeń.');
    const sent = Number(sentAt) || Date.now();
    return transaction(this.db, () => {
      const a = this.session(attemptId, sessionKey);
      const now = Date.now();
      const accepted = [];
      let status = a.status;
      let { last_seq: lastSeq, mistakes, cycles } = a;
      let gap = false;
      const insert = this.db.prepare(`INSERT INTO events (attempt_id, seq, kind, text, client_ts, received_at, offline)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const e of [...events].sort((x, y) => x.seq - y.seq)) {
        const seq = Number(e.seq);
        if (!Number.isInteger(seq) || seq <= lastSeq) continue;
        if (seq !== lastSeq + 1) {
          gap = true;
          break;
        }
        if (status === 'finished') break;
        const kind = e.kind === 'finish' ? 'finish' : 'log';
        const text = String(e.text ?? '').slice(0, MAX_EVENT_TEXT);
        const ts = Number(e.ts) || now;
        const offline = e.offline === true || sent - ts > this.config.offlineAfterSeconds * 1000 ? 1 : 0;
        insert.run(a.id, seq, kind, text, ts, now, offline);
        accepted.push({ seq, kind, text, client_ts: ts, received_at: now, offline });
        lastSeq = seq;
        if (Number.isInteger(e.mistakes) && e.mistakes >= 0) mistakes = Math.max(mistakes, e.mistakes); // never goes down within an attempt
        if (Number.isInteger(e.cycle) && e.cycle >= 0) cycles = e.cycle;
        if (kind === 'finish') {
          status = 'finished';
          this.audit(a.id, 'finished', offline ? 'zgłoszone po przerwie w połączeniu' : null);
        }
      }
      const offlineCount = accepted.filter((e) => e.offline).length;
      this.db.prepare(`UPDATE attempts SET last_seq = ?, mistakes = ?, cycles = ?, status = ?, last_seen = ?,
        offline_events = offline_events + ?, finished_at = CASE WHEN ? = 'finished' AND finished_at IS NULL THEN ? ELSE finished_at END
        WHERE id = ?`).run(lastSeq, mistakes, cycles, status, now, offlineCount, status, now, a.id);
      let delta = null;
      if (state && typeof state === 'object' && !Array.isArray(state)) {
        const merged = { ...(a.state ? JSON.parse(a.state) : {}), ...state, at: now };
        const json = JSON.stringify(merged);
        if (json.length <= MAX_STATE) {
          this.db.prepare('UPDATE attempts SET state = ? WHERE id = ?').run(json, a.id);
          delta = { ...state, at: now };
        }
      }
      this.bus.emit('change', a.id, accepted);
      if (delta) this.bus.emit('state', a.id, delta);
      return { lastSeq, status, gap, accepted: accepted.length };
    });
  }

  events(attemptId, afterSeq = 0) {
    return this.db.prepare('SELECT seq, kind, text, client_ts, received_at, offline FROM events WHERE attempt_id = ? AND seq > ? ORDER BY seq')
      .all(attemptId, afterSeq);
  }

  auditTrail(attemptId) {
    return this.db.prepare('SELECT at, kind, detail FROM audit WHERE attempt_id = ? ORDER BY id').all(attemptId);
  }

  state(attemptId) {
    const a = this.require(attemptId);
    return a.state ? JSON.parse(a.state) : null;
  }

  finalLog(attemptId) {
    const a = this.require(attemptId);
    return buildLog(this.requireSecret(), a, this.events(a.id), this.auditTrail(a.id));
  }

  /** Teacher: removes the attempt with its log; opening the link again starts from scratch. */
  clear(attemptId) {
    this.require(attemptId);
    this.db.prepare('DELETE FROM attempts WHERE id = ?').run(attemptId);
    this.bus.emit('removed', attemptId);
  }

  summary(a) {
    return {
      id: a.id,
      user: a.user_id,
      course: a.course,
      session: a.lab_session,
      task: a.task,
      status: a.status,
      createdAt: a.created_at,
      finishedAt: a.finished_at,
      lastSeen: a.last_seen,
      online: a.status === 'active' && a.last_seen != null && Date.now() - a.last_seen < this.config.onlineSeconds * 1000,
      offlineStart: Boolean(a.offline_start),
      events: a.last_seq,
      offlineEvents: a.offline_events,
      mistakes: a.mistakes,
      cycles: a.cycles,
    };
  }

  list() {
    return this.db.prepare('SELECT * FROM attempts ORDER BY COALESCE(last_seen, created_at) DESC LIMIT 2000').all().map((a) => this.summary(a));
  }
}
