// LabZSK processor model. A faithful port of LabZKT/Simulation/Execution.cs.
//
// A simulation cycle (one microinstruction) is a generator. It yields:
//   'ok'   – the student must enter the value of `registerToCheck` and confirm,
//   'tact' – in MICRO mode, the student must advance to the next tact.
// The caller resumes the generator with next(); validation happens on resume.

import {
  s16, hex, bin16, COL, PM_COLUMNS, SHIFT_OPS, rbpsValue, microOpDescription,
  memoryCell, emptyCell, cellValue, MEM_DATA, COLUMN_OPTIONS,
} from './isa.js';
import { strings } from './i18n.js';

export const REG_NAMES = ['LK', 'A', 'MQ', 'X', 'RAP', 'LALU', 'RALU', 'RBP', 'ALU', 'BUS', 'RR', 'LR', 'RI',
  'RAPS', 'RAE', 'L', 'R', 'SUMA'];
export const FLAG_NAMES = ['MAV', 'IA', 'INT', 'ZNAK', 'XRO', 'OFF'];
// Registers the student cannot change in register edit mode.
export const NOT_EDITABLE = ['BUS', 'LALU', 'RALU', 'L', 'R', 'SUMA'];

export const DEFAULT_MARKS = { first: 2, second: 6, third: 10 };

class Register {
  constructor(name) {
    this.name = name;
    this.value = 0; // value shown in the register (innerValue)
    this.expected = 0; // value the microoperation moves into it (valueWhichShouldBeMovedToRegister)
    this.needCheck = false;
  }
  clamp() {
    if (this.name === 'LK') this.expected &= 127;
    else if (this.name === 'RAPS' || this.name === 'RAP' || this.name === 'SUMA') {
      this.value &= 255;
      this.expected &= 255;
    }
  }
  setValue(v) {
    this.value = s16(v);
    this.clamp();
  }
  setExpected(v) {
    this.expected = s16(v);
    this.clamp();
  }
  setBoth(v) {
    this.value = this.expected = s16(v);
    this.needCheck = false;
    this.clamp();
  }
  reset() {
    this.value = this.expected = 0;
    this.needCheck = false;
  }
  get text() {
    return `${hex(this.value)}h\t${this.value}`;
  }
}

const pad = (s, n) => String(s).padStart(n, ' ');
const time = () => new Date().toTimeString().slice(0, 8).replace(/:(\d\d)$/, '.$1');

export function emptyPM() {
  return Array.from({ length: 256 }, (_, i) => [String(i), '', '', '', '', '', '', '', '', '', '', '']);
}

export function emptyPO() {
  return Array.from({ length: 256 }, emptyCell);
}

export class Machine {
  constructor({ lang = 'pl', marks = DEFAULT_MARKS } = {}) {
    this.lang = lang;
    this.marks = marks && { ...marks };
    this.regs = Object.fromEntries(REG_NAMES.map((n) => [n, new Register(n)]));
    this.flags = Object.fromEntries(FLAG_NAMES.map((n) => [n, n === 'MAV' ? 1 : 0]));
    this.pm = emptyPM();
    this.po = emptyPO();
    this.cells = Array.from({ length: 11 }, () => new Array(8).fill(false));
    this.mark = 5;
    this.mistakes = 0;
    this.cycle = 0;
    this.tact = 0;
    this.running = false;
    this.inMicroMode = false;
    this.canSimulate = true;
    this.halt = false;
    this.waiting = null;
    this.registerToCheck = '';
    this.flagToCheck = '';
    this.isTestPositive = false;
    this.isOverflow = false;
    this.resetBus = false;
    this.ceaLayout = false;
    this.raps = 0;
    this.na = 0;
    this.rbps = '000000000000h';
    this.current = null; // { row, col } of the PM cell being executed
    this.memCursor = null; // PO address touched by the last memory microoperation
    this.lastCheck = null; // { name, ok, bad, good } result of the last validation
    this.miniLog = [];
    this.logText = '';
    this.logOpen = false;
    this.auto = false;
  }

  get t() {
    return strings(this.lang);
  }

  // ---------------------------------------------------------------- log
  log(text) {
    this.logText += text;
  }

  addToLogAndMiniLog(tact, mnemo, description) {
    const head = pad(tact, 8) + ' | ' + pad(mnemo, 4) + ' : ';
    if (mnemo === 'END') this.log(`${head}(${this.t.cycle} ${this.cycle}) ${description} (${time()})\n`);
    else if (mnemo === 'TINT') this.log(`${head}${description}(INT ?= 0)\n`);
    else this.log(`${head}${description}\n`);
    this.miniLog.push({ tact, mnemo, description });
  }

  desc(mnemo) {
    return microOpDescription(mnemo, this.lang);
  }

  openLog() {
    const t = this.t;
    this.logOpen = true;
    this.log(`${t.startingSimulation}\n${pad(time(), 20)}\n${t.registersContent}\n`);
    for (const r of Object.values(this.regs)) this.log(`${r.name.padEnd(6)} = ${r.text}\n`);
    this.log('\n');
    FLAG_NAMES.forEach((f, i) => {
      this.log(`${pad(this.flagLabel(f), 5)} = ${this.flags[f]}`);
      this.log((i + 1) % 3 === 0 ? '\n' : ', ');
    });
    this.log('\n');
  }

  closeLog() {
    const t = this.t;
    const mark = this.mark == null ? '' : `${t.mark}: ${this.mark}   `;
    this.log(`\n${pad(time(), 20)}\n${t.simStop}\n${mark}${t.mistakes}: ${this.mistakes}\n`);
    const text = this.logText;
    this.logText = '';
    this.logOpen = false;
    return text;
  }

  flagLabel(f) {
    return f === 'ZNAK' ? this.t.sign : f;
  }

  // ---------------------------------------------------------- registers
  testAndSet(name, value) {
    const r = this.regs[name];
    r.setExpected(value);
    r.needCheck = true;
    this.registerToCheck = name;
  }

  /** Without thresholds (marks = null) the simulator gives no mark. */
  updateMark() {
    if (!this.marks) {
      this.mark = null;
      return;
    }
    const { first, second, third } = this.marks;
    if (this.mistakes >= third) this.mark = 2;
    else if (this.mistakes >= second) this.mark = 3;
    else if (this.mistakes >= first) this.mark = 4;
    else this.mark = 5;
  }

  validateRegisters() {
    const t = this.t;
    this.lastCheck = null;
    if (this.registerToCheck !== '') {
      const name = this.registerToCheck;
      const r = this.regs[name];
      r.needCheck = false;
      r.clamp();
      const nl = name === 'RAPS' ? '\n' : '';
      if (r.value !== r.expected) {
        const bad = r.value;
        r.value = r.expected;
        this.log(`${nl}${pad(t.mistake, 14)}(${this.mistakes + 1}): ${name} = ${bad} / ${hex(bad)}h (${t.correct} ${name} = ${r.value} / ${hex(r.value)}h)\n\n`);
        this.mistakes++;
        this.updateMark();
        this.lastCheck = { name, ok: false, bad, good: r.value };
      } else {
        this.log(`${nl}${pad(name, 15)} = ${r.value} / ${hex(r.value)}h\n`);
        this.lastCheck = { name, ok: true, good: r.value };
      }
      this.registerToCheck = '';
    }
    if (this.flagToCheck !== '') {
      this.log(`${pad(this.flagToCheck, 15)} = ${this.flags[this.flagToCheck]}\n`);
      this.flagToCheck = '';
    }
  }

  /** Called by the UI when the student types a value into a register. */
  enterValue(name, value) {
    this.regs[name].setValue(value);
  }

  *waitOK() {
    this.waiting = 'ok';
    yield 'ok';
    this.waiting = null;
    this.validateRegisters();
  }

  *nextTact() {
    if (this.inMicroMode) {
      this.waiting = 'tact';
      yield 'tact';
      this.waiting = null;
    }
    this.tact = (this.tact + 1) % 8;
  }

  selectPM(col, row = this.raps) {
    this.current = { row, col };
  }

  op(col) {
    this.selectPM(col);
    return this.pm[this.raps][col];
  }

  // ------------------------------------------------------- simulation
  *runCycle(micro) {
    if (this.running || !this.canSimulate) return;
    this.inMicroMode = micro;
    if (!this.logOpen) this.openLog();
    if (this.auto) this.log(`\nAUTO: ${this.t.notForStudents}\n`);
    else this.log((micro ? this.t.micro : this.t.macro) + '\n');
    this.cycle++;
    this.miniLog = [];
    this.memCursor = null;
    // startSim
    this.running = true;
    for (const row of this.cells) row.fill(true);
    for (const r of Object.values(this.regs)) r.setExpected(r.value);
    try {
      if (this.tact === 0) yield* this.instructionFetch();
      this.ceaLayout = false;
      while (this.running && this.tact > 0) yield* this.executeInstruction();
    } finally {
      this.running = false;
      this.inMicroMode = false;
      this.waiting = null;
    }
  }

  *instructionFetch() {
    const c = this.cells;
    for (let i = 0; i < 8; i++) c[0][i] = false;
    for (let i = 0; i < 11; i++) c[i][0] = false;

    const raps = (this.raps = this.regs.RAPS.value);
    const row = this.pm[raps];
    this.selectPM(1);
    const na = row[COL.NA] === '' ? 0 : parseInt(row[COL.NA], 10);
    this.na = Number.isNaN(na) ? 0 : s16(na);
    this.rbps = (rbpsValue(row) + this.na).toString(16).toUpperCase().padStart(12, '0') + 'h';
    this.log(`===============${raps}================\n${this.t.tact}0: RBPS=${this.rbps}\n`);

    for (let i = 1; i < 11; i++) for (let j = 1; j < 8; j++) c[i][j] = row[i] !== '';

    if (row[COL.C1] === 'SHT') {
      for (let j = 1; j < 8; j++) c[3][j] = false;
      for (let j = 1; j < 8; j++) c[10][j] = false;
    }
    if (c[1][1]) for (let j = 2; j < 8; j++) c[1][j] = false;
    if (c[2][1]) for (let j = 2; j < 8; j++) c[2][j] = false;
    if (c[3][1]) {
      for (let j = 1; j < 8; j++) c[3][j] = false;
      c[3][6] = true;
    }
    if (c[4][1]) {
      for (let j = 1; j < 8; j++) c[4][j] = false;
      if (SHIFT_OPS.includes(row[COL.D2])) c[4][1] = true;
      else c[4][6] = true;
    }
    if (c[5][1]) for (let j = 1; j < 7; j++) c[5][j] = false;
    if (c[6][1]) for (let j = 1; j < 7; j++) c[6][j] = false;
    if (c[7][1]) {
      for (let j = 1; j < 8; j++) c[7][j] = false;
      c[7][1] = true;
      const c1 = row[COL.C1];
      if (c1 === 'CWC' || c1 === 'IWC' || c1 === 'END') {
        c[7][7] = true;
        c[7][1] = false;
      }
      if (c1 === 'RRC') c[7][6] = true;
      if (c1 === 'SHT') c[7][1] = false;
    }
    if (c[8][1]) {
      for (let j = 1; j < 8; j++) c[8][j] = false;
      const c2 = row[COL.C2];
      if (c2 === 'RINT' || c2 === 'ENI') c[8][7] = true;
      else if (c2 === 'OPC') {
        c[8][7] = true;
        for (let j = 1; j < 8; j++) c[9][j] = false;
      } else if (c2 === 'CEA') c[8][1] = true;
      else c[8][6] = true;
    }
    if (c[9][1]) {
      for (let j = 1; j < 8; j++) c[9][j] = false;
      c[9][7] = true;
    }
    if (c[10][1]) {
      for (let j = 1; j < 8; j++) c[10][j] = false;
      c[10][2] = true;
    }
    yield* this.nextTact();
  }

  *executeInstruction() {
    const c = this.cells;
    const t = this.t;
    const tact1 = () => c[1][1] || c[2][1] || c[4][1] || c[7][1] || c[8][1];
    const tact6 = () => c[3][6] || c[4][6] || c[8][6];
    const tact7 = () => c[5][7] || c[6][7] || c[7][7] || c[8][7];

    if (this.tact === 1 && tact1()) this.log(`${t.tact}1:\n`);
    while (this.tact === 1 && tact1()) yield* this.exeTact1();
    if (this.tact === 1) yield* this.nextTact();

    if (this.tact === 2 && c[10][2]) this.log(`${t.tact}2:\n`);
    while (this.tact === 2 && c[10][2]) yield* this.exeTact2();
    while (this.tact >= 2 && this.tact <= 5) yield* this.nextTact();

    if (this.tact === 6 && tact6()) this.log(`${t.tact}6:\n`);
    while (this.tact === 6 && tact6()) yield* this.exeTact6();
    if (this.tact === 6) yield* this.nextTact();

    if (this.tact === 7 && (tact7() || c[9][7])) this.log(`${t.tact}7:\n`);
    while (this.tact === 7 && tact7()) yield* this.exeTact7();

    if (this.tact === 7 && c[9][7]) {
      yield* this.exeTest();
    } else if (this.tact === 7 && !this.isTestPositive) {
      this.halt = false;
      const value = this.regs.RAPS.value;
      if (value === 255) {
        this.testAndSet('RAPS', 255);
        this.canSimulate = false;
        this.halt = true;
      } else {
        this.testAndSet('RAPS', value + 1);
      }
      this.selectPM(COL.NA);
      yield* this.waitOK();
      this.tact = 0;
      this.endingCycle();
    } else if (this.tact === 8) {
      this.regs.LALU.setBoth(0);
      this.regs.RALU.setBoth(0);
      this.tact = 0;
      this.endingCycle();
    } else if (this.tact === 9) {
      this.tact = 0;
      this.endingCycle();
    }
  }

  endingCycle() {
    if (this.halt) {
      this.log(`${pad('', 11)}RAPS = 255, STOP - ${this.t.criticalError} \n`);
      this.canSimulate = false;
    }
    this.running = false;
  }

  getRRRegisterOP() {
    const tmp = bin16(this.regs.RR.value);
    if (tmp.slice(0, 5) === '00000') return { a: parseInt(tmp.slice(5, 9), 2) + 32, indirect: true };
    return { a: parseInt(tmp.slice(0, 5), 2), indirect: tmp[7] === '1' };
  }

  setZnak(value) {
    this.flags.ZNAK = value;
  }

  // Microoperations shared by the S/D fields of tacts 6 and 7.
  moveOp(mnemo) {
    const R = this.regs;
    switch (mnemo) {
      case 'ORI': this.testAndSet('BUS', R.RI.value); break;
      case 'ORAE': this.testAndSet('BUS', R.RAE.value); break;
      case 'OXE': this.testAndSet('RALU', R.X.value); break;
      case 'OA': this.testAndSet('BUS', R.A.value); break;
      case 'OMQ': this.testAndSet('BUS', R.MQ.value); break;
      case 'OLR': this.testAndSet('BUS', R.LR.value); break;
      case 'ORBP': this.testAndSet('BUS', R.RBP.value); break;
      case 'ORR': this.testAndSet('BUS', R.RR.value); break;
      case 'OX': this.testAndSet('BUS', R.X.value); break;
      case 'OBE': this.testAndSet('BUS', R.ALU.value); break;
      case 'IXRE': this.testAndSet('LALU', R.RI.value); break;
      case 'IRAE': this.testAndSet('RAE', R.SUMA.value); break;
      case 'IALU': this.testAndSet('LALU', R.A.value); break;
      case 'ILR': this.testAndSet('LR', R.BUS.value); break;
      case 'IX': this.testAndSet('X', R.BUS.value); break;
      case 'IBE': this.testAndSet('RALU', R.BUS.value); break;
      case 'IBI': this.testAndSet('RAE', R.BUS.value); break;
      case 'IA': this.testAndSet('A', R.BUS.value); break;
      case 'IMQ': this.testAndSet('MQ', R.BUS.value); break;
      case 'IRI': this.testAndSet('RI', R.BUS.value); break;
      case 'IRR': this.testAndSet('RR', R.BUS.value); break;
      case 'IRBP': case 'SRBP': this.testAndSet('RBP', R.BUS.value); break;
      case 'NSI': this.testAndSet('LR', R.LR.value + 1); break;
      case 'IAS': this.signFrom(R.A.value); break;
      case 'SGN': this.signFrom(R.X.value); break;
    }
  }

  signFrom(value) {
    const sign = (value & 0x8000) === 0x8000 ? 1 : 0;
    this.setZnak(sign);
    this.log(`\t\t${this.flagLabel('ZNAK')} = ${sign}\n`);
  }

  /** Replaces an operating memory cell and logs the change. */
  setMemory(addr, cell) {
    const old = this.po[addr];
    this.log(`${pad(`PAO[${addr}]`, 17)} = 0x${old.hex.padStart(4, '0')}  -zmiana->  PAO[${addr}] = 0x${cell.hex}\n`);
    this.po[addr] = cell;
  }

  writeMemory(addr, value) {
    this.setMemory(addr, memoryCell(value, MEM_DATA));
    this.memCursor = addr;
  }

  *exeTact1() {
    const c = this.cells;
    const R = this.regs;
    let setXro = -1;
    if (c[1][1]) {
      const m = this.op(COL.S1);
      const allowed = ['IXRE', 'OLR', 'ORR', 'ORAE', 'IALU', 'OXE', 'OX'];
      if (allowed.includes(m)) this.moveOp(m);
      c[1][1] = false;
      this.addToLogAndMiniLog('S1', m, this.desc(m));
    } else if (c[2][1]) {
      const m = this.op(COL.D1);
      if (m === 'ILK') this.testAndSet('LK', R.BUS.value);
      else if (m === 'IRAP') this.testAndSet('RAP', R.BUS.value);
      else if (m === 'OXE') this.testAndSet('RALU', R.X.value);
      c[2][1] = false;
      this.resetBus = true;
      this.addToLogAndMiniLog('D1', m, this.desc(m));
    } else if (c[4][1]) {
      const m = this.op(COL.D2);
      this.addToLogAndMiniLog('D2', m, this.desc(m));
      this.addToLogAndMiniLog('C1', 'SHT', this.desc('SHT'));
      let A = R.A.value;
      const signBit = (A & 0x8000) === 0x8000;
      const lastBit = (A & 0x0001) === 0x0001;
      if (m === 'ALA') {
        A <<= 1;
        if (signBit) A |= 0x8000;
        else A &= 0x7fff;
        this.testAndSet('A', A);
      } else if (m === 'ARA') {
        A >>= 1;
        if (signBit) A |= 0x8000;
        this.testAndSet('A', A);
      } else if (m === 'LRQ') {
        A = (A & 0xffff) >>> 1;
        this.testAndSet('A', A);
        yield* this.waitOK();
        const mq = (R.MQ.value & 0xffff) >>> 1;
        this.testAndSet('MQ', lastBit ? mq | 0x8000 : mq);
      } else if (m === 'LLQ') {
        A = (A & 0xffff) << 1;
        const mqSign = (R.MQ.value & 0x8000) === 0x8000;
        this.testAndSet('A', mqSign ? (A & 0xffff) + 1 : A & 0xffff);
        yield* this.waitOK();
        this.testAndSet('MQ', R.MQ.value << 1);
      } else if (m === 'LLA') {
        this.testAndSet('A', (A & 0xffff) << 1);
      } else if (m === 'LRA') {
        this.testAndSet('A', (A & 0xffff) >>> 1);
      } else if (m === 'LCA') {
        this.testAndSet('A', signBit ? ((A & 0xffff) << 1) + 1 : (A & 0xffff) << 1);
      }
      c[4][1] = false;
    } else if (c[7][1]) {
      const m = this.op(COL.C1);
      if (m === 'RRC') {
        const rap = R.RAP.value;
        this.memCursor = rap;
        this.testAndSet('RBP', cellValue(this.po[rap]));
        this.flags.MAV = 0;
        this.flags.IA = 1;
      } else if (m === 'MUL') {
        this.testAndSet('LK', 16);
      } else if (m === 'DIV') {
        this.testAndSet('LK', 15);
      }
      c[7][1] = false;
      this.addToLogAndMiniLog('C1', m, this.desc(m));
    } else if (c[8][1]) {
      const m = this.op(COL.C2);
      if (m === 'CEA') {
        this.ceaLayout = true;
        let left = 0;
        let right = 0;
        const tmp = bin16(R.RR.value);
        if (tmp.slice(0, 5) !== '00000') {
          const xsi = tmp.slice(5, 8);
          setXro = 0;
          if (xsi === '110' || xsi === '111') {
            left = right = 0;
            setXro = 1;
          } else if (xsi === '010' || xsi === '011') {
            right = R.LR.value;
            left = parseInt(tmp.slice(8, 16), 2);
          } else if (xsi === '100' || xsi === '101') {
            right = R.RI.value;
            left = parseInt(tmp.slice(8, 16), 2);
          } else {
            left = parseInt(tmp.slice(8, 16), 2);
          }
        } else {
          left = parseInt(tmp.slice(9, 16), 2);
        }
        this.addToLogAndMiniLog('C2', m, this.desc(m));
        this.testAndSet('L', left);
        yield* this.waitOK();
        this.testAndSet('R', right);
        yield* this.waitOK();
        this.testAndSet('SUMA', (left + right) & 255);
        if (left + right > 255 || left + right < 0) setXro = 1;
      }
      c[8][1] = false;
    }
    yield* this.waitOK();
    if (setXro === 0 || setXro === 1) {
      this.flags.XRO = setXro;
      this.log(`${pad('XRO', 15)} = ${setXro}\n`);
    }
    if (this.resetBus) {
      R.BUS.setBoth(0);
      this.resetBus = false;
    }
    this.flags.IA = 0;
    this.flags.MAV = 1;
    this.ceaLayout = false;
  }

  *exeTact2() {
    const c = this.cells;
    const R = this.regs;
    if (c[10][2]) {
      const m = this.op(COL.ALU);
      const l = R.LALU.value;
      const r = R.RALU.value;
      this.isOverflow = false;
      const checked = (v) => {
        if (v !== s16(v)) this.isOverflow = true;
        return v;
      };
      const results = {
        ADD: () => checked(l + r),
        SUB: () => checked(l - r),
        CMX: () => 1 + ~r,
        CMA: () => 1 + ~l,
        OR: () => l | r,
        AND: () => l & r,
        EOR: () => l ^ r,
        NOTL: () => ~l,
        NOTR: () => ~r,
        L: () => l,
        R: () => r,
        INCL: () => checked(l + 1),
        INCR: () => checked(r + 1),
        DECL: () => checked(l - 1),
        DECR: () => checked(r - 1),
        ONE: () => 1,
        ZERO: () => 0,
      };
      if (results[m]) this.testAndSet('ALU', results[m]());
      c[10][2] = false;
      this.addToLogAndMiniLog('ALU', m, this.desc(m));
    }
    yield* this.waitOK();
    const sign = (R.ALU.expected & 0x8000) === 0x8000 ? 1 : 0;
    this.setZnak(sign);
    this.log(`\t\t${this.flagLabel('ZNAK')} = ${sign}, `);
    this.flags.OFF = this.isOverflow ? 1 : 0;
    this.log(`OFF = ${this.flags.OFF}\n`);
    this.isOverflow = false;
    R.LALU.setValue(0);
    R.RALU.setValue(0);
  }

  *exeTact6() {
    const c = this.cells;
    const R = this.regs;
    if (c[3][6]) {
      const m = this.op(COL.S2);
      if (['IXRE', 'ORR', 'ORI', 'OBE', 'IRAE', 'ORAE', 'IALU', 'OXE', 'OX', 'OA', 'OMQ'].includes(m)) this.moveOp(m);
      c[3][6] = false;
      this.addToLogAndMiniLog('S2', m, this.desc(m));
    } else if (c[4][6]) {
      const m = this.op(COL.D2);
      if (['ORI', 'OXE', 'ILR', 'IRI', 'IX', 'IBE', 'IBI', 'IA', 'IMQ', 'NSI', 'IAS', 'SGN'].includes(m)) this.moveOp(m);
      c[4][6] = false;
      this.resetBus = true;
      this.addToLogAndMiniLog('D2', m, this.desc(m));
    } else if (c[8][6]) {
      const m = this.op(COL.C2);
      if (m === 'DLK') this.testAndSet('LK', R.LK.value - 1);
      else if (m === 'DRI') this.testAndSet('RI', R.RI.value - 1);
      else if (m === 'SOFF' || m === 'ROFF') {
        this.flags.OFF = m === 'SOFF' ? 1 : 0;
        this.flagToCheck = 'OFF';
      } else if (m === 'SXRO' || m === 'RXRO') {
        this.flags.XRO = m === 'SXRO' ? 1 : 0;
        this.flagToCheck = 'XRO';
      } else if (m === 'AQ15') {
        if ((R.A.value & 0x8000) === 0x8000) this.testAndSet('MQ', R.MQ.value & 0xfffe);
        else this.testAndSet('MQ', R.MQ.value | 0x0001);
      } else if (m === 'RA') this.testAndSet('A', 0);
      else if (m === 'RMQ') this.testAndSet('MQ', 0);
      c[8][6] = false;
      this.addToLogAndMiniLog('C2', m, this.desc(m));
    }
    yield* this.waitOK();
    if (this.resetBus) {
      R.BUS.setBoth(0);
      this.resetBus = false;
    }
  }

  *exeTact7() {
    const c = this.cells;
    const R = this.regs;
    if (c[5][7]) {
      const m = this.op(COL.S3);
      if (['ORI', 'ORAE', 'OXE', 'OA', 'OMQ', 'OLR', 'ORBP'].includes(m)) this.moveOp(m);
      c[5][7] = false;
      this.addToLogAndMiniLog('S3', m, this.desc(m));
    } else if (c[6][7]) {
      const m = this.op(COL.D3);
      if (['OXE', 'ILR', 'IX', 'IBE', 'IBI', 'IA', 'IMQ', 'NSI', 'IAS', 'SGN', 'IRI', 'IRR', 'IRBP', 'SRBP'].includes(m)) {
        this.moveOp(m);
      }
      c[6][7] = false;
      this.resetBus = true;
      this.addToLogAndMiniLog('D3', m, this.desc(m));
    } else if (c[7][7]) {
      const m = this.op(COL.C1);
      if (m === 'END') this.testAndSet('RAPS', 0);
      else if (m === 'CWC') {
        this.flags.MAV = 0;
        this.flags.IA = 1;
      } else if (m === 'IWC') {
        this.flags.MAV = 0;
        this.flags.IA = 1;
        R.RAP.setBoth(255);
        this.po[255] = memoryCell(R.LR.value, MEM_DATA);
        this.memCursor = 255;
        this.registerToCheck = 'RAP';
      }
      if (m === 'END') this.tact = 9; // skip TEST
      c[7][7] = false;
      this.addToLogAndMiniLog('C1', m, this.desc(m));
      if (m === 'CWC') this.writeMemory(R.RAP.value, R.RBP.value);
    } else if (c[8][7]) {
      const m = this.op(COL.C2);
      if (m === 'RINT' || m === 'ENI') {
        this.flags.INT = m === 'ENI' ? 1 : 0;
        this.flagToCheck = 'INT';
      } else if (m === 'OPC') {
        this.testAndSet('RAPS', this.getRRRegisterOP().a);
        this.tact = 8;
      }
      c[8][7] = false;
      this.addToLogAndMiniLog('C2', m, this.desc(m));
    }
    yield* this.waitOK();
    if (this.resetBus) {
      R.BUS.setBoth(0);
      this.resetBus = false;
    }
  }

  *exeTest() {
    const R = this.regs;
    const m = this.op(COL.TEST);
    let otherValue = false;
    let positive = false;
    switch (m) {
      case 'UNB': positive = true; break;
      case 'TINT':
        this.log(`${pad('INT = ', 18)}${this.flags.INT}\n`);
        if (this.flags.INT === 0) positive = true;
        else {
          otherValue = true;
          this.flags.INT = 0;
          this.testAndSet('RAP', 255);
          yield* this.waitOK();
          R.RAPS.setExpected(254);
        }
        break;
      case 'TIND': {
        const { a, indirect } = this.getRRRegisterOP();
        if (indirect) positive = true;
        else {
          otherValue = true;
          R.RAPS.setExpected(a);
        }
        break;
      }
      case 'TAS': positive = R.A.value >= 0; break;
      case 'TXS': positive = R.RI.value >= 0; break;
      case 'TQ15': positive = (R.MQ.value & 0x0001) !== 0x0001; break;
      case 'TLK':
        positive = this.pm[this.raps][COL.C1] === 'SHT' ? R.LK.value === 0 : R.LK.value !== 0;
        break;
      case 'TSD': positive = this.flags.ZNAK === 0; break;
      case 'TAO': positive = this.flags.OFF === 0; break;
      case 'TXP': positive = R.RI.value <= 0; break;
      case 'TXZ': {
        const op = bin16(R.RR.value).slice(0, 5);
        if (op === '10101') positive = R.RI.value === 0; // TLD
        else if (op === '10011') positive = R.RI.value !== 0; // BXZ
        break;
      }
      case 'TXRO': positive = this.flags.XRO === 0; break;
      case 'TAP': positive = R.A.value <= 0; break;
      case 'TAZ': positive = R.A.value === 0; break;
    }
    this.cells[9][7] = false;
    this.addToLogAndMiniLog('TEST', m, this.desc(m));

    if (positive) R.RAPS.setExpected(this.na);
    else if (!otherValue) R.RAPS.setExpected((R.RAPS.value + 1) & 255);
    R.RAPS.needCheck = true;
    this.registerToCheck = 'RAPS';
    this.selectPM(COL.NA);
    yield* this.waitOK();
    this.tact = 9;
  }

  // ------------------------------------------------------ editing
  /** Sets a microcode cell, applying the SHT rules of the desktop editor. Returns changed columns. */
  setMicroOp(row, col, value) {
    const r = this.pm[row];
    const changes = [];
    const set = (c, v) => {
      if (r[c] === v) return;
      this.log(`${pad('PM[', 14)}${row}][${PM_COLUMNS[c]}] = "${r[c]}"  -zmiana->  PM[${row}][${PM_COLUMNS[c]}] = "${v}"\n`);
      r[c] = v;
      changes.push(c);
    };
    if (col === COL.NA) {
      const n = parseInt(value, 10);
      set(col, Number.isNaN(n) || (n & 255) === 0 ? '' : String(n & 255));
      return changes;
    }
    if (col === COL.C1) {
      if (r[COL.C1] === 'SHT' && value !== 'SHT') set(COL.D2, '');
      if (value === '' && SHIFT_OPS.includes(r[COL.D2])) set(COL.D2, '');
      set(col, value);
      if (value === 'SHT') {
        set(COL.S2, '');
        set(COL.S3, '');
        set(COL.D3, '');
        if (!SHIFT_OPS.includes(r[COL.D2])) set(COL.D2, 'ALA');
      }
      return changes;
    }
    set(col, value);
    return changes;
  }

  /** Options allowed for a microcode cell; `required` means "(none)" is not allowed. */
  optionsFor(row, col) {
    const sht = this.pm[row][COL.C1] === 'SHT';
    if (col === COL.D2 && (sht || SHIFT_OPS.includes(this.pm[row][COL.D2]))) return { options: SHIFT_OPS, required: true };
    if (sht && (col === COL.S2 || col === COL.S3 || col === COL.D3)) return { options: [], required: false };
    return { options: COLUMN_OPTIONS[col] ?? [], required: false };
  }

  enterEditMode() {
    this.oldRegs = Object.fromEntries(REG_NAMES.map((n) => [n, this.regs[n].value]));
  }

  leaveEditMode() {
    const LK = this.regs.LK;
    LK.setBoth(LK.value & 127);
    for (const n of REG_NAMES) {
      const r = this.regs[n];
      r.expected = r.value;
      if (this.oldRegs && this.oldRegs[n] !== r.value) {
        this.log(`${pad('', 11)}${n} = ${this.oldRegs[n]}  -zmiana->  ${n} = ${r.value}\n`);
      }
    }
    this.oldRegs = null;
    this.canSimulate = true;
  }

  /** keepScore: in a controlled attempt the mistakes and cycles counted so far are not reset. */
  clearRegisters({ keepScore = false } = {}) {
    this.log(`\n${this.t.clearingRegister}\n`);
    if (!keepScore) {
      this.mistakes = 0;
      this.cycle = 0;
    }
    this.updateMark();
    this.tact = 0;
    for (const r of Object.values(this.regs)) r.reset();
    for (const f of FLAG_NAMES) this.flags[f] = f === 'MAV' ? 1 : 0;
    this.rbps = '000000000000h';
    this.canSimulate = true;
    this.halt = false;
    this.miniLog = [];
    this.current = null;
  }

  // --------------------------------------------------- persistence
  snapshot() {
    return {
      regs: Object.fromEntries(REG_NAMES.map((n) => [n, this.regs[n].value])),
      flags: { ...this.flags },
      pm: this.pm,
      po: this.po,
      mark: this.mark,
      mistakes: this.mistakes,
      cycle: this.cycle,
      canSimulate: this.canSimulate,
      halt: this.halt,
      rbps: this.rbps,
      logText: this.logText,
      logOpen: this.logOpen,
    };
  }

  restore(s) {
    if (!s) return;
    for (const n of REG_NAMES) if (n in (s.regs ?? {})) this.regs[n].setBoth(s.regs[n]);
    for (const f of FLAG_NAMES) if (f in (s.flags ?? {})) this.flags[f] = s.flags[f] ? 1 : 0;
    if (Array.isArray(s.pm) && s.pm.length === 256) this.pm = s.pm;
    if (Array.isArray(s.po) && s.po.length === 256) this.po = s.po;
    this.mark = s.mark ?? 5;
    this.mistakes = s.mistakes ?? 0;
    this.cycle = s.cycle ?? 0;
    this.canSimulate = s.canSimulate ?? true;
    this.halt = s.halt ?? false;
    this.rbps = s.rbps ?? this.rbps;
    this.logText = s.logText ?? '';
    this.logOpen = s.logOpen ?? false;
  }
}

