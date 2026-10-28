import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Machine } from '../js/engine.js';
import { COL, memoryCell, encodeSimple, MEM_DATA, MEM_SIMPLE, parseValue, decodeCell } from '../js/isa.js';
import { savePM, loadPM, savePO, loadPO } from '../js/files.js';

function setRow(m, addr, fields) {
  for (const [k, v] of Object.entries(fields)) m.pm[addr][COL[k]] = String(v);
}

/** Runs one cycle answering every check with `answer(name, expected)` (default: correct value). */
function run(m, { micro = false, answer } = {}) {
  const gen = m.runCycle(micro);
  let tacts = 0;
  let checks = 0;
  for (let r = gen.next(); !r.done; r = gen.next()) {
    if (r.value === 'tact') tacts++;
    else {
      checks++;
      const name = m.registerToCheck;
      if (name && m.regs[name].needCheck) {
        m.enterValue(name, answer ? answer(name, m.regs[name].expected) : m.regs[name].expected);
      }
    }
  }
  return { tacts, checks };
}

function ldaProgram() {
  const m = new Machine();
  setRow(m, 0, { S1: 'OLR', D1: 'IRAP', C1: 'RRC' });
  setRow(m, 1, { D2: 'NSI', S3: 'ORBP', D3: 'IRR', C2: 'OPC' });
  setRow(m, 8, { C2: 'CEA', S2: 'IRAE', TEST: 'UNB', NA: 9 });
  setRow(m, 9, { S1: 'ORAE', D1: 'IRAP', C1: 'RRC' });
  setRow(m, 10, { S3: 'ORBP', D3: 'IA', C1: 'END' });
  m.po[0] = memoryCell(encodeSimple(8, 0, 0, 0, 5), MEM_SIMPLE); // LDA 5
  m.po[5] = memoryCell(1234, MEM_DATA);
  return m;
}

test('LDA instruction runs through fetch, CEA and END', () => {
  const m = ldaProgram();
  const visited = [];
  for (let i = 0; i < 5; i++) {
    visited.push(m.regs.RAPS.value);
    run(m);
  }
  assert.deepEqual(visited, [0, 1, 8, 9, 10]);
  assert.equal(m.regs.A.value, 1234);
  assert.equal(m.regs.LR.value, 1);
  assert.equal(m.regs.RAPS.value, 0);
  assert.equal(m.regs.RAE.value, 5);
  assert.equal(m.regs.BUS.value, 0, 'bus is reset after a D microoperation');
  assert.equal(m.mistakes, 0);
  assert.equal(m.mark, 5);
  assert.equal(m.cycle, 5);
  assert.equal(m.flags.MAV, 1);
  assert.equal(m.flags.IA, 0);
  assert.match(m.logText, /RBPS=/);
});

test('a wrong answer counts a mistake and the correct value is restored', () => {
  const m = ldaProgram();
  run(m, { answer: (name, v) => (name === 'RBP' ? v + 1 : v) });
  assert.equal(m.mistakes, 1);
  assert.equal(m.regs.RBP.value, 0x4005);
  assert.match(m.logText, /Błąd\(1\): RBP = 16390/);
  m.marks = { first: 1, second: 2, third: 3 };
  run(m, { answer: () => 7 });
  assert.equal(m.mistakes, 5); // LR, BUS, RR and RAPS of row 1 were all wrong
  assert.equal(m.mark, 2);
});

test('MICRO mode stops at every tact', () => {
  const m = ldaProgram();
  const { tacts } = run(m, { micro: true });
  assert.equal(tacts, 7);
});

test('ALU addition sets overflow and sign flags', () => {
  const m = new Machine();
  setRow(m, 0, { S1: 'IALU', D1: 'OXE', ALU: 'ADD', S2: 'OBE', D2: 'IA' });
  m.regs.A.setBoth(32767);
  m.regs.X.setBoth(1);
  run(m);
  assert.equal(m.regs.A.value, -32768);
  assert.equal(m.flags.OFF, 1);
  assert.equal(m.flags.ZNAK, 1);
  assert.equal(m.regs.LALU.value, 0);
  assert.equal(m.regs.RAPS.value, 1);
});

test('SHT with LRQ shifts A and MQ together', () => {
  const m = new Machine();
  m.setMicroOp(0, COL.C1, 'SHT');
  m.setMicroOp(0, COL.D2, 'LRQ');
  m.regs.A.setBoth(3);
  const { checks } = run(m);
  assert.equal(m.regs.A.value, 1);
  assert.equal(m.regs.MQ.value, -32768);
  assert.equal(checks, 3); // A, MQ, RAPS
});

test('test field: TAZ jumps to NA when A = 0, otherwise RAPS + 1', () => {
  const m = new Machine();
  setRow(m, 0, { TEST: 'TAZ', NA: 40 });
  run(m);
  assert.equal(m.regs.RAPS.value, 40);
  setRow(m, 40, { TEST: 'TAZ', NA: 80 });
  m.regs.A.setBoth(5);
  run(m);
  assert.equal(m.regs.RAPS.value, 41);
});

test('CWC writes RBP to memory at RAP', () => {
  const m = new Machine();
  setRow(m, 0, { S3: 'OA', D3: 'IRBP', C1: 'CWC' });
  m.regs.A.setBoth(-2);
  m.regs.RAP.setBoth(17);
  run(m);
  assert.deepEqual(m.po[17], { bin: '1111111111111110', hex: 'FFFE', type: MEM_DATA });
});

test('RAPS = 255 without a test halts the processor', () => {
  const m = new Machine();
  m.regs.RAPS.setBoth(255);
  run(m);
  assert.equal(m.canSimulate, false);
  assert.match(m.logText, /BŁĄD KRYTYCZNY/);
  assert.equal(run(m).checks, 0);
  m.clearRegisters();
  assert.equal(m.canSimulate, true);
});

test('SHT editor rules clear conflicting fields', () => {
  const m = new Machine();
  setRow(m, 3, { S2: 'ORR', S3: 'OA', D3: 'IX', D2: 'ILR' });
  m.setMicroOp(3, COL.C1, 'SHT');
  assert.deepEqual([m.pm[3][COL.S2], m.pm[3][COL.S3], m.pm[3][COL.D3], m.pm[3][COL.D2]], ['', '', '', 'ALA']);
  assert.equal(m.optionsFor(3, COL.D2).required, true);
  m.setMicroOp(3, COL.C1, 'END');
  assert.equal(m.pm[3][COL.D2], '');
  m.setMicroOp(3, COL.NA, '256');
  assert.equal(m.pm[3][COL.NA], '');
});

test('.pm and .po files round-trip and match the desktop layout', () => {
  const m = ldaProgram();
  const emptyPM = savePM(new Machine().pm);
  const emptyPO = savePO(new Machine().po);
  assert.equal(emptyPM.length, 6814, 'empty microcode file size used by the desktop check');
  assert.equal(emptyPO.length, 2974, 'empty memory file size used by the desktop check');
  assert.deepEqual(loadPM(savePM(m.pm)), m.pm);
  assert.deepEqual(loadPO(savePO(m.po)), m.po);
  const broken = savePM(m.pm);
  broken[100] ^= 1;
  assert.throws(() => loadPM(broken), /inconsistent/);
});

test('register input parsing', () => {
  assert.equal(parseValue('-5'), -5);
  assert.equal(parseValue('1Fh'), 31);
  assert.equal(parseValue('FFFFh'), -1);
  assert.equal(parseValue('ff'), -1 & 0xff);
  assert.equal(parseValue('40000'), null);
  assert.equal(parseValue('xyz'), null);
  assert.equal(decodeCell(memoryCell(encodeSimple(8, 0, 0, 1, 5), MEM_SIMPLE)).mnemo, 'LDA');
});
