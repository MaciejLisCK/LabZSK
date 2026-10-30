// LabZSK teacher panel: attempts, their logs and simulator state live, the shared secret.

import { createCpu } from './sim/js/cpu-view.js';

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...children.filter((c) => c != null));
  return e;
};

const STATUS = { active: 'w toku', finished: 'zakończone' };
const AUDIT = {
  opened: 'rozpoczęcie zadania', offline_start: 'rozpoczęcie bez połączenia z serwerem (zgłoszone później)',
  continued: 'kontynuacja w tej samej przeglądarce', finished: 'zakończenie pracy', denied: 'odmowa wejścia',
};
const VERDICT = {
  valid: ['POPRAWNY', 'ok'], invalid: ['NIEPOPRAWNY – log zmieniony albo odcisk nie pochodzi z tego serwera', 'bad'],
  malformed: ['NIEPOPRAWNY – to nie jest log LabZSK', 'bad'], unsigned: ['BEZ ODCISKU – log awaryjny, niezweryfikowany', 'warn'],
  mismatch: ['INNY STUDENT LUB ZADANIE – odcisk poprawny, ale powiązanie się nie zgadza', 'bad'],
};

const attempts = new Map();
const events = new Map(); // attemptId -> events loaded so far
const states = new Map(); // attemptId -> live simulator state
let selected = null;
let clockOffset = 0;
let liveMode = 'log';

// ------------------------------------------------------------------ helpers
async function api(path, { method = 'GET', body, raw = false, text } = {}) {
  const res = await fetch(`api/${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : text != null ? { 'Content-Type': 'text/plain' } : {},
    body: body ? JSON.stringify(body) : text,
  });
  if (res.status === 401 && path !== 'login') {
    showLogin();
    throw new Error('Wymagane logowanie.');
  }
  if (!res.ok) {
    let msg = `Błąd ${res.status}`;
    try {
      msg = (await res.json()).message ?? msg;
    } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return raw ? res : res.json();
}

const dateTime = (ms) => (ms ? new Date(ms).toLocaleString('pl-PL') : '—');
function ago(ms) {
  if (!ms) return '—';
  const s = Math.max(0, Math.round((Date.now() + clockOffset - ms) / 1000));
  if (s < 60) return `${s} s temu`;
  if (s < 3600) return `${Math.floor(s / 60)} min temu`;
  return dateTime(ms);
}
const task = (a) => `${a.course} / ${a.session} / ${a.task}`;

let toastTimer;
function toast(text, bad = false) {
  const t = $('toast');
  t.textContent = text;
  t.classList.toggle('bad', bad);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

function dialog(title, body, buttons) {
  const dlg = $('dlg');
  $('dlgTitle').textContent = title;
  $('dlgBody').replaceChildren(body);
  $('dlgButtons').replaceChildren(...buttons.map((b) => el('button', { class: `btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`, value: b.value, text: b.label })));
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true }));
}

const confirmBox = (text, label = 'Tak', danger = false) =>
  dialog('Potwierdź', el('p', { text }), [{ label: 'Anuluj', value: '' }, { label, value: 'ok', primary: !danger, danger }]).then((r) => r === 'ok');

async function copy(text, input) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    input?.select();
    document.execCommand('copy');
  }
  toast('Skopiowano.');
}

function linkBox(url, note) {
  const input = el('input', { class: 'link', value: url, readonly: true, onfocus: (e) => e.target.select() });
  return el('div', { class: 'link-box' },
    el('p', { text: note }),
    el('div', { class: 'row' }, input,
      el('button', { type: 'button', class: 'btn', text: 'Kopiuj', onclick: () => copy(url, input) }),
      el('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener', text: 'Otwórz' })));
}

function download(name, text) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

const openFullView = (id) => window.open(`sim/?view=${encodeURIComponent(id)}`, `labzsk-view-${id}`);

// ------------------------------------------------------------------ log rendering
function logLines(list) {
  const out = [];
  for (const e of list) {
    const text = e.kind === 'finish' ? `\n======== ZAKOŃCZENIE PRACY (${dateTime(e.client_ts)}) ========\n` : e.text;
    for (const l of text.replace(/\r/g, '').replace(/\n$/, '').split('\n')) out.push({ text: l, offline: Boolean(e.offline) });
  }
  return out;
}

function lineClass(l) {
  const c = [];
  if (l.offline) c.push('offline');
  if (/Błąd\(|Mistake\(|BŁĄD KRYTYCZNY|nie jest w trybie/.test(l.text)) c.push('err');
  else if (/={8}|ZAKOŃCZENIE PRACY|Start zadania|Kontynuacja|START BEZ POŁĄCZENIA/.test(l.text)) c.push('head');
  else if (/-zmiana->|Wczytano plik/.test(l.text)) c.push('change');
  return c.join(' ');
}

const lineNode = (l) => [el('span', { class: lineClass(l), text: l.offline ? `[offline] ${l.text}` : l.text }), '\n'];

function appendLines(pre, list, follow) {
  const stick = follow && pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 30;
  pre.append(...logLines(list).flatMap(lineNode));
  if (stick || !follow) pre.scrollTop = pre.scrollHeight;
}

// ------------------------------------------------------------------ list
function visible() {
  const f = $('filter').value;
  const q = $('search').value.trim().toLowerCase();
  return [...attempts.values()]
    .filter((a) => f === 'all' || a.status === f)
    .filter((a) => !q || `${a.user} ${a.course} ${a.session} ${a.task} ${task(a)}`.toLowerCase().includes(q))
    .sort((x, y) => (y.lastSeen ?? y.createdAt) - (x.lastSeen ?? x.createdAt));
}

function connCell(a) {
  if (a.status !== 'active') return el('span', { class: 'muted', text: '—' });
  return el('span', { class: `dot ${a.online ? 'on' : 'off'}`, text: a.online ? 'połączony' : 'brak kontaktu' });
}

function renderList() {
  const rows = visible().map((a) => el('tr', { class: a.id === selected ? 'sel' : '', onclick: () => select(a.id) },
    el('td', { text: a.user }),
    el('td', { text: task(a) }),
    el('td', {}, el('span', { class: `badge ${a.status}`, text: STATUS[a.status] ?? a.status }),
      a.offlineStart ? el('span', { class: 'badge warn', text: 'start offline' }) : null),
    el('td', {}, connCell(a)),
    el('td', { class: 'num', text: a.mistakes }),
    el('td', { class: 'num', text: a.cycles }),
    el('td', { class: 'num' }, String(a.events), a.offlineEvents ? el('span', { class: 'off-count', text: ` (${a.offlineEvents} offline)` }) : null),
    el('td', { text: ago(a.lastSeen ?? a.createdAt) })));
  $('rows').replaceChildren(...rows);
  $('count').textContent = `${rows.length} z ${attempts.size}`;
}

async function loadList() {
  const data = await api('attempts');
  clockOffset = data.now - Date.now();
  attempts.clear();
  for (const a of data.attempts) attempts.set(a.id, a);
  renderList();
  renderTiles();
  if (selected && attempts.has(selected)) renderDetailHead();
}

// ------------------------------------------------------------------ detail
let detailPre = null;

async function select(id) {
  selected = id;
  renderList();
  const box = $('detail');
  box.replaceChildren(el('p', { class: 'muted', text: 'Wczytywanie…' }));
  const data = await api(`attempts/${id}`);
  if (selected !== id) return;
  attempts.set(id, data.attempt);
  events.set(id, data.events);
  if (data.state) states.set(id, data.state);
  detailPre = el('pre', { class: 'log' });
  const follow = el('input', { type: 'checkbox', checked: true, id: 'follow' });
  box.replaceChildren(
    el('div', { id: 'detailHead' }),
    el('div', { class: 'log-head' }, el('h3', { text: 'Log na żywo' }), el('label', { class: 'check' }, follow, ' przewijaj do końca')),
    detailPre,
    el('details', { class: 'audit' }, el('summary', { text: 'Historia (zapis serwera)' }),
      el('ul', {}, ...data.audit.map((r) => el('li', { text: `${dateTime(r.at)} – ${AUDIT[r.kind] ?? r.kind}${r.detail ? ` (${r.detail})` : ''}` })))),
  );
  renderDetailHead();
  appendLines(detailPre, data.events, false);
}

function renderDetailHead() {
  const a = attempts.get(selected);
  const head = $('detailHead');
  if (!a || !head) return;
  const facts = [
    ['Kurs / zajęcia / zadanie', task(a)],
    ['Status', STATUS[a.status]],
    ['Połączenie', a.status === 'active' ? (a.online ? 'połączony' : `brak kontaktu (ostatnio ${ago(a.lastSeen)})`) : '—'],
    ['Rozpoczęcie', `${dateTime(a.createdAt)}${a.offlineStart ? ' – bez połączenia z serwerem' : ''}`],
    ['Zakończenie', dateTime(a.finishedAt)],
    ['Błędy', a.mistakes],
    ['Kroki', `${a.events}${a.offlineEvents ? ` (w tym ${a.offlineEvents} offline)` : ''}`],
  ];
  head.replaceChildren(
    el('h2', { text: `Student ${a.user}` }),
    el('dl', { class: 'facts' }, ...facts.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: String(v) })])),
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary', text: 'Pełny widok', onclick: () => openFullView(a.id) }),
      el('button', { class: 'btn', text: 'Pobierz log', onclick: () => downloadLog(a) }),
      el('button', { class: 'btn danger-outline', text: 'Wyczyść podejście', onclick: () => clearAttempt(a) })),
  );
}

async function downloadLog(a) {
  try {
    const res = await api(`attempts/${a.id}/log`, { raw: true });
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'LabZSK.log';
    download(name, await res.text());
  } catch (e) {
    toast(e.message, true);
  }
}

async function clearAttempt(a) {
  const text = `Wyczyścić podejście studenta ${a.user} (${task(a)})? Podejście i jego log zostaną usunięte, a student po ponownym otwarciu linku zacznie zadanie od nowa. Tego nie można cofnąć.`;
  if (!(await confirmBox(text, 'Wyczyść', true))) return;
  try {
    await api(`attempts/${a.id}`, { method: 'DELETE' });
    toast('Podejście wyczyszczone.');
  } catch (e) {
    toast(e.message, true);
  }
}

// ------------------------------------------------------------------ live tiles (log or CPU of every student)
const TILE_LINES = 14;
const tiles = new Map(); // attemptId -> { root, meta, body, mode, cpu }
const tileLoading = new Set();

function loadTileData(id) {
  if (events.has(id) || tileLoading.has(id)) return;
  tileLoading.add(id);
  api(`attempts/${id}`).then((d) => {
    events.set(id, d.events);
    if (d.state) states.set(id, d.state);
    renderTiles();
  }).catch(() => {}).finally(() => tileLoading.delete(id));
}

function cpuBox() {
  const cpu = el('div', { class: 'cpu' });
  cpu.append(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
  const svg = cpu.firstChild;
  svg.setAttribute('class', 'wires');
  svg.setAttribute('viewBox', '0 0 1000 560');
  return { cpu, view: createCpu(cpu) };
}

function tileState(s) {
  if (!s) return 'brak danych o stanie';
  const what = s.editMode ? 'edycja rejestrów' : s.check ? `odpowiada: ${s.check}` : s.waiting === 'tact' ? 'czeka na następny takt' : s.running ? 'cykl w toku' : 'stop';
  return `takt ${s.tact ?? 0} · cykl ${s.cycle ?? 0} · ${what}`;
}

function updateTile(t, a) {
  const s = states.get(a.id);
  t.head.replaceChildren(el('strong', { text: `Student ${a.user}` }), connCell(a));
  t.meta.textContent = `${task(a)} · błędy: ${a.mistakes}${liveMode === 'cpu' ? ` · ${tileState(s)}` : ` · cykle: ${a.cycles}`}`;
  if (t.mode !== liveMode) {
    t.mode = liveMode;
    t.cpu = null;
    t.body.replaceChildren();
  }
  if (liveMode === 'log') {
    const lines = logLines(events.get(a.id) ?? []).slice(-TILE_LINES);
    t.body.replaceChildren(el('pre', { class: 'log tail' }, ...lines.flatMap(lineNode)));
  } else {
    if (!t.cpu) {
      t.cpu = cpuBox();
      t.body.replaceChildren(el('div', { class: 'tile-cpu' }, t.cpu.cpu));
    }
    t.cpu.view.render({
      regs: s?.regs, flags: s?.flags, rbps: s?.rbps, cea: s?.ceaLayout, checked: s?.check || null,
      flagLabel: (f) => (f === 'ZNAK' ? 'ZNAK' : f),
    });
  }
}

function renderTiles() {
  if ($('tab-live').hidden) return;
  const list = [...attempts.values()].filter((a) => a.status === 'active').sort((x, y) => x.user.localeCompare(y.user, 'pl', { numeric: true }));
  for (const [id, t] of tiles) {
    if (!list.some((a) => a.id === id)) {
      t.root.remove();
      tiles.delete(id);
    }
  }
  const box = $('tiles');
  box.querySelector('.empty')?.remove();
  for (const a of list) {
    loadTileData(a.id);
    let t = tiles.get(a.id);
    if (!t) {
      const head = el('header');
      const meta = el('div', { class: 'muted small' });
      const body = el('div', { class: 'tile-body' });
      const root = el('article', { class: 'tile' }, head, meta, body,
        el('div', { class: 'tile-actions' },
          el('button', { class: 'btn small', text: 'Log i szczegóły', onclick: () => { showTab('list'); select(a.id); } }),
          el('button', { class: 'btn small primary', text: 'Pełny widok', onclick: () => openFullView(a.id) })));
      t = { root, head, meta, body, mode: null, cpu: null };
      tiles.set(a.id, t);
    }
    box.append(t.root); // keeps the sorted order
    updateTile(t, a);
  }
  if (!list.length) box.append(el('p', { class: 'muted empty', text: 'Brak podejść w toku.' }));
}

$('liveMode').addEventListener('click', (e) => {
  const mode = e.target.dataset.mode;
  if (!mode) return;
  liveMode = mode;
  for (const b of $('liveMode').children) b.classList.toggle('active', b.dataset.mode === mode);
  renderTiles();
});

// ------------------------------------------------------------------ live stream
let stream;
function connectStream() {
  stream?.close();
  stream = new EventSource('api/stream');
  stream.addEventListener('hello', (e) => {
    clockOffset = JSON.parse(e.data).now - Date.now();
    $('streamState').className = 'stream on';
    $('streamState').textContent = 'na żywo';
    loadList().catch(() => {});
  });
  stream.addEventListener('attempt', (e) => {
    const { attempt, events: fresh } = JSON.parse(e.data);
    attempts.set(attempt.id, attempt);
    if (fresh.length && events.has(attempt.id)) {
      const list = events.get(attempt.id);
      const last = list.length ? list[list.length - 1].seq : 0;
      const add = fresh.filter((ev) => ev.seq > last);
      list.push(...add);
      if (attempt.id === selected && detailPre) appendLines(detailPre, add, $('follow')?.checked);
    }
    renderList();
    renderTiles();
    if (attempt.id === selected) renderDetailHead();
  });
  stream.addEventListener('state', (e) => {
    const { id, state } = JSON.parse(e.data);
    states.set(id, { ...states.get(id), ...state });
    const t = tiles.get(id);
    const a = attempts.get(id);
    if (t && a && liveMode === 'cpu' && !$('tab-live').hidden) updateTile(t, a);
  });
  stream.addEventListener('removed', (e) => {
    const { id } = JSON.parse(e.data);
    attempts.delete(id);
    events.delete(id);
    states.delete(id);
    if (selected === id) {
      selected = null;
      $('detail').replaceChildren(el('p', { class: 'muted', text: 'Podejście zostało wyczyszczone.' }));
    }
    renderList();
    renderTiles();
  });
  stream.onerror = () => {
    $('streamState').className = 'stream off';
    $('streamState').textContent = 'ponowne łączenie…';
  };
}

// ------------------------------------------------------------------ test link, verification, settings
$('linkForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('linkError').textContent = '';
  try {
    const r = await api('link', { method: 'POST', body: { user: f.user.value, course: f.course.value, session: f.session.value, task: f.task.value } });
    $('linkResult').replaceChildren(linkBox(r.url, 'Link do zadania (ten sam, który utworzy Lab Manager). Otwórz go w innej przeglądarce lub oknie prywatnym, aby zobaczyć widok studenta:'));
  } catch (err) {
    $('linkError').textContent = err.message;
  }
});

$('verifyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const file = f.file.files[0];
  if (!file) return;
  const q = new URLSearchParams();
  for (const k of ['user', 'course', 'session', 'task']) if (f[k].value.trim()) q.set(k, f[k].value.trim());
  try {
    const r = await api(`verify?${q}`, { method: 'POST', text: await file.text() });
    const [label, cls] = VERDICT[r.result];
    const interrupted = r.result === 'valid' && r.interrupted;
    $('verifyResult').replaceChildren(el('div', { class: `verdict ${interrupted ? 'warn' : cls}` },
      el('strong', { text: interrupted ? `${label} – z przerwą w połączeniu` : label }),
      r.meta ? el('p', { text: `Student: ${r.meta.user} · ${task(r.meta)} · błędy: ${r.meta.mistakes ?? '—'}` }) : null,
      el('ul', {}, ...r.messages.map((m) => el('li', { text: m })))));
  } catch (err) {
    toast(err.message, true);
  }
});

function renderSecret(info) {
  $('secretState').textContent = info.configured ? `ustawiony (${info.masked})` : 'BRAK – studenci nie mogą rozpocząć zadań';
  $('noSecret').hidden = info.configured;
  $('secretValue').value = '';
  $('secretShow').disabled = $('secretCopy').disabled = !info.configured;
}

$('secretShow').addEventListener('click', async () => {
  try {
    $('secretValue').value = (await api('settings/secret')).secret;
  } catch (e) {
    toast(e.message, true);
  }
});
$('secretCopy').addEventListener('click', async () => {
  try {
    const { secret } = await api('settings/secret');
    await copy(secret, $('secretValue'));
  } catch (e) {
    toast(e.message, true);
  }
});
$('secretGenerate').addEventListener('click', async () => {
  const configured = $('noSecret').hidden;
  if (configured && !(await confirmBox('Wygenerować nowy sekret? Dotychczasowe linki przestaną działać, a logi z odciskiem starego sekretu nie przejdą weryfikacji. Nowy sekret trzeba wpisać w Lab Managerze.', 'Wygeneruj', true))) return;
  try {
    renderSecret((await api('settings/secret', { method: 'POST', body: {} })).secret);
    $('secretValue').value = (await api('settings/secret')).secret;
    toast('Zapisano nowy sekret – wpisz go w ustawieniach Lab Managera.');
  } catch (e) {
    $('secretError').textContent = e.message;
  }
});
$('secretForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('secretError').textContent = '';
  const configured = $('noSecret').hidden;
  if (configured && !(await confirmBox('Zastąpić obecny sekret? Dotychczasowe linki przestaną działać, a logi z odciskiem starego sekretu nie przejdą weryfikacji.', 'Zastąp', true))) return;
  try {
    renderSecret((await api('settings/secret', { method: 'POST', body: { secret: e.target.secret.value } })).secret);
    e.target.reset();
    toast('Zapisano sekret.');
  } catch (err) {
    $('secretError').textContent = err.message;
  }
});

// ------------------------------------------------------------------ navigation and login
function showTab(name) {
  for (const b of $('tabs').children) b.classList.toggle('active', b.dataset.tab === name);
  for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== `tab-${name}`;
  renderTiles();
}
$('tabs').addEventListener('click', (e) => {
  if (e.target.dataset.tab) showTab(e.target.dataset.tab);
});
document.addEventListener('click', (e) => {
  const goto = e.target.closest('[data-goto]');
  if (goto) {
    e.preventDefault();
    showTab(goto.dataset.goto);
  }
});
$('filter').addEventListener('change', renderList);
$('search').addEventListener('input', renderList);

function showLogin() {
  stream?.close();
  $('appView').hidden = true;
  $('loginView').hidden = false;
  $('loginForm').login.focus();
}

async function showApp() {
  const me = await api('me');
  $('who').textContent = me.login;
  renderSecret(me.secret);
  $('loginView').hidden = true;
  $('appView').hidden = false;
  if (!me.secret.configured) showTab('settings');
  connectStream();
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  try {
    await api('login', { method: 'POST', body: { login: e.target.login.value, password: e.target.password.value } });
    e.target.password.value = '';
    await showApp();
  } catch (err) {
    $('loginError').textContent = err.message;
  }
});

$('logout').addEventListener('click', async () => {
  await api('logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

setInterval(() => {
  if ($('appView').hidden) return;
  loadList().catch(() => {});
}, 15000);

showApp().catch(() => showLogin());
