import { CellType, MemCell, emptyPAO, encodeComplex, encodeSimple } from './memory';
import { COL, MicroOp, emptyPM } from './microcode';

/**
 * Sample microprogram (PM) and program (PAO) for the first classes.
 *
 * Microprogram layout:
 *   PM[0]        fetch: PAO[LR] -> RR, LR+1, OPC jumps to PM[OP] (simple) or PM[32+AOP] (complex)
 *   PM[1..31]    first microinstruction of a simple instruction (address = OP)
 *   PM[32..47]   first microinstruction of a complex instruction (address = 32 + AOP)
 *   PM[64..]     continuations (the next free PM[OP+1] belongs to another instruction, so jumps go here)
 *
 * Every instruction with an address starts with CEA + IRAE (effective address -> RAE) and returns to the
 * fetch with TEST UNB, NA = 0.
 */
type Fields = Partial<Record<keyof typeof COL, string>>;

export const EXAMPLE_MICROPROGRAM: Readonly<Record<number, Fields>> = {
  // fetch
  0: { S1: 'OLR', D1: 'IRAP', C1: 'RRC', D2: 'NSI', S3: 'ORBP', D3: 'IRR', C2: 'OPC' },
  // ADD (OP 1): A = A + PAO[EA]
  1: { C2: 'CEA', S2: 'IRAE', TEST: 'UNB', NA: '64' },
  64: { S1: 'ORAE', D1: 'IRAP', C1: 'RRC', S3: 'ORBP', D3: 'IBE', TEST: 'UNB', NA: '65' },
  65: { S1: 'IALU', ALU: 'ADD', S2: 'OBE', D2: 'IA', TEST: 'UNB', NA: '0' },
  // SUB (OP 2): A = A - PAO[EA]
  2: { C2: 'CEA', S2: 'IRAE', TEST: 'UNB', NA: '66' },
  66: { S1: 'ORAE', D1: 'IRAP', C1: 'RRC', S3: 'ORBP', D3: 'IBE', TEST: 'UNB', NA: '67' },
  67: { S1: 'IALU', ALU: 'SUB', S2: 'OBE', D2: 'IA', TEST: 'UNB', NA: '0' },
  // STA (OP 6): PAO[EA] = A
  6: { C2: 'CEA', S2: 'IRAE', TEST: 'UNB', NA: '68' },
  68: { S1: 'ORAE', D1: 'IRAP', S3: 'OA', D3: 'IRBP', C1: 'CWC', TEST: 'UNB', NA: '0' },
  // LDA (OP 8): A = PAO[EA]
  8: { C2: 'CEA', S2: 'IRAE', TEST: 'UNB', NA: '69' },
  69: { S1: 'ORAE', D1: 'IRAP', C1: 'RRC', S3: 'ORBP', D3: 'IA', TEST: 'UNB', NA: '0' },
  // UNB (OP 16): LR = EA
  16: { C2: 'CEA', S2: 'IRAE', TEST: 'UNB', NA: '70' },
  70: { S2: 'ORAE', D2: 'ILR', TEST: 'UNB', NA: '0' },
  // BAZ (OP 23): if A = 0 then LR = EA
  23: { C2: 'CEA', S2: 'IRAE', TEST: 'UNB', NA: '71' },
  71: { TEST: 'TAZ', NA: '70' },
  72: { TEST: 'UNB', NA: '0' },
  // NOP (OP 31)
  31: { C1: 'END' },
  // STP (AOP 0): dynamic stop – the processor stays in PM[32]
  32: { TEST: 'UNB', NA: '32' },
};

export function examplePM(): MicroOp[] {
  const pm = emptyPM();
  for (const [addr, fields] of Object.entries(EXAMPLE_MICROPROGRAM)) {
    const row = pm[Number(addr)];
    for (const [col, value] of Object.entries(fields)) row[COL[col as keyof typeof COL]] = value === '0' ? '' : value!;
  }
  return pm;
}

const simple = (op: number, da: number): MemCell => ({ word: encodeSimple({ op, x: 0, s: 0, i: 0, da }), type: CellType.Simple });

/** Program: PAO[23] = PAO[20] + PAO[21] - PAO[22]; if the result is 0 skip the NOP; stop. */
export function examplePAO(): MemCell[] {
  const pao = emptyPAO();
  pao[0] = simple(8, 20); //  LDA 20
  pao[1] = simple(1, 21); //  ADD 21
  pao[2] = simple(2, 22); //  SUB 22
  pao[3] = simple(6, 23); //  STA 23
  pao[4] = simple(23, 6); //  BAZ 6
  pao[5] = simple(31, 0); //  NOP
  pao[6] = { word: encodeComplex({ aop: 0, n: 0 }), type: CellType.Complex }; // STP
  pao[20] = { word: 7, type: CellType.Data };
  pao[21] = { word: 5, type: CellType.Data };
  pao[22] = { word: 12, type: CellType.Data };
  return pao;
}
