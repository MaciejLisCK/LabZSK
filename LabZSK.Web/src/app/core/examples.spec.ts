import { CellType } from './memory';
import { examplePAO, examplePM } from './examples';
import { Simulator } from './simulator';

async function runProgram(data: [number, number, number]) {
  const sim = new Simulator();
  sim.settings.delay = 0;
  sim.pm = examplePM();
  sim.pao = examplePAO();
  data.forEach((v, i) => (sim.pao[20 + i] = { word: v, type: CellType.Data }));
  sim.openLog({ name: 'Test', group: '' }, 'vitest');
  await sim.start(false, { register: 'RAPS', value: 32 }); // run until STP
  return sim;
}

describe('example program', () => {
  it('computes 7 + 5 - 12 = 0, stores it and skips the NOP', async () => {
    const sim = await runProgram([7, 5, 12]);
    expect(sim.regs.A.value).toBe(0);
    expect(sim.pao[23]).toEqual({ word: 0, type: CellType.Data });
    expect(sim.regs.LR.value).toBe(7);
    expect(sim.cycle).toBe(19); // LDA 3 + ADD 4 + SUB 4 + STA 3 + BAZ 4 + fetch of STP 1
    expect(sim.mistakes).toBe(0);
  });

  it('executes the NOP when the result is not zero', async () => {
    const sim = await runProgram([10, 20, 3]);
    expect(sim.regs.A.value).toBe(27);
    expect(sim.pao[23].word).toBe(27);
    expect(sim.regs.LR.value).toBe(7);
    expect(sim.cycle).toBe(21); // + NOP (fetch + END)
  });
});
