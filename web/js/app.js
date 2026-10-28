// User interface of the LabZSK web simulator.

import { Machine, REG_NAMES, FLAG_NAMES, NOT_EDITABLE, DEFAULT_MARKS, emptyPM, emptyPO } from './engine.js';
import {
  COL, PM_COLUMNS, SIMPLE_OPS, COMPLEX_OPS, hex, bin16, s16, parseValue, decodeCell, cellValue,
  microOpDescription, instructionDescription, memoryCell, emptyCell, encodeSimple, encodeComplex,
  MEM_EMPTY, MEM_DATA, MEM_SIMPLE, MEM_COMPLEX,
} from './isa.js';
import { strings } from './i18n.js';
import { savePM, loadPM, savePO, loadPO } from './files.js';

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
const STATE_KEY = 'labzsk:state';
const SETTINGS_KEY = 'labzsk:settings';

const settings = { lang: 'pl', skin: 0, marks: { ...DEFAULT_MARKS }, teacher: false, delay: 200 };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'));
} catch { /* storage unavailable */ }

const m = new Machine({ lang: settings.lang, marks: settings.marks });
try {
  m.restore(JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null'));
} catch { /* storage unavailable or corrupted */ }

let gen = null; // running cycle
let editMode = false;
let autoRunning = false;
let selectedPO = 0;
const appStart = new Date();
let simStart = null;

const t = () => strings(settings.lang);

function persist() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(m.snapshot()));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* storage unavailable */ }
}

// ------------------------------------------------------------------ CPU diagram
const W = 160;
const H = 34;
const POS = {
  LK: [45, 40], A: [295, 40], MQ: [545, 40], X: [795, 40],
  RAP: [45, 140], LALU: [295, 140], RALU: [545, 140],
  RBP: [45, 240], ALU: [420, 240],
  BUS: [45, 330],
  RR: [295, 385], LR: [545, 385], RI: [795, 385],
  RBPS: [295, 480], RAPS: [545, 480], RAE: [795, 480],
  L: [345, 445], R: [570, 445], SUMA: [457, 515],
};
const FLAG_POS = { ZNAK: [790, 150], XRO: [850, 150], OFF: [910, 150], MAV: [790, 250], IA: [850, 250], INT: [910, 250] };
const VH = 560;

const regEls = {};
const flagEls = {};
let rbpsEl;

function place(node, [x, y], w = W, h = H) {
  Object.assign(node.style, { left: `${x / 10}%`, top: `${(y / VH) * 100}%`, width: `${w / 10}%`, height: `${(h / VH) * 100}%` });
}

function buildCPU() {
  const cpu = $('cpu');
  for (const name of REG_NAMES) {
    const input = el('input', { type: 'text', readonly: true, spellcheck: 'false', autocomplete: 'off', 'aria-label': name });
    const cls = ['reg'];
    if (name === 'ALU' || name === 'SUMA') cls.push('center');
    if (name === 'L' || name === 'R') cls.push('right');
    if (name === 'BUS') cls.push('bus');
    if (name === 'RAPS') cls.push('ps');
    const box = el('div', { class: cls.join(' ') }, el('span', { class: 'reg-name', text: name }), input);
    place(box, POS[name]);
    input.addEventListener('focus', () => onRegFocus(name));
    input.addEventListener('blur', () => onRegBlur(name));
    input.addEventListener('keydown', (e) => onRegKey(e, name));
    cpu.append(box);
    regEls[name] = { box, input };
  }
  rbpsEl = el('div', { class: 'reg ps' }, el('span', { class: 'reg-name', text: 'RBPS' }),
    el('input', { type: 'text', readonly: true, tabindex: '-1', 'aria-label': 'RBPS' }));
  place(rbpsEl, POS.RBPS);
  cpu.append(rbpsEl);
  for (const name of FLAG_NAMES) {
    const input = el('input', { type: 'text', readonly: true, maxlength: '1', 'aria-label': name });
    const label = el('span', { class: 'reg-name', text: name });
    const box = el('div', { class: 'flag' }, label, input);
    place(box, FLAG_POS[name], 34, 34);
    input.addEventListener('focus', () => { if (editMode) input.select(); });
    input.addEventListener('input', () => {
      if (!editMode) return;
      const v = input.value.trim().slice(-1);
      if (v === '0' || v === '1') m.flags[name] = Number(v);
      input.value = String(m.flags[name]);
      input.select();
    });
    cpu.append(box);
    flagEls[name] = { box, input, label };
  }
  cpu.addEventListener('dblclick', (e) => {
    if (e.target === cpu || e.target.closest('svg')) toggleEditMode();
  });
}

function line(x1, y1, x2, y2, cls = 'bus') {
  return `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
}
const cx = (n) => POS[n][0] + W / 2;
const cy = (n) => POS[n][1] + H / 2;
const bottom = (n) => POS[n][1] + H;

function trapezoid(from, to) {
  const [fx, fy] = POS[from];
  const [tx, ty] = POS[to];
  return `<polygon class="alu" points="${fx},${fy + H} ${fx + W},${fy + H} ${tx + W},${ty} ${tx},${ty}"/>`;
}

function drawWires() {
  const cea = m.ceaLayout;
  const busX = 20;
  let s = '';
  s += `<polyline class="bus" points="${busX},548 ${busX},12 ${cx('X')},12"/>`;
  for (const n of ['LK', 'A', 'MQ', 'X']) s += line(cx(n), 12, cx(n), cy(n));
  for (const n of ['RAP', 'RBP', 'BUS']) s += line(busX, cy(n), cx(n), cy(n));
  s += line(cx('BUS'), cy('BUS'), 1000, cy('BUS'));
  for (const n of ['RR', 'LR', 'RI']) s += line(cx(n), cy('BUS'), cx(n), cy(n));
  s += line(cx('A'), cy('A'), cx('LALU'), cy('LALU'));
  s += line(cx('A'), cy('A'), cx('MQ'), cy('MQ'), 'bus thin');
  s += trapezoid('LALU', 'ALU') + trapezoid('RALU', 'ALU');
  s += line(cx('ALU'), cy('ALU'), cx('ALU'), cy('BUS'));
  s += `<polyline class="bus" points="${cx('RALU')},${cy('RALU')} ${cx('RALU')},105 ${cx('X')},105 ${cx('X')},${cy('X')}"/>`;
  if (cea) {
    const raeY = POS.SUMA[1] + H / 2;
    s += `<polyline class="bus" points="${cx('RR')},${cy('RR')} ${cx('RR')},${cy('L')} ${cx('L')},${cy('L')}"/>`;
    s += `<polyline class="bus" points="${cx('RI')},${cy('RI')} ${cx('RI')},${cy('R')} ${cx('R')},${cy('R')}"/>`;
    s += line(cx('LR'), cy('LR'), cx('LR'), cy('R'));
    s += trapezoid('L', 'SUMA') + trapezoid('R', 'SUMA');
    s += line(cx('SUMA'), raeY, cx('RAE'), raeY);
  } else {
    s += `<polyline class="bus" points="${cx('RAE')},${cy('RAE')} ${cx('RAE')},548 ${busX},548"/>`;
  }
  $('wires').innerHTML = s;
}

function regText(v) {
  return `${hex(v)}h   ${v}`;
}

function isChecked(name) {
  return m.waiting === 'ok' && m.registerToCheck === name && m.regs[name].needCheck;
}

function isEditable(name) {
  return (editMode && !NOT_EDITABLE.includes(name)) || isChecked(name);
}

let wiresCea = null;
function renderCPU() {
  const cea = m.ceaLayout;
  if (wiresCea !== cea) {
    drawWires();
    wiresCea = cea;
    place(regEls.RAE.box, cea ? [POS.RAE[0], POS.SUMA[1]] : POS.RAE);
  }
  for (const name of REG_NAMES) {
    const { box, input } = regEls[name];
    const hidden = cea ? name === 'RAPS' : ['L', 'R', 'SUMA'].includes(name);
    box.classList.toggle('hidden', hidden);
    const editable = isEditable(name);
    box.classList.toggle('check', isChecked(name));
    box.classList.toggle('editable', editMode && editable);
    input.readOnly = !editable;
    input.tabIndex = editable ? 0 : -1;
    if (document.activeElement !== input || !editable) input.value = regText(m.regs[name].value);
    input.placeholder = regText(m.regs[name].value);
  }
  rbpsEl.classList.toggle('hidden', cea);
  rbpsEl.querySelector('input').value = m.rbps;
  for (const name of FLAG_NAMES) {
    const { box, input, label } = flagEls[name];
    label.textContent = m.flagLabel(name);
    input.readOnly = !editMode;
    box.classList.toggle('editable', editMode);
    if (document.activeElement !== input) input.value = String(m.flags[name]);
  }
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

function render() {
  const tr = t();
  renderCPU();
  renderPMHighlight();
  renderPOHighlight();
  $('infoMark').textContent = m.mark;
  $('infoMark').classList.toggle('bad', m.mistakes >= m.marks.third);
  $('infoMistakes').textContent = m.mistakes;
  $('infoTact').textContent = m.tact;
  $('infoCycle').textContent = m.cycle;

  const status = $('status');
  status.className = 'status';
  if (editMode) {
    status.textContent = tr.editMode;
    status.classList.add('edit');
  } else if (m.running) {
    status.textContent = tr.startMode;
    status.classList.add('running');
  } else if (!m.canSimulate) {
    status.textContent = tr.haltMode;
    status.classList.add('running');
  } else status.textContent = tr.stopMode;

  const idle = !m.running && !editMode && !autoRunning;
  $('btnMacro').hidden = !idle;
  $('btnMicro').hidden = !idle;
  $('btnMacro').disabled = $('btnMicro').disabled = !m.canSimulate;
  $('btnOk').hidden = m.waiting !== 'ok' || autoRunning;
  $('btnNext').hidden = m.waiting !== 'tact' || autoRunning;
  $('btnEndEdit').hidden = !editMode;
  $('autoBox').hidden = !settings.teacher;
  $('btnAuto').textContent = autoRunning ? tr.autoStop : tr.autoBtn;
  $('btnAuto').disabled = !autoRunning && (!idle || !m.canSimulate);
  $('menuEdit').textContent = editMode ? tr.endEditRegisters : tr.editRegisters;
  for (const b of document.querySelectorAll('.menu-list button')) {
    b.disabled = (m.running || autoRunning) && LOCKED_ACTIONS.includes(b.dataset.action);
  }
  $('pmTable').classList.toggle('locked', m.running || autoRunning);
  renderMiniLog();
}

let miniLogLength = -1;
function renderMiniLog() {
  if (miniLogLength === m.miniLog.length && m.miniLog.length > 0) return;
  miniLogLength = m.miniLog.length;
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
  if (gen || editMode || autoRunning || !m.canSimulate) return;
  closeMenus();
  if (!simStart) simStart = new Date();
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
  if (gen || editMode || !m.canSimulate) return;
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
  if (m.running || autoRunning) return;
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
  if (m.running || autoRunning) return;
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
  if (m.running || autoRunning) return;
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
  if (m.running) return;
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
  const tr = t();
  const summary = `\n${tr.mark}: ${m.mark}   ${tr.mistakes}: ${m.mistakes}   ${tr.cycle}: ${m.cycle}\n`;
  download(`LabZSK_${stamp()}.log`, crlf(m.logText + summary));
}

async function closeLog() {
  if (m.running || !(await confirmDialog(t().areYouSureCloseLog))) return;
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
  if (m.running) return;
  closeMenus();
  const file = await pickFile('.pm');
  if (!file) return;
  try {
    const rows = loadPM(file.bytes);
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
  if (m.running) return;
  closeMenus();
  const file = await pickFile('.po');
  if (!file) return;
  try {
    const cells = loadPO(file.bytes);
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
  if (m.running || !(await confirmDialog(t().areYouSureClearTable))) return;
  const empty = emptyPM();
  empty.forEach((row, r) => {
    for (let c = 1; c < 12; c++) if (m.pm[r][c] !== '') m.setMicroOp(r, c, '');
    renderPMRow(r);
  });
  persist();
}

async function clearPO() {
  if (m.running || !(await confirmDialog(t().areYouSureClearTable))) return;
  emptyPO().forEach((cell, r) => {
    if (m.po[r].bin !== '') m.setMemory(r, cell);
    renderPORow(r);
  });
  renderCellDescription();
  persist();
}

function clearRegisters() {
  if (m.running || autoRunning) return;
  if (editMode) toggleEditMode();
  m.clearRegisters();
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
  const num = (v, min = 1) => el('input', { type: 'number', min: String(min), max: '1000', value: String(v) });
  const first = num(settings.marks.first);
  const second = num(settings.marks.second);
  const third = num(settings.marks.third);
  const teacher = el('input', { type: 'checkbox', checked: settings.teacher });
  const delay = num(settings.delay, 0);
  const body = el('div', { class: 'settings' },
    el('div', { class: 'form-row' }, el('label', { text: tr.langLabel }), lang),
    el('div', { class: 'form-row' }, el('label', { text: tr.skinLabel }), skin),
    el('fieldset', {}, el('legend', { text: tr.marksLabel }),
      el('div', { class: 'form-row' }, el('label', { text: tr.markFor(4) }), first, el('label', { text: tr.markFor(3) }), second,
        el('label', { text: tr.markFor(2) }), third)),
    el('div', { class: 'form-row' }, el('label', {}, teacher, ` ${tr.teacherMode}`)),
    el('div', { class: 'form-row' }, el('label', { text: tr.autoDelay }), delay),
    el('p', { class: 'error', text: '' }));
  if ((await dialog(tr.settings.replace('…', ''), body, okCancel())) !== 'ok') return;
  const marks = [first, second, third].map((i) => Math.max(1, parseInt(i.value, 10) || 1)).sort((a, b) => a - b);
  settings.marks = { first: marks[0], second: marks[1], third: marks[2] };
  settings.skin = Number(skin.value);
  settings.delay = Math.max(0, parseInt(delay.value, 10) || 0);
  if (teacher.checked && !settings.teacher) m.log(`${tr.notForStudents}\n`);
  settings.teacher = teacher.checked;
  m.marks = { ...settings.marks };
  m.updateMark();
  setLanguage(lang.value);
  persist();
}

async function showText(title, paragraphs) {
  closeMenus();
  await dialog(title, el('div', { class: 'about' }, ...paragraphs.map((p) => el('p', { text: p }))), closeOnly());
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
  miniLogLength = -1;
  renderCellDescription();
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
  if (m.running || autoRunning) e.preventDefault();
});

// ------------------------------------------------------------------ start
if (!m.logText) m.log(`${strings(settings.lang).programStart} ${appStart.toLocaleString()}\n${strings(settings.lang).browser}: ${navigator.userAgent}\n\n`);
buildCPU();
buildPM();
buildPO();
selectPO(0);
setLanguage(settings.lang);
tickClock();
setInterval(tickClock, 1000);
