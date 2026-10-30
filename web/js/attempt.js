// Lab task opened from a Lab Manager link (?user=&course=&session=&task=&sig=): session with the LabZSK
// server, local copy of the work (IndexedDB), live step log with an offline queue, live simulator state
// for the teacher, finishing and the final log. Without these parameters the simulator runs in free
// learning mode and never contacts the server.

import { load, save } from './store.js';

const SESSIONS_KEY = 'labzsk:sessions';
const CHANNEL = 'labzsk-attempts';
const SYNC_EVERY = 2000;
const HEARTBEAT = 10000;
const STATE_EVERY = 1500;
const REQUEST_TIMEOUT = 8000;
const BATCH = 200;
export const LINK_PARAMS = ['user', 'course', 'session', 'task'];

const metaKey = (key) => `labzsk:a:${key}:meta`;
const queueKey = (key) => `labzsk:a:${key}:queue`;
export const stateKey = (key) => `labzsk:a:${key}:state`;

/** Tasks held by this browser (for links to unfinished tasks). */
export async function localSessions() {
  return ((await load(SESSIONS_KEY)) ?? []).filter((s) => s && s.key);
}

async function saveSessionIndex(meta) {
  const list = (await localSessions()).filter((s) => s.key !== meta.key);
  list.push({ key: meta.key, link: meta.link, course: meta.course, session: meta.session, task: meta.task, finished: meta.finished });
  save(SESSIONS_KEY, list);
}

class HttpError extends Error {
  constructor(status, body) {
    super(body?.message ?? `HTTP ${status}`);
    this.status = status;
    this.body = body ?? {};
  }
}

async function post(url, body, { raw = false } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch { /* not JSON */ }
    throw new HttpError(res.status, data);
  }
  return raw ? res.text() : res.json();
}

// a proxy's 502/503/504 also means the LabZSK server is unreachable
const isNetwork = (e) => !(e instanceof HttpError) || (e.status >= 500 && e.body.error !== 'not_configured');

/** Reason shown to the student for a refusal of the server. */
function refusal(e) {
  if (e.status === 409) return e.body.error === 'finished' ? 'finished' : 'used';
  if (e.status === 503) return 'not-configured';
  if (e.status === 404) return 'cleared';
  if (e.status === 401) return 'session-elsewhere';
  return 'invalid';
}

/** Another tab of this browser already working on the task answers the probe. */
function otherTabHas(key) {
  if (typeof BroadcastChannel === 'undefined') return Promise.resolve(false);
  const ch = new BroadcastChannel(CHANNEL);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ch.close();
      resolve(false);
    }, 350);
    ch.onmessage = (e) => {
      if (e.data?.type === 'busy' && e.data.key === key) {
        clearTimeout(timer);
        ch.close();
        resolve(true);
      }
    };
    ch.postMessage({ type: 'probe', key });
  });
}

function holdTab(key) {
  if (typeof BroadcastChannel === 'undefined') return;
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e) => {
    if (e.data?.type === 'probe' && e.data.key === key) ch.postMessage({ type: 'busy', key });
  };
}

export class Attempt {
  constructor(meta, queue, fresh) {
    this.meta = meta;
    this.queue = queue;
    this.fresh = fresh; // nothing of this attempt is stored in the browser yet
    this.connection = 'connecting';
    this.blocked = null;
    this.pending = '';
    this.listeners = new Set();
    this.lastContact = 0;
    this.stateDirty = true;
    this.stateAt = 0;
    this.sentMemory = { pm: null, po: null };
    this.state = () => ({ mistakes: 0, cycle: 0, live: null, pm: null, po: null });
    this.wasOffline = false;
    this.deliveredOffline = 0;
  }

  get key() { return this.meta.key; }
  get finished() { return Boolean(this.meta.finished); }
  get stateKey() { return stateKey(this.key); }
  get unsent() { return this.queue.length + (this.pending ? 1 : 0); }

  onChange(fn) {
    this.listeners.add(fn);
  }

  emit(what) {
    for (const fn of this.listeners) fn(what, this);
  }

  save() {
    save(metaKey(this.key), this.meta);
    save(queueKey(this.key), this.queue);
    saveSessionIndex(this.meta);
  }

  setConnection(c) {
    if (this.connection === c) return;
    const before = this.connection;
    this.connection = c;
    if (c === 'offline') this.wasOffline = true;
    this.emit({ type: 'connection', before, after: c });
  }

  block(reason) {
    if (this.blocked) return;
    this.blocked = reason;
    clearInterval(this.timer);
    this.emit({ type: 'blocked', reason });
  }

  /** Called with every piece of text appended to the simulator log. */
  record(text) {
    if (this.blocked || this.finished) return;
    this.pending += text;
    clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => this.commit(), 250);
  }

  enqueue(kind, text) {
    const { mistakes, cycle } = this.state();
    this.meta.seq += 1;
    this.queue.push({ seq: this.meta.seq, kind, text, ts: Date.now(), offline: this.connection === 'offline', mistakes, cycle });
    this.save();
  }

  /** Turns the buffered log text into one queued step. */
  commit() {
    clearTimeout(this.pendingTimer);
    if (!this.pending) return;
    const text = this.pending;
    this.pending = '';
    this.enqueue('log', text);
    this.scheduleSync();
  }

  stateChanged() {
    this.stateDirty = true;
  }

  scheduleSync() {
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.sync(), 400);
  }

  start(state) {
    this.state = state;
    holdTab(this.key);
    this.timer = setInterval(() => {
      const due = Date.now() - this.lastContact > HEARTBEAT || (this.stateDirty && Date.now() - this.stateAt > STATE_EVERY);
      if (this.queue.length || this.pending || due || this.connection !== 'online') this.sync();
    }, SYNC_EVERY);
    this.sync();
  }

  /** Live state for the teacher's view; the memories only when they changed since the last delivery. */
  liveState() {
    const s = this.state();
    const out = { ...s.live };
    const memory = {};
    for (const name of ['pm', 'po']) {
      const json = JSON.stringify(s[name]);
      if (json !== this.sentMemory[name]) {
        out[name] = s[name];
        memory[name] = json;
      }
    }
    return { out, memory };
  }

  /** A task started without the server is registered when the connection is back. */
  async register() {
    const m = this.meta;
    const res = await post('api/attempt/open', { user: m.user, course: m.course, session: m.session, task: m.task, enc: m.enc, sig: m.sig, offlineStart: true, startedAt: m.startedAt });
    m.attemptId = res.attemptId;
    m.sessionKey = res.sessionKey;
    this.save();
  }

  /** Sends queued steps in order; the server acknowledges with its last accepted sequence number. */
  async sync() {
    if (this.blocked) return false;
    this.commit();
    if (this.syncing) {
      this.again = true;
      return this.syncing;
    }
    this.syncing = (async () => {
      try {
        if (!this.meta.attemptId) await this.register();
        for (let round = 0; round < 50; round++) {
          this.again = false;
          const body = { attemptId: this.meta.attemptId, sessionKey: this.meta.sessionKey, events: this.queue.slice(0, BATCH), sentAt: Date.now() };
          const withState = this.stateDirty && Date.now() - this.stateAt > STATE_EVERY;
          let memory = null;
          if (withState) {
            const live = this.liveState();
            body.state = live.out;
            memory = live.memory;
          }
          const res = await post('api/attempt/sync', body);
          this.lastContact = Date.now();
          if (withState) {
            this.stateDirty = false;
            this.stateAt = Date.now();
            Object.assign(this.sentMemory, memory);
          }
          const delivered = this.queue.filter((e) => e.seq <= res.lastSeq);
          this.deliveredOffline += delivered.filter((e) => e.offline).length;
          this.queue = this.queue.filter((e) => e.seq > res.lastSeq);
          if (res.status === 'finished') this.queue = []; // the server accepts nothing after the end of work
          if (res.gap || (this.queue.length && this.queue[0].seq !== res.lastSeq + 1)) {
            this.queue.forEach((e, i) => { e.seq = res.lastSeq + 1 + i; });
            this.meta.seq = res.lastSeq + this.queue.length;
          }
          this.meta.acked = res.lastSeq;
          if (res.status === 'finished' && !this.meta.finished) {
            this.meta.finished = true;
            this.emit({ type: 'finished' });
          }
          this.save();
          this.setConnection('online');
          if (this.wasOffline && !this.queue.length) {
            this.wasOffline = false;
            this.emit({ type: 'synced', offline: this.deliveredOffline });
            this.deliveredOffline = 0;
          }
          if (!this.queue.length && !this.again) return true;
        }
        return !this.queue.length;
      } catch (e) {
        if (isNetwork(e)) this.setConnection('offline');
        else this.block(refusal(e));
        return false;
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }

  /** Student's explicit end of work: further simulation is blocked. */
  async finish() {
    this.commit();
    this.enqueue('finish', '');
    this.meta.finished = true;
    this.save();
    this.emit({ type: 'finished' });
    return this.sync();
  }

  /** Final log generated by the server with its fingerprint; throws when the server cannot be reached. */
  async finalLog() {
    const synced = await this.sync();
    if (!synced || this.queue.length) throw new Error('offline');
    return post('api/attempt/log', { attemptId: this.meta.attemptId, sessionKey: this.meta.sessionKey }, { raw: true });
  }
}

/**
 * Decides the mode from the address. Returns null for free learning, an Attempt to work on,
 * or { blocked: reason } when the task cannot be opened here.
 */
export async function bootAttempt() {
  const url = new URL(location.href);
  const q = url.searchParams;
  if (!q.has('user') && !q.has('sig')) return null;
  const p = Object.fromEntries([...LINK_PARAMS, 'sig'].map((k) => [k, q.get(k) ?? '']));
  if (Object.values(p).some((v) => !/^[A-Za-z0-9_-]{1,64}$/.test(v))) return { blocked: 'invalid' };
  if (q.has('enc')) p.enc = q.get('enc'); // encrypted for the teacher; only passed on, signed with the link
  const key = LINK_PARAMS.map((k) => p[k]).join('/');
  if (await otherTabHas(key)) return { blocked: 'other-tab' };

  let meta = await load(metaKey(key));
  let queue = (await load(queueKey(key))) ?? [];
  const base = { key, link: url.href, ...p };
  let res;
  try {
    res = await post('api/attempt/open', { ...p, sessionKey: meta?.sessionKey, offlineStart: Boolean(meta && !meta.attemptId), startedAt: meta?.startedAt });
  } catch (e) {
    if (!isNetwork(e)) return { blocked: refusal(e) };
    // no server: continue the task started in this browser, or start it offline
    const fresh = !meta;
    meta = { ...base, attemptId: null, sessionKey: null, seq: 0, acked: 0, finished: false, offlineStart: true, startedAt: Date.now(), ...meta };
    const a = new Attempt(meta, queue, fresh);
    a.connection = 'offline';
    a.wasOffline = true;
    a.save();
    return a;
  }
  // a task started offline here keeps its work; an attempt cleared by the teacher starts from scratch
  let fresh = !meta;
  if (res.mode === 'new' && meta?.attemptId && meta.attemptId !== res.attemptId) {
    meta = null;
    queue = [];
    fresh = true;
  }
  meta = {
    seq: res.lastSeq, acked: res.lastSeq, startedAt: Date.now(), offlineStart: false,
    ...meta,
    ...base,
    attemptId: res.attemptId,
    sessionKey: res.sessionKey ?? meta?.sessionKey,
    finished: res.status === 'finished',
  };
  const a = new Attempt(meta, queue, fresh);
  a.connection = 'online';
  a.lastContact = Date.now();
  a.save();
  return a;
}
