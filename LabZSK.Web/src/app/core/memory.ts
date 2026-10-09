import { INSTRUCTION_DESCRIPTIONS } from './descriptions';
import { bin16, hex16 } from './int16';

/** Type of a PAO record – same numbers as MemoryRecord.typ. */
export enum CellType {
  Empty = 0,
  Data = 1,
  Simple = 2,
  Complex = 3,
}

/** Operating memory (PAO) record. `word` is a signed 16-bit value. */
export interface MemCell {
  word: number;
  type: CellType;
}

export const PAO_SIZE = 256;

/** Simple instructions, index = OP (5 bits). Index 0 is unused (OP=00000 means a complex instruction). */
export const SIMPLE_OPS = [
  '',
  'ADD',
  'SUB',
  'MUL',
  'DIV',
  'STQ',
  'STA',
  'STX',
  'LDA',
  'LDX',
  'STC',
  'TXA',
  'TMQ',
  'ADX',
  'SIO',
  'LIO',
  'UNB',
  'BAO',
  'BXP',
  'BXZ',
  'BXN',
  'TLD',
  'BAP',
  'BAZ',
  'BAN',
  'LOR',
  'LAND',
  'LNG',
  'EOR',
  'SRJ',
  'BDN',
  'NOP',
] as const;

/** Complex (extended) instructions, index = AOP (4 bits). */
export const COMPLEX_OPS = [
  'STP',
  'CMA',
  'ALA',
  'ARA',
  'LRQ',
  'LLQ',
  'LLA',
  'LRA',
  'LCA',
  'LAI',
  'LXI',
  'INX',
  'DEX',
  'CND',
  'ENI',
  'LDS',
] as const;

export function emptyCell(): MemCell {
  return { word: 0, type: CellType.Empty };
}

export function emptyPAO(): MemCell[] {
  return Array.from({ length: PAO_SIZE }, emptyCell);
}

export function instructionDescription(mnemo: string): string {
  return INSTRUCTION_DESCRIPTIONS[mnemo] ?? '';
}

/** Binary text shown in the "Zawartość" column (empty for an empty cell). */
export function cellBinary(cell: MemCell): string {
  return cell.type === CellType.Empty ? '' : bin16(cell.word);
}

/** Hex text (4 digits) shown in the hex column (empty for an empty cell). */
export function cellHex(cell: MemCell): string {
  return cell.type === CellType.Empty ? '' : hex16(cell.word).padStart(4, '0');
}

export interface SimpleFields {
  op: number;
  x: number;
  s: number;
  i: number;
  da: number;
}

export interface ComplexFields {
  aop: number;
  n: number;
}

export function decodeSimple(word: number): SimpleFields {
  const w = word & 0xffff;
  return { op: w >>> 11, x: (w >>> 10) & 1, s: (w >>> 9) & 1, i: (w >>> 8) & 1, da: w & 0xff };
}

export function decodeComplex(word: number): ComplexFields {
  const w = word & 0xffff;
  return { aop: (w >>> 7) & 0xf, n: w & 0x7f };
}

export function encodeSimple(f: SimpleFields): number {
  const w = ((f.op & 31) << 11) | ((f.x & 1) << 10) | ((f.s & 1) << 9) | ((f.i & 1) << 8) | (f.da & 0xff);
  return (w << 16) >> 16;
}

export function encodeComplex(f: ComplexFields): number {
  return ((f.aop & 15) << 7) | (f.n & 0x7f);
}

/** Mnemonic of the instruction stored in the cell (according to its declared type). */
export function cellMnemonic(cell: MemCell): string {
  if (cell.type === CellType.Simple) return SIMPLE_OPS[decodeSimple(cell.word).op];
  if (cell.type === CellType.Complex) return COMPLEX_OPS[decodeComplex(cell.word).aop];
  return '';
}

/** Multi-line description of a PAO cell (SimView.Grid_Mem_SelectionChanged). */
export function describeCell(address: number, cell: MemCell): string {
  let text = `PAO[${address}]`;
  switch (cell.type) {
    case CellType.Empty:
      return text + '=0';
    case CellType.Data:
      return `${text} - DANA\n${bin16(cell.word)}b\n${cell.word}d\n${hex16(cell.word)}h`;
    case CellType.Simple: {
      const f = decodeSimple(cell.word);
      const mnemo = SIMPLE_OPS[f.op];
      text += ' - ROZKAZ ZWYKŁY\n';
      text += `OP = ${f.op.toString(16).toUpperCase()}h (${mnemo})\n`;
      text += `X = ${f.x}\nS = ${f.s}\nI = ${f.i}\n`;
      text += `DA = ${f.da.toString(16).toUpperCase()}h\n`;
      const d = instructionDescription(mnemo);
      return d ? text + `\n${mnemo}: ${d}` : text;
    }
    case CellType.Complex: {
      const f = decodeComplex(cell.word);
      const mnemo = COMPLEX_OPS[f.aop];
      text += ' - ROZKAZ ROZSZERZONY\n';
      text += `AOP = ${f.aop.toString(16).toUpperCase()}h (${mnemo})\n`;
      text += `N = ${f.n.toString(16).toUpperCase()}h\n`;
      const d = instructionDescription(mnemo);
      return d ? text + `\n${mnemo}: ${d}` : text;
    }
  }
}

/** Text listing of the operating memory (MemView "Drukuj"). */
export function printPAO(pao: readonly MemCell[]): string {
  let all = '';
  pao.forEach((cell, addr) => {
    if (cell.type === CellType.Empty) return;
    let tmp = ' ' + String(addr).padEnd(8, ' ');
    tmp += cellBinary(cell) + 'b'.padEnd(8, ' ');
    tmp += cellHex(cell) + 'h'.padEnd(8, ' ');
    if (cell.type === CellType.Data) tmp += String(cell.word).padEnd(8, ' ');
    else if (cell.type === CellType.Simple) {
      const f = decodeSimple(cell.word);
      tmp += 'OP=' + String(f.op).padEnd(11, ' ');
      tmp += 'XSI=' + `${f.x}${f.s}${f.i}`.padEnd(8, ' ');
      tmp += 'DA=' + String(f.da).padEnd(8, ' ');
    } else {
      const f = decodeComplex(cell.word);
      tmp += 'AOP=' + String(f.aop).padEnd(22, ' ');
      tmp += 'N=' + String(f.n).padEnd(8, ' ');
    }
    all += tmp + '\r\n';
  });
  return all;
}
