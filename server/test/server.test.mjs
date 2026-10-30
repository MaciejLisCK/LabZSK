import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';
import { linkSignature } from '../src/attempts.js';
import { verifyLog } from '../../tools/verify-log.mjs';

const SECRET = 'testowy-sekret-0123456789abcdef0123456789';
let ctx;
let base;
let dataDir;
let cookie;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labzsk-test-'));
  ctx = createServer({ DATA_DIR: dataDir, TEACHER_LOGIN: 'nauczyciel', TEACHER_PASSWORD: 'test-haslo-123', OFFLINE_AFTER_SECONDS: '20' });
  await new Promise((resolve) => ctx.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${ctx.server.address().port}`;
});

after(() => {
  ctx.server.closeAllConnections();
  ctx.server.close();
  ctx.db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call(method, url, body, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
}

const link = (user, task, extra = {}) => {
  const p = { user, course: '8', session: '11', task };
  return { ...p, sig: linkSignature(SECRET, p), ...extra };
};
const open = (p) => call('POST', '/api/attempt/open', p);
const ev = (seq, text, extra = {}) => ({ seq, kind: 'log', text, ts: Date.now(), mistakes: 0, cycle: seq, ...extra });

test('without a secret no task can start; the teacher sets it in the panel', async () => {
  assert.equal((await open(link('1', '1'))).status, 503);
  assert.equal((await call('GET', '/panel/api/settings')).status, 401);
  const login = await call('POST', '/panel/api/login', { login: 'nauczyciel', password: 'test-haslo-123' });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('POST', '/panel/api/settings/secret', { secret: 'za-krotki' })).status, 400);
  const set = await call('POST', '/panel/api/settings/secret', { secret: SECRET });
  assert.equal(set.body.secret.configured, true);
  assert.equal((await call('GET', '/panel/api/settings/secret')).body.secret, SECRET);
  const generated = await call('POST', '/panel/api/link', { user: '17', course: '8', session: '11', task: '26' });
  assert.equal(generated.body.url, `${base}/?user=17&course=8&session=11&task=26&sig=${linkSignature(SECRET, { user: '17', course: '8', session: '11', task: '26' })}`);
});

test('a link with a wrong signature or changed parameters is rejected', async () => {
  assert.equal((await open({ ...link('17', '26'), sig: '0'.repeat(64) })).status, 403);
  assert.equal((await open({ ...link('17', '26'), user: '18' })).status, 403);
  assert.equal((await open({ ...link('17', '26'), task: '../x' })).status, 400);
});

test('first opening starts the attempt; the same browser continues, another one is refused', async () => {
  const first = await open(link('17', '26'));
  assert.equal(first.status, 200);
  assert.equal(first.body.mode, 'new');
  assert.ok(first.body.sessionKey);
  const same = await open(link('17', '26', { sessionKey: first.body.sessionKey }));
  assert.equal(same.body.mode, 'continue');
  assert.equal(same.body.attemptId, first.body.attemptId);
  const other = await open(link('17', '26'));
  assert.equal(other.status, 409);
  assert.equal(other.body.error, 'used');
  const otherTask = await open(link('17', '27'));
  assert.equal(otherTask.body.mode, 'new');
  assert.notEqual(otherTask.body.attemptId, first.body.attemptId);
});

test('sync keeps order, skips duplicates, reports gaps, marks offline steps and keeps the live state', async () => {
  const { attemptId, sessionKey } = (await open(link('20', '1'))).body;
  const s = (events, extra = {}) => call('POST', '/api/attempt/sync', { attemptId, sessionKey, events, sentAt: Date.now(), ...extra });
  let r = await s([ev(1, 'krok 1\n'), ev(2, 'krok 2\n')], { state: { regs: { A: 1 }, pm: [['0']], tact: 0 } });
  assert.equal(r.body.lastSeq, 2);
  r = await s([ev(2, 'krok 2\n'), ev(3, 'krok 3\n')], { state: { regs: { A: 5 }, tact: 3 } });
  assert.equal(r.body.accepted, 1);
  r = await s([ev(5, 'krok 5\n')]);
  assert.equal(r.body.gap, true);
  r = await s([ev(4, 'offline 4\n', { offline: true }), ev(5, 'stary 5\n', { ts: Date.now() - 60000 })]);
  assert.equal(r.body.lastSeq, 5);
  assert.deepEqual(ctx.attempts.events(attemptId).map((e) => [e.seq, e.offline]), [[1, 0], [2, 0], [3, 0], [4, 1], [5, 1]]);
  const state = ctx.attempts.state(attemptId);
  assert.deepEqual(state.regs, { A: 5 });
  assert.deepEqual(state.pm, [['0']], 'memories are kept when a later state omits them');
  assert.equal(state.tact, 3);
  const detail = await call('GET', `/panel/api/attempts/${attemptId}`);
  assert.equal(detail.body.state.tact, 3);
  assert.equal(detail.body.events.length, 5);
});

test('finishing blocks the task; the final log has a fingerprint that detects changes and other students', async () => {
  const { attemptId, sessionKey } = (await open(link('31', '5'))).body;
  const s = (events) => call('POST', '/api/attempt/sync', { attemptId, sessionKey, events, sentAt: Date.now() });
  assert.equal((await call('POST', '/api/attempt/log', { attemptId, sessionKey })).status, 409);
  await s([ev(1, 'MAKRO\nBłąd(1): A = 1\n', { mistakes: 1 }), ev(2, 'krok offline\n#LABZSK {"fake":1}\n', { offline: true, mistakes: 3 })]);
  await s([{ seq: 3, kind: 'finish', text: '', ts: Date.now(), mistakes: 3 }]);
  assert.equal((await s([ev(4, 'po zakończeniu\n')])).body.lastSeq, 3);
  assert.equal((await open(link('31', '5'))).body.error, 'finished');

  const log = await call('POST', '/api/attempt/log', { attemptId, sessionKey });
  assert.equal(log.status, 200);
  const text = log.body;
  assert.match(text, /^MAKRO/, 'the log starts like a regular simulator log');
  assert.match(text, /\[offline\] krok offline/);
  assert.match(text, /\[offline\]  #LABZSK \{"fake"/, 'injected marker is neutralised');
  assert.doesNotMatch(text, /po zakończeniu/);
  assert.match(text, /#LABZSK-HMAC [0-9a-f]{64}\r\n$/);

  const ok = verifyLog(text, SECRET, { user: '31', course: '8', session: '11', task: '5' });
  assert.equal(ok.result, 'valid', ok.messages.join());
  assert.equal(ok.interrupted, true);
  assert.equal(ok.meta.mistakes, 3);
  assert.equal(verifyLog(text.replace('Błąd(1): A = 1', 'Błąd(1): A = 2'), SECRET).result, 'invalid');
  assert.equal(verifyLog(text.replace('"offlineEvents":1', '"offlineEvents":0'), SECRET).result, 'invalid');
  assert.equal(verifyLog(`${text}dopisane\r\n`, SECRET).result, 'invalid');
  assert.equal(verifyLog(text, 'inny-sekret-0123456789abcdef0123456789').result, 'invalid');
  assert.equal(verifyLog(text, SECRET, { user: '32' }).result, 'mismatch');
  assert.equal(verifyLog(text, SECRET, { task: '6' }).result, 'mismatch');

  const viaPanel = await fetch(`${base}/panel/api/verify?user=31`, { method: 'POST', body: text, headers: { Cookie: cookie } });
  assert.equal((await viaPanel.json()).result, 'valid');
});

test('a clean attempt is valid without the interruption flag', async () => {
  const { attemptId, sessionKey } = (await open(link('40', '1'))).body;
  await call('POST', '/api/attempt/sync', { attemptId, sessionKey, events: [ev(1, 'a\n'), { seq: 2, kind: 'finish', text: '', ts: Date.now() }], sentAt: Date.now() });
  const r = verifyLog(ctx.attempts.finalLog(attemptId), SECRET, { user: '40' });
  assert.equal(r.result, 'valid');
  assert.equal(r.interrupted, false);
});

test('the mistake count never goes down, even if a client reports a lower one', async () => {
  const { attemptId, sessionKey } = (await open(link('41', '1'))).body;
  await call('POST', '/api/attempt/sync', { attemptId, sessionKey, events: [ev(1, 'a\n', { mistakes: 2 }), ev(2, 'b\n', { mistakes: 0 })], sentAt: Date.now() });
  await call('POST', '/api/attempt/sync', { attemptId, sessionKey, events: [{ seq: 3, kind: 'finish', text: '', ts: Date.now(), mistakes: 0 }], sentAt: Date.now() });
  assert.equal(verifyLog(ctx.attempts.finalLog(attemptId), SECRET, { user: '41' }).meta.mistakes, 2);
});

test('a link can carry the encrypted name: it is signed, kept for the panel and never returned to the student', async () => {
  const enc = 'aXY.a2V5.ZGF0YQ';
  const p = { user: '70', course: '8', session: '11', task: '1', enc };
  const sig = linkSignature(SECRET, p);
  assert.equal((await open({ ...p, enc: 'aXY.a2V5.aW5uZQ', sig })).status, 403);
  assert.equal((await open({ user: '70', course: '8', session: '11', task: '1', sig })).status, 403);
  assert.equal((await open({ ...p, enc: 'a b', sig })).status, 400);
  const first = await open({ ...p, sig });
  assert.equal(first.status, 200);
  assert.equal(JSON.stringify(first.body).includes(enc), false);
  assert.equal((await call('GET', `/panel/api/attempts/${first.body.attemptId}`)).body.attempt.enc, enc);

  const changed = { ...p, enc: 'aXY.a2V5.bm93ZQ' };
  await open({ ...changed, sig: linkSignature(SECRET, changed), sessionKey: first.body.sessionKey });
  assert.equal((await call('GET', `/panel/api/attempts/${first.body.attemptId}`)).body.attempt.enc, changed.enc);

  const empty = { user: '71', course: '8', session: '11', task: '1', enc: '' };
  const none = await open({ ...empty, sig: linkSignature(SECRET, empty) });
  assert.equal(none.status, 200);
  assert.equal((await call('GET', `/panel/api/attempts/${none.body.attemptId}`)).body.attempt.enc, null);
});

test('unsigned emergency log is recognised and never valid', () => {
  const meta = { format: 'labzsk-log', v: 2, signed: false, user: '1', course: '8', session: '11', task: '1' };
  assert.equal(verifyLog(`MAKRO\n#LABZSK ${JSON.stringify(meta)}\n`, SECRET).result, 'unsigned');
  assert.equal(verifyLog('dowolny tekst', SECRET).result, 'malformed');
});

test('a task started offline is registered when the connection returns', async () => {
  const startedAt = Date.now() - 120000;
  const r = await open(link('50', '1', { offlineStart: true, startedAt }));
  assert.equal(r.body.mode, 'new');
  const a = ctx.attempts.get(r.body.attemptId);
  assert.equal(a.offline_start, 1);
  assert.equal(a.created_at, startedAt);
  const second = await open(link('50', '1', { offlineStart: true, startedAt }));
  assert.equal(second.body.error, 'used', 'a second offline start in another browser is refused');
});

test('clearing an attempt lets the student start from scratch; the old session ends', async () => {
  const first = (await open(link('60', '1'))).body;
  assert.equal((await call('DELETE', `/panel/api/attempts/${first.attemptId}`)).status, 200);
  const old = await call('POST', '/api/attempt/sync', { attemptId: first.attemptId, sessionKey: first.sessionKey, events: [] });
  assert.equal(old.status, 404);
  assert.equal(old.body.error, 'cleared');
  const again = await open(link('60', '1', { sessionKey: first.sessionKey }));
  assert.equal(again.body.mode, 'new');
  assert.notEqual(again.body.attemptId, first.attemptId);
});

test('teacher panel requires login', async () => {
  const saved = cookie;
  cookie = null;
  assert.equal((await call('GET', '/panel/api/attempts')).status, 401);
  assert.equal((await call('POST', '/panel/api/login', { login: 'nauczyciel', password: 'zle' })).status, 401);
  cookie = saved;
  const list = await call('GET', '/panel/api/attempts');
  assert.ok(list.body.attempts.some((a) => a.user === '17' && a.task === '26'));
});

test('static files: simulator, panel and the simulator copy for the teacher view', async () => {
  assert.match(await (await fetch(`${base}/`)).text(), /LabZSK/);
  assert.equal((await fetch(`${base}/panel/`)).status, 200);
  assert.equal((await fetch(`${base}/panel/sim/js/app.js`)).status, 200);
  assert.equal((await fetch(`${base}/..%2f..%2fpackage.json`)).status, 404);
});
