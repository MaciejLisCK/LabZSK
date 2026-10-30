// User interface of the LabZSK web simulator.

import { Machine, REG_NAMES, FLAG_NAMES, NOT_EDITABLE, emptyPM, emptyPO } from './engine.js';
import {
  COL, PM_COLUMNS, SIMPLE_OPS, COMPLEX_OPS, hex, bin16, s16, parseValue, decodeCell, cellValue,
  microOpDescription, instructionDescription, memoryCell, emptyCell, encodeSimple, encodeComplex,
  MEM_EMPTY, MEM_DATA, MEM_SIMPLE, MEM_COMPLEX,
} from './isa.js';
import { strings } from './i18n.js';
import { savePM, loadPM, savePO, loadPO } from './files.js';
import { bootAttempt, localSessions } from './attempt.js';
import { createCpu, regText } from './cpu-view.js';
import { load, save } from './store.js';

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

// ------------------------------------------------------------------ state
const SETTINGS_KEY = 'labzsk:settings';

const settings = { lang: 'pl', skin: 0, teacher: false, delay: 200 };
try {
  const { marks, ...saved } = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
  Object.assign(settings, saved);
} catch { /* storage unavailable */ }
const t = () => strings(settings.lang);

// Teacher's read-only view of a student (?view=<attempt>, opened from the panel at /panel/sim/),
// a lab task from a Lab Manager link, a blocked task, or free learning.
const viewId = new URL(location.href).searchParams.get('view');
/** The student's name for the teacher's view, read with the panel's key in this browser. */
async function viewerName(a) {
  try {
    const { loadKey, personOf, personLabel } = await import(new URL('../keys.js', location.href));
    const person = await personOf(await loadKey(), a.enc);
    if (person) return `${personLabel(person)} (${a.user})`;
  } catch { /* the pseudonym or userId stays */ }
  return a.pseudonym ? `Student ${a.pseudonym} (${a.user})` : null;
}
let view = null; // { attempt, state } of the watched student
let boot = null;
if (viewId) {
  try {
    const res = await fetch(`../api/attempts/${encodeURIComponent(viewId)}`, { cache: 'no-store' });
    if (res.ok) {
      view = await res.json();
      view.studentName = await viewerName(view.attempt);
    }
    else boot = { blocked: res.status === 401 ? 'view-login' : 'cleared' };
  } catch {
    boot = { blocked: 'view-offline' };
  }
} else boot = await bootAttempt();
const viewer = Boolean(view);
const blocked = boot?.blocked ? boot : null;
const attempt = blocked ? null : boot;
const STATE_KEY = attempt ? attempt.stateKey : 'labzsk:state';
const freeTeacher = settings.teacher;
if (attempt || viewer) settings.teacher = false; // no automatic execution in a lab task

// Marks are switched off: only the number of mistakes is shown.
const m = new Machine({ lang: settings.lang, marks: null });
let studentEdit = false; // viewer: the student is editing registers
if (viewer) {
  m.restore({ ...view.state, logText: view.events.map(eventText).join(''), logOpen: true });
  applyLive(view.state);
} else if (!blocked) {
  try {
    let saved = attempt?.fresh ? null : await load(STATE_KEY);
    if (saved === undefined && !attempt) saved = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null'); // before IndexedDB
    m.restore(saved ?? null);
  } catch { /* storage unavailable or corrupted */ }
}
m.updateMark();
if (attempt) {
  // A mistake is stored and queued at once: reloading the page must not take it back.
  m.onMistake = () => {
    attempt.commit();
    save(STATE_KEY, m.scoredCheckpoint());
  };
  const log = m.log.bind(m);
  m.log = (text) => {
    log(text);
    attempt.record(text);
  };
}
const locked = () => Boolean(viewer || attempt?.finished || attempt?.blocked);

let gen = null; // running cycle
let editMode = false;
let autoRunning = false;
let selectedPO = 0;
const appStart = new Date();
let simStart = null;

function persist() {
  if (viewer || blocked) return;
  save(STATE_KEY, m.snapshot());
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(attempt ? { ...settings, teacher: freeTeacher } : settings));
  } catch { /* storage unavailable */ }
  attempt?.stateChanged();
}

/** Text of a step of the student's log as the teacher sees it. */
function eventText(e) {
  if (e.kind === 'finish') return `\n======== ${t().workFinishedLog} ========\n`;
  if (!e.offline) return e.text;
  return e.text.replace(/\n$/, '').split('\n').map((l) => `[offline] ${l}`).join('\n') + '\n';
}

/** What the teacher sees of the student's simulator, sent with the steps. */
function liveState() {
  const { logText, logOpen, pm, po, ...base } = m.snapshot();
  const check = m.waiting === 'ok' && m.registerToCheck && m.regs[m.registerToCheck]?.needCheck ? m.registerToCheck : '';
  return {
    ...base, tact: m.tact, running: m.running, waiting: m.waiting, check, current: m.current,
    ceaLayout: m.ceaLayout, memCursor: m.memCursor, miniLog: m.miniLog.slice(-40), editMode,
  };
}

/** Viewer: shows a state received from the student. */
function applyLive(s) {
  if (!s) return;
  m.restore({ ...s, logText: m.logText, logOpen: true });
  m.updateMark();
  m.tact = s.tact ?? 0;
  m.running = Boolean(s.running);
  m.waiting = s.waiting ?? null;
  m.registerToCheck = s.check ?? '';
  if (s.check && m.regs[s.check]) m.regs[s.check].needCheck = true;
  m.current = s.current ?? null;
  m.ceaLayout = Boolean(s.ceaLayout);
  m.memCursor = s.memCursor ?? null;
  m.miniLog = s.miniLog ?? [];
  studentEdit = Boolean(s.editMode);
}

// ------------------------------------------------------------------ CPU diagram
let regEls;

function buildCPU() {
  const cpu = $('cpu');
  cpuView = createCpu(cpu);
  regEls = cpuView.regEls;
  for (const name of REG_NAMES) {
    const { input } = regEls[name];
    input.addEventListener('focus', () => onRegFocus(name));
    input.addEventListener('blur', () => onRegBlur(name));
    input.addEventListener('keydown', (e) => onRegKey(e, name));
  }
  for (const name of FLAG_NAMES) {
    const { input } = cpuView.flagEls[name];
    input.addEventListener('focus', () => { if (editMode) input.select(); });
    input.addEventListener('input', () => {
      if (!editMode) return;
      const v = input.value.trim().slice(-1);
      if (v === '0' || v === '1') m.flags[name] = Number(v);
      input.value = String(m.flags[name]);
      input.select();
    });
  }
  cpu.addEventListener('dblclick', (e) => {
    if (e.target === cpu || e.target.closest('svg')) toggleEditMode();
  });
}
let cpuView;

function isChecked(name) {
  return m.waiting === 'ok' && m.registerToCheck === name && m.regs[name].needCheck;
}

function isEditable(name) {
  if (viewer) return false;
  return (editMode && !NOT_EDITABLE.includes(name)) || isChecked(name);
}

function renderCPU() {
  cpuView.render({
    regs: Object.fromEntries(REG_NAMES.map((n) => [n, m.regs[n].value])),
    flags: m.flags,
    rbps: m.rbps,
    cea: m.ceaLayout,
    checked: REG_NAMES.find(isChecked) ?? null,
    editMode,
    editable: isEditable,
    flagLabel: (f) => m.flagLabel(f),
  });
}

function onRegFocus(name) {
  const { input } = regEls[name];
  if (!input.readOnly) input.value = '';
}

function commitReg(name) {
  const { input } = regEls[name];
  if (input.readOnly) return true;
  const text = input.value;
  if (text.trim() === '' || text === regText(m.regs[name].value)) return true;
  const v = parseValue(text);
  if (v === null) {
    toast(`${t().invalidValue}: ${text}`, true);
    return false;
  }
  if (editMode) m.regs[name].setBoth(v);
  else m.enterValue(name, v);
  return true;
}

function onRegBlur(name) {
  commitReg(name);
  regEls[name].input.value = regText(m.regs[name].value);
}

function onRegKey(e, name) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  e.stopPropagation();
  if (m.waiting === 'ok') confirm();
  else if (commitReg(name)) regEls[name].input.blur();
}

// ------------------------------------------------------------------ microcode table
const pmCells = [];
const pmRows = [];

function buildPM() {
  const table = $('pmTable');
  const head = el('tr', {}, ...PM_COLUMNS.map((c, i) => el('th', { text: i === 0 ? t().address : c })));
  const body = el('tbody');
  for (let r = 0; r < 256; r++) {
    const tr = el('tr');
    const cells = [];
    for (let c = 0; c < 12; c++) {
      const td = el('td', { text: m.pm[r][c] });
      if (c > 0) td.addEventListener('click', () => editMicroOp(r, c));
      tr.append(td);
      cells.push(td);
    }
    body.append(tr);
    pmRows.push(tr);
    pmCells.push(cells);
  }
  table.replaceChildren(el('thead', {}, head), body);
}

function renderPMRow(r) {
  for (let c = 1; c < 12; c++) pmCells[r][c].textContent = m.pm[r][c];
}

let pmHighlight = { row: -1, col: -1 };
function renderPMHighlight() {
  const row = m.running && m.current ? m.current.row : m.regs.RAPS.value;
  const col = m.running && m.current ? m.current.col : -1;
  if (pmHighlight.row === row && pmHighlight.col === col) return;
  if (pmHighlight.row >= 0) {
    pmRows[pmHighlight.row].classList.remove('current');
    if (pmHighlight.col >= 0) pmCells[pmHighlight.row][pmHighlight.col].classList.remove('current');
  }
  pmRows[row].classList.add('current');
  if (col >= 0) pmCells[row][col].classList.add('current');
  if (pmHighlight.row !== row) scrollRowIntoView($('pmScroll'), pmRows[row]);
  pmHighlight = { row, col };
}

function scrollRowIntoView(container, row) {
  const top = row.offsetTop - container.querySelector('thead').offsetHeight;
  const bottomEdge = row.offsetTop + row.offsetHeight;
  if (top < container.scrollTop) container.scrollTop = top - 2 * row.offsetHeight;
  else if (bottomEdge > container.scrollTop + container.clientHeight) {
    container.scrollTop = bottomEdge - container.clientHeight + 2 * row.offsetHeight;
  }
}

// ------------------------------------------------------------------ operating memory table
const poRows = [];

function buildPO() {
  const table = $('poTable');
  const body = el('tbody');
  for (let r = 0; r < 256; r++) {
    const tr = el('tr', {}, el('td', { text: String(r) }), el('td'), el('td', { class: 'hexcol' }));
    tr.addEventListener('click', () => selectPO(r));
    tr.addEventListener('dblclick', () => editCell(r));
    body.append(tr);
    poRows.push(tr);
  }
  table.replaceChildren(el('thead', {}, el('tr', {}, el('th', { text: t().address }), el('th', { text: t().content }), el('th', { text: 'hex' }))), body);
  for (let r = 0; r < 256; r++) renderPORow(r);
}

function renderPORow(r) {
  const cell = m.po[r];
  const tds = poRows[r].children;
  tds[1].textContent = cell.bin;
  tds[2].textContent = cell.hex ? `${cell.hex}h` : '';
}

let poCursor = -1;
function renderPOHighlight() {
  for (const r of [poCursor, m.memCursor]) if (r != null && r >= 0) renderPORow(r);
  if (poCursor >= 0) poRows[poCursor].classList.remove('cursor');
  poCursor = m.memCursor ?? -1;
  if (poCursor >= 0) {
    poRows[poCursor].classList.add('cursor');
    scrollRowIntoView($('poScroll'), poRows[poCursor]);
  }
}

function selectPO(r) {
  poRows[selectedPO].classList.remove('selected');
  selectedPO = r;
  poRows[r].classList.add('selected');
  renderCellDescription();
}

function renderCellDescription() {
  const tr = t();
  const r = selectedPO;
  const cell = m.po[r];
  let text = `PAO[${r}]`;
  const d = decodeCell(cell);
  if (cell.type === MEM_EMPTY || !d) text += cell.bin ? '' : ' = 0';
  if (cell.type === MEM_DATA) {
    const v = cellValue(cell);
    text += ` - ${tr.data}\n${cell.bin}b\n${v}d\n${hex(v)}h`;
  } else if (d && !d.complex) {
    text += ` - ${tr.simpleInstruction}\n${d.mnemo} – ${instructionDescription(d.mnemo, settings.lang)}\n`;
    text += `OP = ${d.op.toString(16).toUpperCase()}h (${d.mnemo})\nX = ${d.x}\nS = ${d.s}\nI = ${d.i}\nDA = ${d.da.toString(16).toUpperCase()}h (${d.da})`;
  } else if (d) {
    text += ` - ${tr.complexInstruction}\n${d.mnemo} – ${instructionDescription(d.mnemo, settings.lang)}\n`;
    text += `AOP = ${d.aop.toString(16).toUpperCase()}h (${d.mnemo})\nN = ${d.n.toString(16).toUpperCase()}h (${d.n})`;
  }
  $('cellDesc').textContent = text;
}

// ------------------------------------------------------------------ control panel
const LOCKED_ACTIONS = ['editRegisters', 'clearRegisters', 'closeLog', 'loadPM', 'clearPM', 'loadPO', 'clearPO', 'editCell', 'clearCell', 'settings'];
// Actions that change the simulation; blocked after the student finished a controlled attempt.
const FINISHED_ACTIONS = ['editRegisters', 'clearRegisters', 'closeLog', 'loadPM', 'clearPM', 'loadPO', 'clearPO', 'editCell', 'clearCell', 'finish'];

function render() {
  const tr = t();
  renderCPU();
  renderPMHighlight();
  renderPOHighlight();
  $('infoMark').parentElement.hidden = m.mark == null;
  $('infoMark').textContent = m.mark ?? '';
  $('infoMark').classList.toggle('bad', m.mark === 2);
  $('infoMistakes').textContent = m.mistakes;
  $('infoTact').textContent = m.tact;
  $('infoCycle').textContent = m.cycle;

  const status = $('status');
  status.className = 'status';
  if (editMode || studentEdit) {
    status.textContent = tr.editMode;
    status.classList.add('edit');
  } else if (m.running) {
    status.textContent = tr.startMode;
    status.classList.add('running');
  } else if (viewer) {
    status.textContent = tr.stopMode;
  } else if (locked()) {
    status.textContent = tr.finishedLocked;
    status.classList.add('locked');
  } else if (!m.canSimulate) {
    status.textContent = tr.haltMode;
    status.classList.add('running');
  } else status.textContent = tr.stopMode;

  const idle = !m.running && !editMode && !autoRunning;
  $('btnMacro').hidden = !idle;
  $('btnMicro').hidden = !idle;
  $('btnMacro').disabled = $('btnMicro').disabled = !m.canSimulate || locked();
  $('btnOk').hidden = m.waiting !== 'ok' || autoRunning || viewer;
  $('btnNext').hidden = m.waiting !== 'tact' || autoRunning || viewer;
  if (viewer) $('btnMacro').hidden = $('btnMicro').hidden = true;
  $('btnEndEdit').hidden = !editMode;
  $('autoBox').hidden = !settings.teacher;
  $('btnAuto').textContent = autoRunning ? tr.autoStop : tr.autoBtn;
  $('btnAuto').disabled = !autoRunning && (!idle || !m.canSimulate);
  $('menuEdit').textContent = editMode ? tr.endEditRegisters : tr.editRegisters;
  for (const b of document.querySelectorAll('.menu-list button')) {
    b.disabled = ((m.running || autoRunning) && LOCKED_ACTIONS.includes(b.dataset.action))
      || (locked() && FINISHED_ACTIONS.includes(b.dataset.action));
  }
  $('menuCloseLog').hidden = Boolean(attempt || viewer);
  $('pmTable').classList.toggle('locked', m.running || autoRunning || locked());
  renderMiniLog();
  renderAttemptBar();
  attempt?.stateChanged();
}

let miniLogLast = null; // newest entry drawn; each entry is a new object, so this also tells cycles of equal length apart
function renderMiniLog() {
  const last = m.miniLog.at(-1) ?? null;
  if (last && last === miniLogLast) return;
  miniLogLast = last;
  const list = $('miniLog');
  list.replaceChildren(...m.miniLog.map((e) => el('li', {},
    el('span', { class: 'tact', text: e.tact }), el('span', { class: 'mnemo', text: e.mnemo }), e.description)));
  list.scrollTop = list.scrollHeight;
}

function tickClock() {
  const hm = (d) => d.toTimeString().slice(0, 5);
  let text = `UT${hm(appStart)}`;
  if (simStart) {
    const s = Math.floor((Date.now() - simStart) / 1000);
    const two = (n) => String(n).padStart(2, '0');
    text += ` > ${hm(simStart)} + ${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}.${two(s % 60)}`;
  }
  $('clock').textContent = text;
}

// ------------------------------------------------------------------ simulation driver
function startCycle(micro) {
  if (gen || editMode || autoRunning || !m.canSimulate || locked()) return;
  closeMenus();
  if (!simStart) simStart = new Date();
  m.saveCheckpoint();
  persist(); // state before the cycle, in case the page is reloaded mid-cycle
  gen = m.runCycle(micro);
  step();
}

function step() {
  m.lastCheck = null;
  const r = gen.next();
  if (r.done) {
    gen = null;
    persist();
    if (!m.canSimulate) toast(t().haltToast, true);
  }
  feedback();
  render();
  if (m.waiting === 'ok' && m.registerToCheck && m.regs[m.registerToCheck].needCheck) {
    const { input } = regEls[m.registerToCheck];
    if (document.activeElement === input) onRegFocus(m.registerToCheck);
    else input.focus();
  } else if (m.waiting === 'ok') {
    $('btnOk').focus();
  } else if (m.waiting === 'tact') {
    $('btnNext').focus();
  } else if (!gen) {
    $('btnMacro').focus({ preventScroll: true });
  }
}

function feedback() {
  const c = m.lastCheck;
  if (!c) return;
  const box = regEls[c.name].box;
  box.classList.remove('wrong', 'right-answer');
  void box.offsetWidth;
  box.classList.add(c.ok ? 'right-answer' : 'wrong');
  if (!c.ok && !autoRunning) toast(t().mistakeToast(c.name, c.bad, c.good), true);
}

function confirm() {
  if (m.waiting !== 'ok' || !gen) return;
  const input = regEls[m.registerToCheck]?.input;
  if (input && document.activeElement === input) {
    if (!commitReg(m.registerToCheck)) return;
    input.value = ''; // already committed; keeps the blur handler from entering it again
  }
  step();
}

function nextTact() {
  if (m.waiting !== 'tact' || !gen) return;
  step();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function autoRun() {
  if (autoRunning) {
    autoRunning = false;
    return;
  }
  if (gen || editMode || !m.canSimulate || locked()) return;
  const count = Math.max(1, Math.min(10000, parseInt($('autoCycles').value, 10) || 1));
  autoRunning = true;
  if (!simStart) simStart = new Date();
  m.auto = true;
  try {
    for (let i = 0; i < count && autoRunning && m.canSimulate; i++) {
      gen = m.runCycle(false);
      for (let r = gen.next(); !r.done; r = gen.next()) {
        const name = m.registerToCheck;
        if (name && m.regs[name].needCheck) m.enterValue(name, m.regs[name].expected);
        render();
        if (settings.delay > 0) await sleep(settings.delay);
      }
      gen = null;
      persist();
      render();
    }
  } finally {
    m.auto = false;
    gen = null;
    autoRunning = false;
    persist();
    render();
  }
}

function toggleEditMode() {
  if (m.running || autoRunning || (locked() && !editMode)) return;
  closeMenus();
  if (editMode) {
    const focused = REG_NAMES.find((n) => document.activeElement === regEls[n].input);
    if (focused) commitReg(focused);
    m.leaveEditMode();
    editMode = false;
    persist();
  } else {
    m.enterEditMode();
    editMode = true;
  }
  render();
}

// ------------------------------------------------------------------ dialogs
const dlg = $('dlg');

/** Shows the modal dialog; resolves with the value of the pressed button ('' when dismissed). */
function dialog(title, body, buttons, { wide = false } = {}) {
  $('dlgTitle').textContent = title;
  $('dlgBody').replaceChildren(body);
  const row = $('dlgButtons');
  // The primary button comes first in the DOM so that Enter submits it.
  const ordered = [...buttons].sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
  row.replaceChildren(...ordered.map((b) => {
    const btn = el('button', { class: `btn${b.primary ? ' primary' : ''}`, value: b.value, text: b.label });
    btn.style.order = String(buttons.indexOf(b));
    return btn;
  }));
  dlg.style.width = wide ? 'min(92vw, 760px)' : '';
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true }));
}

function okCancel() {
  return [{ label: t().cancel, value: '' }, { label: t().ok, value: 'ok', primary: true }];
}

function closeOnly() {
  return [{ label: t().close, value: '', primary: true }];
}

async function confirmDialog(text) {
  return (await dialog('LabZSK', el('p', { text }), okCancel())) === 'ok';
}

async function editMicroOp(row, col) {
  if (m.running || autoRunning || locked()) return;
  const tr = t();
  const title = `PM[${row}] – ${PM_COLUMNS[col]}`;
  if (col === COL.NA) {
    const input = el('input', { type: 'number', min: '0', max: '255', value: m.pm[row][col] || '0', autofocus: true });
    const body = el('div', {}, el('p', { text: tr.naRange }), el('div', { class: 'form-row' }, input));
    if ((await dialog(title, body, okCancel())) !== 'ok') return;
    applyMicroOp(row, col, input.value);
    return;
  }
  const { options, required } = m.optionsFor(row, col);
  const current = m.pm[row][col];
  const list = el('div', { class: 'options' });
  const choices = required ? options : ['', ...options];
  for (const op of choices) {
    const radio = el('input', { type: 'radio', name: 'op', value: op, checked: op === current });
    const label = el('label', {}, radio, el('span', { class: 'm', text: op || tr.none }),
      el('span', { class: 'd', text: op ? microOpDescription(op, settings.lang) : '' }));
    label.addEventListener('dblclick', () => {
      radio.checked = true;
      dlg.close('ok');
    });
    list.append(label);
  }
  if (!list.querySelector(':checked')) list.querySelector('input').checked = true;
  list.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      dlg.close('ok');
    }
  });
  setTimeout(() => list.querySelector(':checked')?.focus());
  if ((await dialog(title, list, okCancel(), { wide: true })) !== 'ok') return;
  const value = list.querySelector(':checked')?.value ?? '';
  applyMicroOp(row, col, value);
  if (col === COL.C1 && value === 'SHT') await editMicroOp(row, COL.D2);
}

function applyMicroOp(row, col, value) {
  m.setMicroOp(row, col, value);
  renderPMRow(row);
  persist();
  render();
}

async function editCell(addr = selectedPO) {
  if (m.running || autoRunning || locked()) return;
  selectPO(addr);
  const tr = t();
  const cell = m.po[addr];
  const d = cell.type === MEM_SIMPLE || cell.type === MEM_COMPLEX ? decodeCell(cell) : null;
  let mode = cell.type === MEM_SIMPLE ? 'simple' : cell.type === MEM_COMPLEX ? 'complex' : 'data';

  // data
  let base = 'dec';
  const dataInput = el('input', { type: 'text', value: cell.type === MEM_DATA ? String(cellValue(cell)) : '', spellcheck: 'false' });
  const baseRow = el('div', { class: 'form-row' }, ...[['dec', tr.dec], ['hex', tr.hexBase], ['bin', tr.binBase]].map(([b, label]) => {
    const radio = el('input', { type: 'radio', name: 'base', value: b, checked: b === 'dec' });
    radio.addEventListener('change', () => {
      const v = parseData();
      base = b;
      if (v !== null) dataInput.value = formatData(v);
      update();
    });
    return el('label', {}, radio, ` ${label}`);
  }));
  const parseData = () => {
    const text = dataInput.value.trim().replace(/h$/i, '');
    if (text === '') return null;
    if (base === 'dec') {
      if (!/^-?\d+$/.test(text)) return null;
      const n = parseInt(text, 10);
      return n >= -32768 && n <= 32767 ? n : null;
    }
    if (base === 'hex') return /^[0-9a-f]{1,4}$/i.test(text) ? s16(parseInt(text, 16)) : null;
    return /^[01]{1,16}$/.test(text) ? s16(parseInt(text, 2)) : null;
  };
  const formatData = (v) => (base === 'dec' ? String(v) : base === 'hex' ? hex(v) : bin16(v));
  const dataPanel = el('div', {}, baseRow, el('div', { class: 'form-row' }, dataInput));

  // simple instruction
  const opSelect = el('select', {}, ...SIMPLE_OPS.slice(1).map((op, i) =>
    el('option', { value: String(i + 1), text: `${String(i + 1).padStart(2, ' ')}  ${op} – ${instructionDescription(op, settings.lang)}` })));
  const flagBox = (name, on) => el('input', { type: 'checkbox', checked: on });
  const xBox = flagBox('X', d && !d.complex && d.x === '1');
  const sBox = flagBox('S', d && !d.complex && d.s === '1');
  const iBox = flagBox('I', d && !d.complex && d.i === '1');
  const daInput = el('input', { type: 'number', min: '0', max: '255', value: d && !d.complex ? String(d.da) : '0' });
  if (d && !d.complex && d.op > 0) opSelect.value = String(d.op);
  const simplePanel = el('div', {},
    el('div', { class: 'form-row' }, el('label', { text: 'OP ' }), opSelect),
    el('div', { class: 'form-row' }, el('label', {}, xBox, ' X'), el('label', {}, sBox, ' S'), el('label', {}, iBox, ' I'),
      el('label', { text: 'DA ' }), daInput));

  // complex instruction
  const aopSelect = el('select', {}, ...COMPLEX_OPS.map((op, i) =>
    el('option', { value: String(i), text: `${String(i).padStart(2, ' ')}  ${op} – ${instructionDescription(op, settings.lang)}` })));
  const nInput = el('input', { type: 'number', min: '0', max: '127', value: d && d.complex ? String(d.n) : '0' });
  if (d && d.complex) aopSelect.value = String(d.aop);
  const complexPanel = el('div', {},
    el('div', { class: 'form-row' }, el('label', { text: 'AOP ' }), aopSelect),
    el('div', { class: 'form-row' }, el('label', { text: 'N ' }), nInput));

  const emptyPanel = el('div', {}, el('p', { text: `PAO[${addr}] = 0` }));
  const panels = { data: dataPanel, simple: simplePanel, complex: complexPanel, empty: emptyPanel };
  const preview = el('div', { class: 'preview' });
  const error = el('div', { class: 'error' });

  const compute = () => {
    const clampInt = (input, max) => {
      const n = parseInt(input.value, 10);
      return Number.isNaN(n) || n < 0 || n > max ? null : n;
    };
    if (mode === 'data') {
      const v = parseData();
      return v === null ? null : memoryCell(v, MEM_DATA);
    }
    if (mode === 'simple') {
      const da = clampInt(daInput, 255);
      if (da === null) return null;
      return memoryCell(encodeSimple(Number(opSelect.value), +xBox.checked, +sBox.checked, +iBox.checked, da), MEM_SIMPLE);
    }
    if (mode === 'complex') {
      const n = clampInt(nInput, 127);
      return n === null ? null : memoryCell(encodeComplex(Number(aopSelect.value), n), MEM_COMPLEX);
    }
    return emptyCell();
  };
  const update = () => {
    const c = compute();
    preview.textContent = c ? (c.bin ? `${c.bin}b   ${c.hex}h   ${cellValue(c)}d` : '—') : '';
    error.textContent = c ? '' : tr.invalidValue;
  };

  const tabs = el('div', { class: 'tabs' });
  const holder = el('div');
  const showTab = (name) => {
    mode = name;
    for (const b of tabs.children) b.classList.toggle('active', b.dataset.mode === name);
    holder.replaceChildren(panels[name]);
    update();
    setTimeout(() => panels[name].querySelector('input:not([type=radio]):not([type=checkbox]), select')?.focus());
  };
  for (const [name, label] of [['data', tr.choiceData], ['simple', tr.choiceSimple], ['complex', tr.choiceComplex], ['empty', tr.choiceEmpty]]) {
    tabs.append(el('button', { type: 'button', 'data-mode': name, text: label, onclick: () => showTab(name) }));
  }
  for (const input of [dataInput, opSelect, xBox, sBox, iBox, daInput, aopSelect, nInput]) {
    input.addEventListener('input', update);
    input.addEventListener('change', update);
  }
  showTab(mode);

  for (;;) {
    const result = await dialog(`${tr.memSubmitTitle} PAO[${addr}]`, el('div', {}, tabs, holder, preview, error), okCancel(), { wide: true });
    if (result !== 'ok') return;
    const c = compute();
    if (!c) continue;
    m.setMemory(addr, c);
    renderPORow(addr);
    renderCellDescription();
    persist();
    return;
  }
}

function clearCell() {
  if (m.running || locked()) return;
  m.setMemory(selectedPO, emptyCell());
  renderPORow(selectedPO);
  renderCellDescription();
  persist();
}

function logClass(line) {
  const tr = t();
  if (/={8}/.test(line) || line.trim() === tr.macro || line.trim() === tr.micro) return 'l-green';
  if (/={6}/.test(line) || /\|\s*(CEA|RRC|CWC|IWC|END)\s:/.test(line)) return 'l-blue';
  if (line.includes('-zmiana->')) return 'l-change';
  if (line.startsWith('AUTO:')) return 'l-auto';
  if (/={2}/.test(line) || line.includes(`${tr.mistake}(`) || line.includes(tr.criticalError) || line.includes(tr.notForStudents)) return 'l-err';
  return '';
}

async function showLog() {
  closeMenus();
  const pre = el('pre', { class: 'log-view' });
  const text = m.logText || '—';
  for (const line of text.split('\n')) {
    const cls = logClass(line);
    pre.append(cls ? el('span', { class: cls, text: line }) : line, '\n');
  }
  setTimeout(() => { pre.scrollTop = pre.scrollHeight; });
  const res = await dialog(t().showLog, pre, [{ label: t().downloadLog, value: 'download' }, ...closeOnly()], { wide: true });
  if (res === 'download') downloadLog();
}

function stamp() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}-${two(d.getMinutes())}`;
}

function download(name, data, type = 'text/plain;charset=utf-8') {
  const blob = data instanceof Uint8Array ? new Blob([data], { type: 'application/octet-stream' }) : new Blob([data], { type });
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

const crlf = (text) => text.replace(/\r?\n/g, '\r\n');

function downloadLog() {
  closeMenus();
  if (attempt) return downloadAttemptLog();
  const tr = t();
  const mark = m.mark == null ? '' : `${tr.mark}: ${m.mark}   `;
  const summary = `\n${mark}${tr.mistakes}: ${m.mistakes}   ${tr.cycle}: ${m.cycle}\n`;
  download(`LabZSK_${stamp()}.log`, crlf(m.logText + summary));
}

async function closeLog() {
  if (attempt || m.running || !(await confirmDialog(t().areYouSureCloseLog))) return;
  download(`LabZSK_${stamp()}.log`, crlf(m.closeLog()));
  m.log(`${t().programStart} ${new Date().toLocaleString()}\n`);
  simStart = null;
  persist();
  render();
}

function listingPM() {
  const lines = [];
  m.pm.forEach((row, r) => {
    let entry = ` ${String(r).padEnd(8)}`;
    let first = true;
    for (let c = 1; c < 12; c++) {
      if (row[c] === '') continue;
      if (!first) entry += ''.padEnd(9);
      first = false;
      const text = c === COL.NA ? row[c] : `${row[c].padEnd(8)}${microOpDescription(row[c], settings.lang)}`;
      entry += `${PM_COLUMNS[c].padEnd(8)}___${text}\n`;
    }
    if (!first) lines.push(entry);
  });
  return lines.join('\n');
}

function listingPO() {
  const lines = [];
  m.po.forEach((cell, r) => {
    if (!cell.bin) return;
    const d = decodeCell(cell);
    let text = `${String(r).padStart(4)}  ${cell.hex}h  ${cell.bin}  `;
    if (cell.type === MEM_DATA) text += `${t().data} ${cellValue(cell)}`;
    else if (d && d.complex) text += `${d.mnemo} N=${d.n}`;
    else if (d) text += `${d.mnemo} X=${d.x} S=${d.s} I=${d.i} DA=${d.da}`;
    lines.push(text);
  });
  return lines.join('\n');
}

async function showListing(title, text, fileName) {
  closeMenus();
  const pre = el('pre', { class: 'log-view', text: text || '—' });
  const res = await dialog(title, pre, [
    { label: t().download, value: 'download' },
    { label: t().printBtn, value: 'print' },
    ...closeOnly(),
  ], { wide: true });
  if (res === 'download') download(fileName, crlf(text));
  if (res === 'print') printText(title, text);
}

function printText(title, text) {
  const frame = el('iframe', { style: 'position:fixed;width:0;height:0;border:0' });
  document.body.append(frame);
  const doc = frame.contentDocument;
  doc.title = title;
  doc.body.append(Object.assign(doc.createElement('pre'), { textContent: text }));
  doc.body.style.font = '11px Consolas, monospace';
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 1000);
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = $('fileInput');
    input.value = '';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files[0];
      resolve(file ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : null);
    };
    input.click();
  });
}

async function loadPMFile() {
  if (m.running || locked()) return;
  closeMenus();
  const file = await pickFile('.pm');
  if (!file) return;
  try {
    const rows = loadPM(file.bytes);
    m.log(`\n${t().fileLoaded}: ${file.name}\n`);
    rows.forEach((row, r) => {
      for (let c = 1; c < 12; c++) if (m.pm[r][c] !== row[c]) m.setMicroOp(r, c, row[c]);
      renderPMRow(r);
    });
    persist();
    render();
    toast(`${t().loaded}: ${file.name}`);
  } catch (e) {
    toast(e.message === 'invalid' ? t().notValidMicrocodeFile : t().inconsistentFile, true);
  }
}

async function loadPOFile() {
  if (m.running || locked()) return;
  closeMenus();
  const file = await pickFile('.po');
  if (!file) return;
  try {
    const cells = loadPO(file.bytes);
    m.log(`\n${t().fileLoaded}: ${file.name}\n`);
    cells.forEach((cell, r) => {
      const old = m.po[r];
      if (old.bin !== cell.bin || old.type !== cell.type) m.setMemory(r, cell);
      renderPORow(r);
    });
    renderCellDescription();
    persist();
    toast(`${t().loaded}: ${file.name}`);
  } catch (e) {
    toast(e.message === 'invalid' ? t().notValidMemoryFile : t().inconsistentFile, true);
  }
}

async function clearPM() {
  if (m.running || locked() || !(await confirmDialog(t().areYouSureClearTable))) return;
  const empty = emptyPM();
  empty.forEach((row, r) => {
    for (let c = 1; c < 12; c++) if (m.pm[r][c] !== '') m.setMicroOp(r, c, '');
    renderPMRow(r);
  });
  persist();
}

async function clearPO() {
  if (m.running || locked() || !(await confirmDialog(t().areYouSureClearTable))) return;
  emptyPO().forEach((cell, r) => {
    if (m.po[r].bin !== '') m.setMemory(r, cell);
    renderPORow(r);
  });
  renderCellDescription();
  persist();
}

function clearRegisters() {
  if (m.running || autoRunning || locked()) return;
  if (editMode) toggleEditMode();
  m.clearRegisters({ keepScore: Boolean(attempt) });
  persist();
  render();
}

async function showSettings() {
  closeMenus();
  const tr = t();
  const lang = el('select', {}, el('option', { value: 'pl', text: 'Polski' }), el('option', { value: 'en', text: 'English' }));
  lang.value = settings.lang;
  const skin = el('select', {}, ...tr.skins.map((s, i) => el('option', { value: String(i), text: s })));
  skin.value = String(settings.skin);
  const teacher = el('input', { type: 'checkbox', checked: settings.teacher });
  const delay = el('input', { type: 'number', min: '0', max: '1000', value: String(settings.delay) });
  // a lab task has no automatic execution
  const free = !attempt && !viewer;
  const body = el('div', { class: 'settings' },
    el('div', { class: 'form-row' }, el('label', { text: tr.langLabel }), lang),
    el('div', { class: 'form-row' }, el('label', { text: tr.skinLabel }), skin),
    free ? el('div', { class: 'form-row' }, el('label', {}, teacher, ` ${tr.teacherMode}`)) : null,
    free ? el('div', { class: 'form-row' }, el('label', { text: tr.autoDelay }), delay) : null);
  if ((await dialog(tr.settings.replace('…', ''), body, okCancel())) !== 'ok') return;
  settings.skin = Number(skin.value);
  if (free) {
    settings.delay = Math.max(0, parseInt(delay.value, 10) || 0);
    if (teacher.checked && !settings.teacher) m.log(`${tr.notForStudents}\n`);
    settings.teacher = teacher.checked;
  }
  setLanguage(lang.value);
  persist();
}

async function showText(title, paragraphs) {
  closeMenus();
  await dialog(title, el('div', { class: 'about' }, ...paragraphs.map((p) => el('p', { text: p }))), closeOnly());
}

// ------------------------------------------------------------------ lab task and teacher's view
const taskTitle = (s) => t().taskTitle(s.course, s.session, s.task);

function renderAttemptBar() {
  if (!attempt && !viewer) return;
  const tr = t();
  const bar = $('attemptBar');
  bar.hidden = false;
  $('btnFinish').hidden = true;
  $('btnDownloadFinal').hidden = true;
  const conn = $('connState');
  if (viewer) {
    const a = view.attempt;
    bar.classList.toggle('finished', a.status === 'finished');
    bar.classList.add('viewer');
    $('attemptTask').textContent = taskTitle(a);
    $('attemptStudent').textContent = view.studentName ?? a.user;
    $('attemptNote').textContent = `${tr.viewerNote}${a.status === 'finished' ? ` ${tr.viewerFinished}` : ''}`;
    const on = a.status === 'active' && a.online;
    conn.className = `conn ${on ? 'online' : 'offline'}`;
    conn.textContent = a.status === 'finished' ? tr.viewerFinished : on ? tr.viewerOnline : tr.viewerOffline(a.lastSeen ? new Date(a.lastSeen).toLocaleTimeString() : '—');
    return;
  }
  const done = attempt.finished;
  bar.classList.toggle('finished', done);
  $('attemptTask').textContent = taskTitle(attempt.meta);
  $('attemptStudent').textContent = attempt.meta.user;
  $('attemptNote').textContent = done ? `${tr.finishedBanner} ${tr.finishedHint}` : tr.oneAttempt;
  $('btnFinish').hidden = done;
  $('btnFinish').disabled = Boolean(attempt.blocked);
  $('btnDownloadFinal').hidden = !done;
  conn.className = `conn ${attempt.connection}`;
  const label = { online: tr.connOnline, offline: tr.connOffline, connecting: tr.connConnecting }[attempt.connection];
  conn.textContent = attempt.unsent && attempt.connection === 'offline' ? `${label} (${tr.unsent(attempt.unsent)})` : label;
}

/** Links to other unfinished tasks held by this browser (each task has its own state). */
async function renderOtherTasks() {
  if (blocked || viewer) return;
  const tr = t();
  const others = (await localSessions()).filter((s) => !s.finished && s.key !== attempt?.key && s.link);
  const box = attempt ? $('attemptOthers') : $('freeBar');
  box.hidden = others.length === 0;
  box.replaceChildren(el('span', { text: attempt ? tr.otherUnfinished : tr.unfinishedTasks }),
    ...others.map((s) => el('a', { href: s.link, text: taskTitle(s) })));
}

function showBlocker(reason) {
  const tr = t();
  const [title, text] = tr.blocked[reason] ?? tr.blocked.invalid;
  autoRunning = false;
  gen = null;
  $('blockerTitle').textContent = title;
  $('blockerText').textContent = text;
  const buttons = [];
  if (['other-tab', 'cleared', 'not-configured', 'view-offline'].includes(reason)) {
    buttons.push(el('button', { class: 'btn primary', text: reason === 'cleared' ? tr.startAgain : tr.tryAgain, onclick: () => location.reload() }));
  }
  // work done in this browser can still be saved (e.g. a task started offline and refused later)
  if (attempt && m.logText && reason !== 'cleared') {
    buttons.push(el('button', { class: 'btn', text: tr.emergencySave, onclick: saveEmergencyLog }));
  }
  if (!viewer && !viewId) buttons.push(el('a', { class: 'btn', href: './', text: tr.freeModeLink }));
  $('blockerButtons').replaceChildren(...buttons);
  $('blocker').hidden = false;
  render();
}

async function finishWork() {
  if (!attempt || attempt.finished || attempt.blocked) return;
  closeMenus();
  if (!(await confirmDialog(t().finishConfirm))) return;
  autoRunning = false;
  if (gen) {
    gen.return();
    gen = null;
  }
  if (editMode) toggleEditMode();
  persist();
  await attempt.finish();
  render();
  await downloadAttemptLog();
}

/** Copy of the browser's log saved when the server cannot add its fingerprint; marked as unsigned. */
function emergencyLog() {
  const a = attempt.meta;
  const meta = {
    format: 'labzsk-log', v: 2, signed: false, reason: 'no-connection',
    user: a.user, course: a.course, session: a.session, task: a.task,
    status: attempt.finished ? 'finished' : 'in-progress', generatedAt: new Date().toISOString(),
    offlineStart: Boolean(a.offlineStart), mistakes: m.mistakes, unsentSteps: attempt.unsent,
  };
  return [
    m.logText.replace(/\n$/, ''),
    '',
    '================ LabZSK – LOG AWARYJNY, NIEPODPISANY (zapisany bez połączenia z serwerem LabZSK) ================',
    '!!! Ten log NIE ma odcisku serwera i NIE jest zweryfikowany. Student ma obowiązek poinformować nauczyciela.',
    `Student (userId): ${a.user}`,
    `Kurs / zajęcia / zadanie: ${a.course} / ${a.session} / ${a.task}`,
    `Zapisano:      ${new Date().toLocaleString('pl-PL')}`,
    `Błędy:         ${m.mistakes}`,
    `Niewysłane:    kroki, które nie dotarły do serwera: ${attempt.unsent}${a.offlineStart ? ' (zadanie rozpoczęte bez połączenia)' : ''}`,
    `#LABZSK ${JSON.stringify(meta)}`,
    '',
  ].join('\n');
}

function logFileName(suffix = '') {
  const a = attempt.meta;
  return `LabZSK_${a.user}_${a.course}-${a.session}-${a.task}${suffix}.log`;
}

function saveEmergencyLog() {
  download(logFileName('_AWARYJNY_NIEPODPISANY'), crlf(emergencyLog()));
  toast(t().emergencySaved, true);
}

async function downloadAttemptLog() {
  const tr = t();
  if (!attempt.finished) {
    toast(tr.logAfterFinish);
    return;
  }
  try {
    download(logFileName(), await attempt.finalLog());
    toast(tr.signedSaved);
  } catch (e) {
    if (attempt.blocked) return;
    if (e.status && e.status < 500) {
      toast(e.message, true);
      return;
    }
    render();
    const res = await dialog(tr.emergencyTitle, el('div', { class: 'about' }, ...tr.emergencyText.map((p) => el('p', { text: p }))), [
      { label: tr.cancel, value: '' },
      { label: tr.emergencySave, value: 'emergency' },
      { label: tr.tryAgain, value: 'retry', primary: true },
    ]);
    if (res === 'retry') await downloadAttemptLog();
    if (res === 'emergency') saveEmergencyLog();
  }
}

function startAttempt() {
  const tr = t();
  attempt.onChange((e) => {
    if (e.type === 'connection' && e.after === 'offline' && e.before === 'online') toast(t().connLost, true);
    if (e.type === 'synced') toast(t().connBack(e.offline));
    if (e.type === 'blocked') showBlocker(e.reason);
    render();
  });
  attempt.start(() => ({ mistakes: m.mistakes, cycle: m.cycle, live: liveState(), pm: m.pm, po: m.po }));
  if (!attempt.finished) {
    const now = new Date().toLocaleString();
    const offline = attempt.connection === 'offline' ? ` – ${tr.startedOffline}` : '';
    if (!m.logText) m.log(`${tr.attemptStart}: ${taskTitle(attempt.meta)} – userId ${attempt.meta.user} (${now})${offline}\n${tr.browser}: ${navigator.userAgent}\n\n`);
    else m.log(`\n--- ${tr.pageReloaded} (${now}) ---\n`);
    persist();
  }
  if (attempt.connection === 'offline') toast(tr.connLost, true);
}

/** Teacher's view: follows the student's state and log through the panel's live stream. */
function startViewer() {
  const stream = new EventSource('../api/stream');
  stream.addEventListener('state', (e) => {
    const { id, state } = JSON.parse(e.data);
    if (id !== viewId) return;
    applyLive(state);
    if (state.pm) for (let r = 0; r < 256; r++) renderPMRow(r);
    if (state.po) {
      for (let r = 0; r < 256; r++) renderPORow(r);
      renderCellDescription();
    }
    miniLogLast = null;
    render();
  });
  stream.addEventListener('attempt', (e) => {
    const { attempt: a, events } = JSON.parse(e.data);
    if (a.id !== viewId) return;
    view.attempt = a;
    for (const ev of events) m.logText += eventText(ev);
    render();
  });
  stream.addEventListener('removed', (e) => {
    if (JSON.parse(e.data).id === viewId) showBlocker('cleared');
  });
  setInterval(render, 5000); // connection state of the student
}

// ------------------------------------------------------------------ misc
let toastTimer;
function toast(text, bad = false) {
  const node = $('toast');
  node.textContent = text;
  node.classList.toggle('bad', bad);
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), bad ? 4000 : 2500);
}

function closeMenus() {
  for (const d of document.querySelectorAll('details.menu[open]')) d.open = false;
}

function setLanguage(lang) {
  settings.lang = lang;
  m.lang = lang;
  document.documentElement.lang = lang;
  const tr = t();
  for (const node of document.querySelectorAll('[data-t]')) node.textContent = tr[node.dataset.t];
  $('langBtn').textContent = lang === 'pl' ? 'EN' : 'PL';
  document.querySelector('#pmTable th').textContent = tr.address;
  const poHead = document.querySelectorAll('#poTable th');
  poHead[0].textContent = tr.address;
  poHead[1].textContent = tr.content;
  $('cpu').dataset.skin = String(settings.skin);
  miniLogLast = null;
  renderCellDescription();
  renderOtherTasks();
  render();
}

const ACTIONS = {
  macro: () => startCycle(false),
  micro: () => startCycle(true),
  ok: confirm,
  next: nextTact,
  auto: autoRun,
  showLog,
  downloadLog,
  closeLog,
  editRegisters: toggleEditMode,
  clearRegisters,
  settings: showSettings,
  loadPM: loadPMFile,
  savePM: () => { closeMenus(); download(`LabZSK_${stamp()}.pm`, savePM(m.pm)); },
  printPM: () => showListing(t().pmTitle, listingPM(), `PM_${stamp()}.txt`),
  clearPM,
  loadPO: loadPOFile,
  savePO: () => { closeMenus(); download(`LabZSK_${stamp()}.po`, savePO(m.po)); },
  printPO: () => showListing(t().poTitle, listingPO(), `PO_${stamp()}.txt`),
  clearPO,
  finish: finishWork,
  editCell: () => { closeMenus(); editCell(); },
  clearCell: () => { closeMenus(); clearCell(); },
  help: () => showText(t().menuHelp, t().helpText),
  about: () => showText(t().about, t().aboutText),
  lang: () => { setLanguage(settings.lang === 'pl' ? 'en' : 'pl'); persist(); },
};

document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-action]');
  if (button && !button.disabled) {
    if (button.closest('.menu-list')) closeMenus();
    ACTIONS[button.dataset.action]?.();
  }
  if (!e.target.closest('details.menu')) closeMenus();
});

for (const d of document.querySelectorAll('details.menu')) {
  d.addEventListener('toggle', () => {
    if (d.open) for (const other of document.querySelectorAll('details.menu[open]')) if (other !== d) other.open = false;
  });
}

document.addEventListener('keydown', (e) => {
  if (dlg.open) return;
  const target = e.target;
  if (e.key === 'Escape') {
    closeMenus();
    if (editMode) toggleEditMode();
    return;
  }
  if (e.key !== 'Enter' || e.repeat) return;
  if (target.closest('button, summary, select, textarea, a, input')) return;
  e.preventDefault();
  if (m.waiting === 'ok') confirm();
  else if (m.waiting === 'tact') nextTact();
  else if (!m.running && !editMode) startCycle(false);
});

window.addEventListener('beforeunload', (e) => {
  if (!viewer && (m.running || autoRunning)) e.preventDefault();
});

// ------------------------------------------------------------------ start
if (!attempt && !blocked && !viewer && !m.logText) m.log(`${strings(settings.lang).programStart} ${appStart.toLocaleString()}\n${strings(settings.lang).browser}: ${navigator.userAgent}\n\n`);
buildCPU();
buildPM();
buildPO();
selectPO(0);
setLanguage(settings.lang);
tickClock();
setInterval(tickClock, 1000);
if (attempt) startAttempt();
if (viewer) startViewer();
if (blocked) showBlocker(blocked.blocked);
// offline copy of the page (needs HTTPS or localhost; elsewhere the browser does not allow it)
if (!viewId && 'serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
