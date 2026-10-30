// The CPU diagram (registers, flags, buses). Used by the simulator and, read-only, by the teacher panel.

import { REG_NAMES, FLAG_NAMES } from './engine.js';
import { hex } from './isa.js';

const W = 160;
const H = 34;
const VH = 560;
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

export const regText = (v) => `${hex(v)}h   ${v}`;

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...children);
  return e;
}

function place(node, [x, y], w = W, h = H) {
  Object.assign(node.style, { left: `${x / 10}%`, top: `${(y / VH) * 100}%`, width: `${w / 10}%`, height: `${(h / VH) * 100}%` });
}

const cx = (n) => POS[n][0] + W / 2;
const cy = (n) => POS[n][1] + H / 2;
const line = (x1, y1, x2, y2, cls = 'bus') => `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;

function trapezoid(from, to) {
  const [fx, fy] = POS[from];
  const [tx, ty] = POS[to];
  return `<polygon class="alu" points="${fx},${fy + H} ${fx + W},${fy + H} ${tx + W},${ty} ${tx},${ty}"/>`;
}

function wires(cea) {
  const busX = 20;
  let s = `<polyline class="bus" points="${busX},548 ${busX},12 ${cx('X')},12"/>`;
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
  return s;
}

/**
 * Builds the diagram inside `cpu` (an element with class "cpu" containing svg.wires).
 * render(view) shows { regs: {name: value}, flags: {name: 0|1}, rbps, cea, checked, editMode,
 * editable(name), flagLabel(name) }; inputs being edited keep the typed text.
 */
export function createCpu(cpu) {
  const svg = cpu.querySelector('svg.wires');
  const regEls = {};
  const flagEls = {};
  for (const name of REG_NAMES) {
    const input = el('input', { type: 'text', readonly: true, spellcheck: 'false', autocomplete: 'off', 'aria-label': name, tabindex: '-1' });
    const cls = ['reg'];
    if (name === 'ALU' || name === 'SUMA') cls.push('center');
    if (name === 'L' || name === 'R') cls.push('right');
    if (name === 'BUS') cls.push('bus');
    if (name === 'RAPS') cls.push('ps');
    const box = el('div', { class: cls.join(' ') }, el('span', { class: 'reg-name', text: name }), input);
    place(box, POS[name]);
    cpu.append(box);
    regEls[name] = { box, input };
  }
  const rbpsEl = el('div', { class: 'reg ps' }, el('span', { class: 'reg-name', text: 'RBPS' }),
    el('input', { type: 'text', readonly: true, tabindex: '-1', 'aria-label': 'RBPS' }));
  place(rbpsEl, POS.RBPS);
  cpu.append(rbpsEl);
  for (const name of FLAG_NAMES) {
    const input = el('input', { type: 'text', readonly: true, maxlength: '1', 'aria-label': name, tabindex: '-1' });
    const label = el('span', { class: 'reg-name', text: name });
    const box = el('div', { class: 'flag' }, label, input);
    place(box, FLAG_POS[name], 34, 34);
    cpu.append(box);
    flagEls[name] = { box, input, label };
  }

  let wiresCea = null;
  function render(v) {
    const cea = Boolean(v.cea);
    if (wiresCea !== cea) {
      svg.innerHTML = wires(cea);
      wiresCea = cea;
      place(regEls.RAE.box, cea ? [POS.RAE[0], POS.SUMA[1]] : POS.RAE);
    }
    for (const name of REG_NAMES) {
      const { box, input } = regEls[name];
      const value = v.regs?.[name] ?? 0;
      box.classList.toggle('hidden', cea ? name === 'RAPS' : ['L', 'R', 'SUMA'].includes(name));
      const editable = Boolean(v.editable?.(name));
      box.classList.toggle('check', v.checked === name);
      box.classList.toggle('editable', Boolean(v.editMode) && editable);
      input.readOnly = !editable;
      input.tabIndex = editable ? 0 : -1;
      if (document.activeElement !== input || !editable) input.value = regText(value);
      input.placeholder = regText(value);
    }
    rbpsEl.classList.toggle('hidden', cea);
    rbpsEl.querySelector('input').value = v.rbps ?? '';
    for (const name of FLAG_NAMES) {
      const { box, input, label } = flagEls[name];
      label.textContent = v.flagLabel ? v.flagLabel(name) : name;
      input.readOnly = !v.editMode;
      input.tabIndex = v.editMode ? 0 : -1;
      box.classList.toggle('editable', Boolean(v.editMode));
      if (document.activeElement !== input) input.value = String(v.flags?.[name] ?? 0);
    }
  }

  return { regEls, flagEls, render };
}
