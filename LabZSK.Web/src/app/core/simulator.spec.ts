import { CellType, encodeComplex, encodeSimple } from './memory';
import { COL, MicroOp } from './microcode';
import { RegName } from './registers';
import { Simulator } from './simulator';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** Sets PM row cells, e.g. row(sim, 0, { S1: 'OLR', D1: 'IRAP' }). */
function row(sim: Simulator, idx: number, fields: Partial<Record<keyof typeof COL, string>>): void {
  const r: MicroOp = [...sim.pm[idx]];
  for (const [k, v] of Object.entries(fields)) r[COL[k as keyof typeof COL]] = v!;
  sim.pm[idx] = r;
}

/**
 * Runs one cycle. `answer` decides what the "student" types into the register to check –
 * by default the correct value. Returns the list of registers which had to be filled in.
 */
async function runCycle(
  sim: Simulator,
  opts: { micro?: boolean; answer?: (reg: RegName, expected: number) => number } = {},
): Promise<{ checked: string[]; tacts: number }> {
  const checked: string[] = [];
  let tacts = 0;
  const done = sim.start(opts.micro ?? false);
  let finished = false;
  done.then(() => (finished = true));
  while (!finished) {
    await flush();
    if (sim.waitingFor === 'ok') {
      const name = sim.registerToCheck;
      if (name !== '') {
        checked.push(name);
        const reg = sim.regs[name];
        if (reg.needCheck) sim.setRegisterInput(name, opts.answer ? opts.answer(name, reg.expected) : reg.expected);
      } else checked.push(sim.flagToCheck ? `flag:${sim.flagToCheck}` : '-');
      sim.confirm();
    } else if (sim.waitingFor === 'tact') {
      tacts++;
      sim.nextTact();
    }
  }
  return { checked, tacts };
}

function newSim(): Simulator {
  const sim = new Simulator();
  sim.openLog({ name: 'Test', group: 'T1' }, 'vitest');
  return sim;
}

describe('Simulator', () => {
  it('does not start without an open log', async () => {
    const sim = new Simulator();
    await sim.start(false);
    expect(sim.cycle).toBe(0);
  });

  it('executes a fetch microinstruction (RRC, IRR, NSI, OPC)', async () => {
    const sim = newSim();
    sim.pao[0] = { word: encodeSimple({ op: 8, x: 0, s: 0, i: 0, da: 5 }), type: CellType.Simple }; // LDA 5
    row(sim, 0, { S1: 'OLR', D1: 'IRAP', C1: 'RRC', D2: 'NSI', S3: 'ORBP', D3: 'IRR', C2: 'OPC' });

    const { checked } = await runCycle(sim);

    expect(checked).toEqual(['BUS', 'RAP', 'RBP', 'LR', 'BUS', 'RR', 'RAPS']);
    expect(sim.regs.RR.value).toBe(sim.pao[0].word);
    expect(sim.regs.LR.value).toBe(1);
    expect(sim.regs.RAPS.value).toBe(8);
    expect(sim.regs.BUS.value).toBe(0);
    expect(sim.flags.MAV).toBe(1);
    expect(sim.flags.IA).toBe(0);
    expect(sim.mistakes).toBe(0);
    expect(sim.cycle).toBe(1);
    expect(sim.isRunning).toBe(false);
    expect(sim.log).toContain('===============0================\nTakt0: RBPS=');
    expect(sim.log).toContain('      C2 |  OPC : OP albo AOP+32 -> RAPS\n');
  });

  it('computes the effective address with CEA and stores it in RAE', async () => {
    const sim = newSim();
    sim.regs.RR.setValueAndExpected(encodeSimple({ op: 8, x: 0, s: 1, i: 0, da: 5 })); // relative to LR
    sim.regs.LR.setValueAndExpected(10);
    sim.regs.RAPS.setValueAndExpected(8);
    row(sim, 8, { C2: 'CEA', S2: 'IRAE', C1: 'END' });

    const { checked } = await runCycle(sim);

    expect(checked).toEqual(['L', 'R', 'SUMA', 'RAE', 'RAPS']);
    expect(sim.regs.RAE.value).toBe(15);
    expect(sim.regs.RAPS.value).toBe(0);
    expect(sim.flags.XRO).toBe(0);
    expect(sim.ceaLayout).toBe(false);
  });

  it('CEA of a complex instruction uses N and sets no XRO', async () => {
    const sim = newSim();
    sim.flags.XRO = 1;
    sim.regs.RR.setValueAndExpected(encodeComplex({ aop: 9, n: 100 }));
    row(sim, 0, { C2: 'CEA' });
    await runCycle(sim);
    expect(sim.regs.SUMA.value).toBe(100);
    expect(sim.flags.XRO).toBe(1);
  });

  it('ALU ADD sets OFF and ZNAK on overflow', async () => {
    const sim = newSim();
    sim.regs.A.setValueAndExpected(0x7fff);
    sim.regs.X.setValueAndExpected(1);
    row(sim, 0, { S1: 'IALU', D1: 'OXE', ALU: 'ADD', S2: 'OBE', D2: 'IA' });

    const { checked } = await runCycle(sim);

    expect(checked).toEqual(['LALU', 'RALU', 'ALU', 'BUS', 'A', 'RAPS']);
    expect(sim.regs.A.value).toBe(-32768);
    expect(sim.flags.OFF).toBe(1);
    expect(sim.flags.ZNAK).toBe(1);
    expect(sim.regs.LALU.value).toBe(0);
    expect(sim.regs.RALU.value).toBe(0);
    expect(sim.regs.RAPS.value).toBe(1);
  });

  it.each([
    ['SUB', 5, 7, -2],
    ['CMA', 5, 0, -5],
    ['CMX', 0, 7, -7],
    ['OR', 0b1100, 0b1010, 0b1110],
    ['AND', 0b1100, 0b1010, 0b1000],
    ['EOR', 0b1100, 0b1010, 0b0110],
    ['NOTL', 0, 0, -1],
    ['NOTR', 0, 1, -2],
    ['L', 3, 4, 3],
    ['R', 3, 4, 4],
    ['INCL', 3, 4, 4],
    ['INCR', 3, 4, 5],
    ['DECL', 3, 4, 2],
    ['DECR', 3, 4, 3],
    ['ONE', 3, 4, 1],
    ['ZERO', 3, 4, 0],
  ])('ALU %s', async (op, a, x, expected) => {
    const sim = newSim();
    sim.regs.A.setValueAndExpected(a);
    sim.regs.X.setValueAndExpected(x);
    row(sim, 0, { S1: 'IALU', D1: 'OXE', ALU: op });
    await runCycle(sim);
    expect(sim.regs.ALU.value).toBe(expected);
    expect(sim.flags.OFF).toBe(0);
  });

  it('SHT with LRQ shifts A and MQ (two checks)', async () => {
    const sim = newSim();
    sim.regs.A.setValueAndExpected(3);
    row(sim, 0, { C1: 'SHT', D2: 'LRQ' });
    const { checked } = await runCycle(sim);
    expect(checked).toEqual(['A', 'MQ', 'RAPS']);
    expect(sim.regs.A.value).toBe(1);
    expect(sim.regs.MQ.value).toBe(-32768);
  });

  it.each([
    ['ALA', -16384, -32768],
    ['ARA', -4, -2],
    ['LLA', 0x4001, -32766],
    ['LRA', -2, 0x7fff],
    ['LCA', -32767, 3],
  ])('shift %s', async (op, a, expected) => {
    const sim = newSim();
    sim.regs.A.setValueAndExpected(a);
    row(sim, 0, { C1: 'SHT', D2: op });
    await runCycle(sim);
    expect(sim.regs.A.value).toBe(expected);
  });

  it('TEST jumps to NA when positive, otherwise RAPS+1', async () => {
    const sim = newSim();
    row(sim, 0, { TEST: 'TAZ', NA: '20' });
    await runCycle(sim);
    expect(sim.regs.RAPS.value).toBe(20);

    sim.regs.A.setValueAndExpected(1);
    row(sim, 20, { TEST: 'TAZ', NA: '40' });
    await runCycle(sim);
    expect(sim.regs.RAPS.value).toBe(21);
  });

  it('TLK with SHT checks LK = 0, without SHT LK != 0; DLK wraps to 127', async () => {
    const sim = newSim();
    row(sim, 0, { C2: 'DLK', TEST: 'TLK', NA: '9' });
    await runCycle(sim);
    expect(sim.regs.LK.value).toBe(127);
    expect(sim.regs.RAPS.value).toBe(9);
  });

  it('counts mistakes, corrects the register and lowers the mark', async () => {
    const sim = newSim();
    row(sim, 0, { S1: 'OX', D1: 'ILK' });
    sim.regs.X.setValueAndExpected(5);
    const wrong = (_: RegName, e: number) => e + 1;
    await runCycle(sim, { answer: wrong });
    expect(sim.mistakes).toBe(3); // BUS, LK, RAPS
    expect(sim.mark).toBe(4);
    expect(sim.regs.LK.value).toBe(5);
    expect(sim.log).toContain('          Błąd(1): BUS = 6 / 6h (Poprawna BUS = 5 / 5h)');
  });

  it('micro mode waits for every tact', async () => {
    const sim = newSim();
    const { tacts } = await runCycle(sim, { micro: true });
    expect(tacts).toBe(7);
  });

  it('CWC writes RBP to PAO[RAP] and logs the change', async () => {
    const sim = newSim();
    sim.regs.RAP.setValueAndExpected(7);
    sim.regs.RBP.setValueAndExpected(-2);
    row(sim, 0, { C1: 'CWC' });
    await runCycle(sim);
    expect(sim.pao[7]).toEqual({ word: -2, type: CellType.Data });
    expect(sim.log).toContain('PAO[7] = 0x0000  -zmiana->  PAO[7] = 0xFFFE');
  });

  it('RAPS = 255 without TEST stops the processor', async () => {
    const sim = newSim();
    sim.regs.RAPS.setValueAndExpected(255);
    await runCycle(sim);
    expect(sim.canSimulate).toBe(false);
    expect(sim.log).toContain('BŁĄD KRYTYCZNY PROCESORA');
    await sim.start(false);
    expect(sim.cycle).toBe(1);
  });

  it('automatic run stops when the register reaches the value', async () => {
    const sim = newSim();
    sim.settings.delay = 0;
    row(sim, 0, { S2: 'OA', D2: 'IBE', ALU: 'INCR', TEST: 'UNB', NA: '1' });
    row(sim, 1, { S2: 'OBE', D2: 'IA', TEST: 'UNB', NA: '0' });
    await sim.start(false, { register: 'A', value: 3 });
    expect(sim.regs.A.value).toBe(3);
    expect(sim.mistakes).toBe(0);
    expect(sim.isRunning).toBe(false);
  });

  it('edit mode logs register changes and limits LK to 7 bits', () => {
    const sim = newSim();
    sim.enterEditMode();
    sim.setRegisterInput('LK', 200);
    sim.setRegisterInput('BUS', 5); // not editable
    sim.leaveEditMode();
    expect(sim.regs.LK.value).toBe(200 & 127);
    expect(sim.regs.BUS.value).toBe(0);
    expect(sim.log).toContain('           LK = 0  -zmiana->  LK = 72\n');
  });

  it('saves and restores its state', () => {
    const sim = newSim();
    sim.regs.A.setValueAndExpected(42);
    sim.pm[3] = ['3', 'OLR', '', '', '', '', '', '', '', '', '', ''];
    const copy = new Simulator();
    copy.restore(JSON.parse(JSON.stringify(sim.toSaved())));
    expect(copy.regs.A.value).toBe(42);
    expect(copy.pm[3][1]).toBe('OLR');
    expect(copy.log).toContain('Wznowienie pracy');
  });
});
