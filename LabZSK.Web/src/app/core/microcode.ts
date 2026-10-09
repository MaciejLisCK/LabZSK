import { MICRO_OP_DESCRIPTIONS } from './descriptions';

/**
 * Microprogram memory (PM). A row mirrors the original DataGridView row:
 * index 0 = address, 1..10 = S1 D1 S2 D2 S3 D3 C1 C2 TEST ALU, 11 = NA.
 */
export type MicroOp = string[];

export const PM_SIZE = 256;
export const PM_COLUMNS = ['Adres', 'S1', 'D1', 'S2', 'D2', 'S3', 'D3', 'C1', 'C2', 'TEST', 'ALU', 'NA'] as const;

export const COL = { S1: 1, D1: 2, S2: 3, D2: 4, S3: 5, D3: 6, C1: 7, C2: 8, TEST: 9, ALU: 10, NA: 11 } as const;

export const SHIFT_OPS = ['ALA', 'ARA', 'LRQ', 'LLQ', 'LLA', 'LRA', 'LCA'] as const;

export function isShiftOp(mnemo: string): boolean {
  return (SHIFT_OPS as readonly string[]).includes(mnemo);
}

/** Options offered by PMSubmit for every column (without the empty option). */
export const COLUMN_OPTIONS: Readonly<Record<number, readonly string[]>> = {
  1: ['IXRE', 'OLR', 'ORR', 'ORAE', 'IALU', 'OXE', 'OX'],
  2: ['ILK', 'IRAP', 'OXE'],
  3: ['IRAE', 'ORR', 'ORI', 'ORAE', 'OA', 'OMQ', 'OX', 'OBE', 'IXRE', 'IALU', 'OXE'],
  4: ['ILR', 'IX', 'IBE', 'IRI', 'IBI', 'IA', 'IMQ', 'OXE', 'NSI', 'IAS', 'SGN'],
  5: ['ORI', 'OLR', 'OA', 'ORAE', 'OMQ', 'ORBP', 'OXE'],
  6: ['ILR', 'IX', 'IBE', 'IRI', 'IBI', 'IA', 'IMQ', 'OXE', 'NSI', 'IAS', 'SGN', 'IRR', 'IRBP', 'SRBP'],
  7: ['CWC', 'RRC', 'MUL', 'DIV', 'SHT', 'IWC', 'END'],
  8: ['DLK', 'SOFF', 'ROFF', 'SXRO', 'RXRO', 'DRI', 'RA', 'RMQ', 'AQ15', 'RINT', 'OPC', 'CEA', 'ENI'],
  9: ['UNB', 'TINT', 'TIND', 'TAS', 'TXS', 'TQ15', 'TLK', 'TSD', 'TAO', 'TXP', 'TXZ', 'TXRO', 'TAP', 'TAZ'],
  10: [
    'ADD',
    'SUB',
    'CMX',
    'CMA',
    'OR',
    'AND',
    'EOR',
    'NOTL',
    'NOTR',
    'L',
    'R',
    'INCL',
    'INCR',
    'DECL',
    'DECR',
    'ONE',
    'ZERO',
  ],
};

/**
 * Options which the PM editor offers for a given cell, honouring the SHT rules from PMSubmit:
 * with C1 = SHT the S2/S3/D3 columns are unavailable and D2 accepts only shift operations.
 * `required` means the empty option is not allowed (D2 when SHT is set).
 */
export function optionsFor(col: number, row: MicroOp): { options: readonly string[]; required: boolean } {
  const sht = row[COL.C1] === 'SHT';
  if (col === COL.D2 && (sht || isShiftOp(row[COL.D2]))) return { options: SHIFT_OPS, required: sht };
  if (sht && (col === COL.S2 || col === COL.S3 || col === COL.D3)) return { options: [], required: false };
  return { options: COLUMN_OPTIONS[col] ?? [], required: false };
}

export function microOpDescription(mnemo: string): string {
  return MICRO_OP_DESCRIPTIONS[mnemo] ?? '';
}

export function emptyMicroOp(address: number): MicroOp {
  const row = new Array<string>(12).fill('');
  row[0] = String(address);
  return row;
}

export function emptyPM(): MicroOp[] {
  return Array.from({ length: PM_SIZE }, (_, i) => emptyMicroOp(i));
}

/** A single cell change produced by the PM editing rules (needed for logging). */
export interface PmChange {
  row: number;
  col: number;
  value: string;
}

/**
 * Computes the full set of changes caused by setting `value` in a PM cell, applying the same
 * side effects as PMView.NewMicroOperation / NewMicroInstruction:
 *  - NA: value 0 (or empty) becomes empty, otherwise clamped to 0..255,
 *  - leaving SHT in C1 clears a shift operation in D2,
 *  - setting SHT clears S2, S3, D3 (and D2 unless it already holds a shift op; caller must ask for one).
 */
export function pmEdit(pm: readonly MicroOp[], rowIdx: number, col: number, value: string): PmChange[] {
  const row = pm[rowIdx];
  const changes: PmChange[] = [];
  if (col === COL.NA) {
    const n = value === '' ? 0 : Number.parseInt(value, 10);
    const na = Number.isFinite(n) ? n & 255 : 0;
    changes.push({ row: rowIdx, col, value: na === 0 ? '' : String(na) });
    return changes;
  }
  changes.push({ row: rowIdx, col, value });
  if (col === COL.C1) {
    if (value !== 'SHT' && isShiftOp(row[COL.D2])) changes.push({ row: rowIdx, col: COL.D2, value: '' });
    if (value === 'SHT') {
      changes.push({ row: rowIdx, col: COL.S2, value: '' });
      changes.push({ row: rowIdx, col: COL.S3, value: '' });
      changes.push({ row: rowIdx, col: COL.D3, value: '' });
      if (!isShiftOp(row[COL.D2])) changes.push({ row: rowIdx, col: COL.D2, value: '' });
    }
  }
  return changes;
}

/** Opcode tables used to compute RBPS (Translator.instCode*). */
const CODES: Readonly<Record<number, readonly string[]>> = {
  1: ['', 'IXRE', 'OLR', 'ORR', 'ORAE', 'IALU', 'OXE', 'OX'],
  2: ['', 'ILK', 'IRAP', 'OXE'],
  3: ['', 'IRAE', 'ORR', 'ORI', 'ORAE', 'OA', 'OMQ', 'OX', 'OBE', 'IXRE', 'IALU', 'OXE'],
  4: [
    '',
    'ILR',
    'IX',
    'IBE',
    'IRI',
    'IBI',
    'IA',
    'IMQ',
    'OXE',
    'NSI',
    'IAS',
    'SGN',
    'ALA',
    'ARA',
    'LRQ',
    'LLQ',
    'LLA',
    'LRA',
    'LCA',
  ],
  5: ['', 'ORI', 'OLR', 'OA', 'ORAE', 'OMQ', 'ORBP', 'OXE'],
  6: ['', 'ILR', 'IX', 'IBE', 'IRI', 'IBI', 'IA', 'IMQ', 'OXE', 'NSI', 'IAS', 'SGN', 'IRR', 'IRBP', 'SRBP'],
  7: ['', 'CWC', 'RRC', 'MUL', 'DIV', 'SHT', 'IWC', 'END'],
  8: ['', 'DLK', 'SOFF', 'ROFF', 'SXRO', 'RXRO', 'DRI', 'RA', 'RMQ', 'AQ15', 'RINT', 'OPC', 'CEA', 'ENI'],
  9: ['', 'UNB', 'TINT', 'TIND', 'TAS', 'TXS', 'TQ15', 'TLK', 'TSD', 'TAO', 'TXP', 'TXZ', 'TXRO', 'TAP', 'TAZ'],
  10: [
    '',
    'ADD',
    'SUB',
    'CMX',
    'CMA',
    'OR',
    'AND',
    'EOR',
    'NOTL',
    'NOTR',
    'L',
    'R',
    'INCL',
    'INCR',
    'DECL',
    'DECR',
    'ONE',
    'ZERO',
  ],
};
const SHIFTS: Readonly<Record<number, number>> = {
  1: 45,
  2: 43,
  3: 39,
  4: 35,
  5: 32,
  6: 28,
  7: 25,
  8: 21,
  9: 16,
  10: 8,
};

/** Translator.GetRbpsValue – value of the microinstruction register (without NA). */
export function rbpsValue(row: MicroOp): number {
  let rbps = 0;
  for (let col = 1; col <= 10; col++) {
    const code = CODES[col].indexOf(row[col]);
    if (code < 0) return 0;
    rbps += code * 2 ** SHIFTS[col];
  }
  return rbps;
}

export function formatRbps(value: number): string {
  return value.toString(16).toUpperCase().padStart(12, '0') + 'h';
}

/** Text listing of the microprogram (PMView "Drukuj"). */
export function printPM(pm: readonly MicroOp[]): string {
  let all = '';
  for (const row of pm) {
    let tmp = ' ' + row[0].padEnd(8, ' ');
    let any = false;
    for (let col = 1; col <= 10; col++) {
      if (row[col] === '') continue;
      if (any) tmp += ''.padEnd(9, ' ');
      any = true;
      tmp += PM_COLUMNS[col].padEnd(8, ' ');
      tmp += '___' + (row[col].padEnd(8, ' ') + microOpDescription(row[col])).padEnd(8, ' ') + '\r\n';
    }
    if (row[COL.NA] !== '') {
      if (any) tmp += ''.padEnd(9, ' ');
      any = true;
      tmp += 'NA'.padEnd(8, ' ') + '___' + row[COL.NA].padEnd(8, ' ') + '\r\n';
    }
    if (any) all += tmp + '\r\n';
  }
  return all;
}
