// LabZSK HTTP server: the simulator (static files), the attempt API and the teacher panel.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { Attempts, ApiError } from './attempts.js';
import { TeacherAuth } from './auth.js';
import { verifyLog } from '../../tools/verify-log.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
};

const MAX_BODY = 4 * 1024 * 1024;

function send(res, status, body, headers = {}) {
  const isText = typeof body === 'string' || Buffer.isBuffer(body);
  const data = isText ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new ApiError(413, 'too_large', 'Za duże żądanie.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('application/json')) throw new ApiError(415, 'json', 'Oczekiwano application/json.');
  try {
    return JSON.parse((await readBody(req)) || '{}');
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, 'json', 'Niepoprawny JSON.');
  }
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2));
}

export function createServer(overrides = {}) {
  const config = loadConfig(overrides);
  const db = openDatabase(config.dataDir);
  const attempts = new Attempts(db, config);
  const auth = new TeacherAuth(db);
  const firstAccount = auth.ensureAccount(config.teacherLogin, config.teacherPassword);

  const clientIp = (req) => (config.trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress;
  const baseUrl = (req) => {
    if (config.publicUrl) return config.publicUrl;
    const proto = (config.trustProxy && req.headers['x-forwarded-proto']) || 'http';
    const host = (config.trustProxy && req.headers['x-forwarded-host']) || req.headers.host;
    return `${proto}://${host}`;
  };

  const teacher = (req) => {
    const login = auth.check(cookies(req).labzsk_panel);
    if (!login) throw new ApiError(401, 'login', 'Wymagane logowanie prowadzącego.');
    return login;
  };

  const sendLog = (res, id) => {
    const a = attempts.require(id);
    const name = `LabZSK_${a.user_id}_${a.course}-${a.lab_session}-${a.task}.log`;
    send(res, 200, attempts.finalLog(id).replace(/\n/g, '\r\n'), { 'Content-Disposition': `attachment; filename="${name}"` });
  };

  const secretInfo = () => {
    const s = attempts.secret();
    return { configured: Boolean(s), masked: s ? `${s.slice(0, 4)}…${s.slice(-4)} (${s.length} znaków)` : null };
  };

  // ---------------------------------------------------------------- routes
  const routes = [
    ['GET', /^\/api\/health$/, () => ({ ok: true })],

    // student – task opened from a signed Lab Manager link
    ['POST', /^\/api\/attempt\/open$/, async (req) => attempts.open(await readJson(req))],
    ['POST', /^\/api\/attempt\/sync$/, async (req) => attempts.sync(await readJson(req))],
    ['POST', /^\/api\/attempt\/log$/, async (req, res) => {
      const body = await readJson(req);
      const a = attempts.session(body.attemptId, body.sessionKey);
      if (a.status !== 'finished') throw new ApiError(409, 'not_finished', 'Log końcowy jest dostępny po zakończeniu pracy.');
      sendLog(res, a.id);
    }],

    // teacher panel
    ['POST', /^\/panel\/api\/login$/, async (req, res) => {
      const body = await readJson(req);
      const r = auth.login(body.login, body.password, clientIp(req));
      if (r.error === 'blocked') throw new ApiError(429, 'blocked', 'Za dużo nieudanych prób. Spróbuj za 10 minut.');
      if (r.error) throw new ApiError(401, 'invalid', 'Nieprawidłowy login lub hasło.');
      const secure = config.secureCookies ? '; Secure' : '';
      send(res, 200, { login: r.login }, {
        'Set-Cookie': `labzsk_panel=${r.sid}; HttpOnly; SameSite=Strict; Path=/panel; Max-Age=${r.maxAge}${secure}`,
      });
    }],
    ['POST', /^\/panel\/api\/logout$/, (req, res) => {
      auth.logout(cookies(req).labzsk_panel);
      send(res, 200, { ok: true }, { 'Set-Cookie': 'labzsk_panel=; HttpOnly; SameSite=Strict; Path=/panel; Max-Age=0' });
    }],
    ['GET', /^\/panel\/api\/me$/, (req) => ({ login: teacher(req), secret: secretInfo() })],
    ['GET', /^\/panel\/api\/attempts$/, (req) => {
      teacher(req);
      return { now: Date.now(), attempts: attempts.list() };
    }],
    ['GET', /^\/panel\/api\/attempts\/([\w-]+)$/, (req, res, m) => {
      teacher(req);
      const a = attempts.require(m[1]);
      return { attempt: attempts.summary(a), events: attempts.events(a.id), audit: attempts.auditTrail(a.id), state: attempts.state(a.id) };
    }],
    ['DELETE', /^\/panel\/api\/attempts\/([\w-]+)$/, (req, res, m) => {
      teacher(req);
      attempts.clear(m[1]);
      return { ok: true };
    }],
    ['GET', /^\/panel\/api\/attempts\/([\w-]+)\/log$/, (req, res, m) => {
      teacher(req);
      sendLog(res, m[1]);
    }],
    ['POST', /^\/panel\/api\/link$/, async (req) => {
      teacher(req);
      return { url: attempts.link(baseUrl(req), await readJson(req)) };
    }],
    ['GET', /^\/panel\/api\/settings$/, (req) => {
      teacher(req);
      return { secret: secretInfo() };
    }],
    ['GET', /^\/panel\/api\/settings\/secret$/, (req) => {
      teacher(req);
      return { secret: attempts.requireSecret() };
    }],
    ['POST', /^\/panel\/api\/settings\/secret$/, async (req) => {
      teacher(req);
      const body = await readJson(req);
      attempts.setSecret(body.secret);
      return { secret: secretInfo() };
    }],
    ['POST', /^\/panel\/api\/verify$/, async (req, res, m, url) => {
      teacher(req);
      const q = url.searchParams;
      const text = await readBody(req);
      return verifyLog(text, attempts.requireSecret(), { user: q.get('user'), course: q.get('course'), session: q.get('session'), task: q.get('task') });
    }],
    ['GET', /^\/panel\/api\/stream$/, (req, res) => {
      teacher(req);
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      });
      const write = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const onChange = (id, events) => {
        const a = attempts.get(id);
        if (a) write('attempt', { attempt: attempts.summary(a), events });
      };
      const onState = (id, state) => write('state', { id, state });
      const onRemoved = (id) => write('removed', { id });
      attempts.bus.on('change', onChange);
      attempts.bus.on('state', onState);
      attempts.bus.on('removed', onRemoved);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      write('hello', { now: Date.now() });
      req.on('close', () => {
        clearInterval(ping);
        attempts.bus.off('change', onChange);
        attempts.bus.off('state', onState);
        attempts.bus.off('removed', onRemoved);
      });
      return undefined;
    }],
  ];

  // ---------------------------------------------------------------- static files
  // /panel/sim/ serves the simulator again, so that the teacher's read-only view shares the panel cookie.
  function serveStatic(req, res, pathname) {
    let root = config.webDir;
    let rel = pathname;
    if (pathname === '/panel' || pathname === '/panel/sim') {
      res.writeHead(301, { Location: `${pathname}/` });
      return res.end();
    }
    if (pathname.startsWith('/panel/sim/')) rel = pathname.slice('/panel/sim'.length);
    else if (pathname.startsWith('/panel/')) {
      root = config.panelDir;
      rel = pathname.slice('/panel'.length);
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(root, decodeURIComponent(rel)));
    const relative = path.relative(root, file);
    if (!file.startsWith(root + path.sep) || /(^|[\\/])\./.test(relative) || relative.split(path.sep)[0] === 'test') {
      return send(res, 404, 'Nie znaleziono');
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'Nie znaleziono');
      const mtime = st.mtime.toUTCString();
      const headers = { ...SECURITY_HEADERS, 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'Last-Modified': mtime };
      if (req.headers['if-modified-since'] === mtime) {
        res.writeHead(304, headers);
        return res.end();
      }
      res.writeHead(200, { ...headers, 'Content-Length': st.size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      for (const [method, pattern, handler] of routes) {
        const m = pattern.exec(url.pathname);
        if (!m || req.method !== method) continue;
        const result = await handler(req, res, m, url);
        if (result !== undefined && !res.headersSent) send(res, 200, result);
        return;
      }
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/panel/api/')) throw new ApiError(404, 'not_found', 'Nie ma takiego adresu API.');
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new ApiError(405, 'method', 'Niedozwolona metoda.');
      serveStatic(req, res, url.pathname);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof ApiError) return send(res, e.status, { error: e.code, message: e.message, ...e.extra });
      console.error(e);
      send(res, 500, { error: 'server', message: 'Błąd serwera.' });
    }
  });

  return { server, config, db, attempts, auth, firstAccount };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, config, firstAccount, attempts } = createServer();
  server.listen(config.port, config.host, () => {
    console.log(`LabZSK: http://localhost:${config.port}/  (panel prowadzącego: /panel/)`);
    console.log(`Dane: ${config.dataDir}  Wspólny sekret: ${attempts.secret() ? 'ustawiony' : 'BRAK – ustaw w panelu (Ustawienia)'}`);
    if (firstAccount) {
      console.log(`Utworzono konto prowadzącego "${firstAccount.login}"${firstAccount.password ? ` z hasłem: ${firstAccount.password}` : ' (hasło z konfiguracji)'}`);
    }
  });
  const stop = () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
