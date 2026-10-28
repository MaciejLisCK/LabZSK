// Instruction set tables of the LabZSK computer.
// Ported from LabZKT/StaticClasses/Translator.cs and the Operations/Instructions resources.

export const s16 = (v) => (v << 16) >> 16;
export const hex = (v) => (v & 0xffff).toString(16).toUpperCase();
export const hex4 = (v) => hex(v).padStart(4, '0');
export const bin16 = (v) => (v & 0xffff).toString(2).padStart(16, '0');

// Column indexes in a microinstruction row (index 0 is the address).
export const PM_COLUMNS = ['', 'S1', 'D1', 'S2', 'D2', 'S3', 'D3', 'C1', 'C2', 'Test', 'ALU', 'NA'];
export const COL = { S1: 1, D1: 2, S2: 3, D2: 4, S3: 5, D3: 6, C1: 7, C2: 8, TEST: 9, ALU: 10, NA: 11 };

export const SHIFT_OPS = ['ALA', 'ARA', 'LRQ', 'LLQ', 'LLA', 'LRA', 'LCA'];

// Binary codes of microoperations per column, used to compute the RBPS register.
const CODES = {
  1: ['', 'IXRE', 'OLR', 'ORR', 'ORAE', 'IALU', 'OXE', 'OX'],
  2: ['', 'ILK', 'IRAP', 'OXE'],
  3: ['', 'IRAE', 'ORR', 'ORI', 'ORAE', 'OA', 'OMQ', 'OX', 'OBE', 'IXRE', 'IALU', 'OXE'],
  4: ['', 'ILR', 'IX', 'IBE', 'IRI', 'IBI', 'IA', 'IMQ', 'OXE', 'NSI', 'IAS', 'SGN', 'ALA', 'ARA', 'LRQ', 'LLQ', 'LLA', 'LRA', 'LCA'],
  5: ['', 'ORI', 'OLR', 'OA', 'ORAE', 'OMQ', 'ORBP', 'OXE'],
  6: ['', 'ILR', 'IX', 'IBE', 'IRI', 'IBI', 'IA', 'IMQ', 'OXE', 'NSI', 'IAS', 'SGN', 'IRR', 'IRBP', 'SRBP'],
  7: ['', 'CWC', 'RRC', 'MUL', 'DIV', 'SHT', 'IWC', 'END'],
  8: ['', 'DLK', 'SOFF', 'ROFF', 'SXRO', 'RXRO', 'DRI', 'RA', 'RMQ', 'AQ15', 'RINT', 'OPC', 'CEA', 'ENI'],
  9: ['', 'UNB', 'TINT', 'TIND', 'TAS', 'TXS', 'TQ15', 'TLK', 'TSD', 'TAO', 'TXP', 'TXZ', 'TXRO', 'TAP', 'TAZ'],
  10: ['', 'ADD', 'SUB', 'CMX', 'CMA', 'OR', 'AND', 'EOR', 'NOTL', 'NOTR', 'L', 'R', 'INCL', 'INCR', 'DECL', 'DECR', 'ONE', 'ZERO'],
};
const SHIFTS = { 1: 45, 2: 43, 3: 39, 4: 35, 5: 32, 6: 28, 7: 25, 8: 21, 9: 16, 10: 8 };

// Microoperations offered by the editor for each column (order as in PMSubmit.cs).
export const COLUMN_OPTIONS = {
  1: CODES[1].slice(1),
  2: CODES[2].slice(1),
  3: CODES[3].slice(1),
  4: CODES[4].slice(1, 12),
  5: CODES[5].slice(1),
  6: CODES[6].slice(1),
  7: CODES[7].slice(1),
  8: CODES[8].slice(1),
  9: CODES[9].slice(1),
  10: CODES[10].slice(1),
};

/** RBPS value (48-bit) of a microinstruction row, without NA. Unknown mnemonic gives 0. */
export function rbpsValue(row) {
  let total = 0;
  for (let col = 1; col <= 10; col++) {
    const code = CODES[col].indexOf(row[col]);
    if (code < 0) return 0;
    total += code * 2 ** SHIFTS[col];
  }
  return total;
}

const MICRO_FALLBACK = {
  IXRE: 'RI -> LALU', ILK: 'BUS -> LK', IRAP: 'BUS -> RAP', IRAE: 'SUMA -> RAE',
  IALU: 'A -> LALU', ILR: 'BUS -> LR', IX: 'BUS -> X', IBE: 'BUS -> RALU',
  IRI: 'BUS -> RI', IBI: 'BUS -> RAE', IA: 'BUS -> A', IMQ: 'BUS -> MQ',
  IRR: 'BUS -> RR', IRBP: 'BUS -> RBP', SRBP: 'BUS -> RBP',
  OXE: 'X -> RALU', OLR: 'LR -> BUS', ORR: 'RR -> BUS', ORAE: 'RAE -> BUS',
  OX: 'X -> BUS', ORI: 'RI -> BUS', OA: 'A -> BUS', OMQ: 'MQ -> BUS',
  OBE: 'ALU -> BUS', ORBP: 'RBP -> BUS', NSI: 'LR+1 -> LR',
  MUL: '16 -> LK', DIV: '15 -> LK', DLK: 'LK = LK-1',
  SOFF: 'OFF = 1', ROFF: 'OFF = 0', SXRO: 'XRO = 1', RXRO: 'XRO = 0',
  DRI: 'RI = RI-1', RA: 'A = 0', RMQ: 'MQ = 0', AQ15: 'NOT A0 -> MQ15',
  RINT: 'INT = 0', TAS: 'A >= 0', TXS: 'RI >= 0', TQ15: 'MQ15 = 0',
  TAO: 'OFF = 0', TXP: 'RI <= 0', TXRO: 'RI = 0',
  TAP: 'A <= 0', TAZ: 'A = 0', ADD: 'ALU = LALU + RALU', SUB: 'ALU = LALU - RALU',
  CMX: 'ALU = (NOT RALU)+1', CMA: 'ALU = (NOT LALU)+1', OR: 'ALU = LALU OR RALU', AND: 'ALU = LALU AND RALU',
  EOR: 'ALU = LALU XOR RALU', NOTL: 'ALU = NOT LALU', NOTR: 'ALU = NOT RALU', L: 'ALU = LALU',
  R: 'ALU = RALU', INCL: 'ALU = LALU + 1', INCR: 'ALU = RALU + 1', DECL: 'ALU = LALU - 1',
  DECR: 'ALU = RALU - 1', ONE: 'ALU = 1', ZERO: 'ALU = 0',
};

const MICRO_PL = {
  ADD: 'ALU = LALU + RALU', ALA: 'arytmetyczne A w lewo', AND: 'ALU = LALU AND RALU', AQ15: 'NOT A0 -> MQ15',
  ARA: 'arytmetyczne A w prawo', CEA: 'Oblicz adres efektywny', CMA: 'ALU = (NOT LALU)+1', CMX: 'ALU = (NOT RALU)+1',
  CWC: 'Rozpoczęcie CWC', DECL: 'ALU = LALU - 1', DECR: 'ALU = RALU - 1', DIV: '15 -> LK', DLK: 'LK = [LK]-1',
  DRI: 'RI = RI-1', END: 'Koniec mikroprogramu', ENI: 'Odblokuj przerwania', EOR: 'ALU = LALU XOR RALU',
  IA: 'BUS -> A', IALU: 'A -> LALU', IAS: 'A0 -> ZNAK', IBE: 'BUS -> RALU', IBI: 'BUS -> RAE', ILK: 'BUS -> LK',
  ILR: 'BUS -> LR', IMQ: 'BUS -> MQ', INCL: 'ALU = LALU + 1', INCR: 'ALU = RALU + 1', IRAE: 'SUMA -> RAE',
  IRAP: 'BUS -> RAP', IRBP: 'BUS -> RBP', IRI: 'BUS -> RI', IRR: 'BUS -> RR', IWC: 'Rozpoczęcie IWC',
  IX: 'BUS -> X', IXRE: 'RI -> LALU', L: 'ALU = LALU', LCA: 'cykliczne A w lewo', LLA: 'logiczne A w lewo',
  LLQ: 'logiczne A i MQ w lewo', LRA: 'logiczne A w prawo', LRQ: 'logiczne A i MQ w prawo', MUL: '16 -> LK',
  NOTL: 'ALU = NOT LALU', NOTR: 'ALU = NOT RALU', NSI: 'LR+1 -> LR', OA: 'A -> BUS', OBE: 'ALU -> BUS',
  OLR: 'LR -> BUS', OMQ: 'MQ -> BUS', ONE: 'ALU = 1', OPC: 'OP albo AOP+32 -> RAPS', OR: 'ALU = LALU OR RALU',
  ORAE: 'RAE -> BUS', ORBP: 'RBP -> BUS', ORI: 'RI -> BUS', ORR: 'RR -> BUS', OX: 'X -> BUS', OXE: 'X -> RALU',
  R: 'ALU = RALU', RA: 'A = 0', RINT: 'INT = 0', RMQ: 'MQ = 0', ROFF: 'OFF = 0', RRC: 'Rozpoczęcie RRC',
  RXRO: 'XRO = 0', SGN: 'X0 -> ZNAK', SHT: 'Operacja przesunięcia', SOFF: 'OFF = 1', SRBP: 'BUS -> RBP',
  SUB: 'ALU = LALU - RALU', SXRO: 'XRO = 1', TAO: 'OFF = 0', TAP: 'A <= 0', TAS: 'A >= 0', TAZ: 'A = 0',
  TIND: 'Adresowanie pośrednie', TINT: 'Brak przerwania', TLK: 'SHT, LK=0 || !SHT, LK!=0', TQ15: 'MQ15 = 0',
  TSD: 'ZNAK = 0', TXP: 'RI <= 0', TXRO: 'XRO = 0', TXS: 'RI >= 0', TXZ: 'BXZ i RI != 0 || TLD i RI = 0',
  UNB: 'Zawsze pozytywny', ZERO: 'ALU = 0',
};

const MICRO_EN = {
  ALA: 'arithmetic shift A left', ARA: 'arithmetic shift A right', CEA: 'Calculate effective address',
  CWC: 'Start CWC', END: 'End of microcode', ENI: 'Enable interrupts', IAS: 'A0 -> SIGN', IWC: 'Start IWC',
  LCA: 'cyclic shift A left', LLA: 'logic shift A left', LLQ: 'logic shift A | MQ left',
  LRA: 'logic shift A right', LRQ: 'logic shift A | MQ right', OPC: 'OP or AOP+32 -> RAPS', RRC: 'Start RRC',
  SGN: 'X0 -> SIGN', SHT: 'Shift operation', TIND: 'Indirect addressing', TINT: 'No interrupts',
  TLK: 'SHT, LK=0 || !SHT, LK!=0', TSD: 'SIGN = 0', TXZ: 'BXZ i RI <> 0 || TLD i RI = 0', UNB: 'Always positive',
};

export function microOpDescription(mnemo, lang) {
  const table = lang === 'en' ? MICRO_EN : MICRO_PL;
  return table[mnemo] ?? MICRO_FALLBACK[mnemo] ?? '';
}

// Instruction mnemonics: simple instructions by OP (5 bits), complex by AOP (4 bits).
export const SIMPLE_OPS = ['', 'ADD', 'SUB', 'MUL', 'DIV', 'STQ', 'STA', 'STX', 'LDA', 'LDX', 'STC', 'TXA', 'TMQ',
  'ADX', 'SIO', 'LIO', 'UNB', 'BAO', 'BXP', 'BXZ', 'BXN', 'TLD', 'BAP', 'BAZ', 'BAN', 'LOR', 'LAND', 'LNG', 'EOR',
  'SRJ', 'BDN', 'NOP'];
export const COMPLEX_OPS = ['STP', 'CMA', 'ALA', 'ARA', 'LRQ', 'LLQ', 'LLA', 'LRA', 'LCA', 'LAI', 'LXI', 'INX', 'DEX',
  'CND', 'ENI', 'LDS'];

const INSTR_PL = {
  ADD: 'Dodawanie', ADX: 'Dodaj do RI', ALA: 'Przesunięcie arytmetyczne A w lewo',
  ARA: 'Przesunięcie arytmetyczne A w prawo', BAN: 'Skocz jeśli A < 0', BAO: 'Skocz jeśli nadmiar A',
  BAP: 'Skocz jeśli A > 0', BAZ: 'Skocz jeśli A = 0', BDN: 'Skok jeśli urządzenie niedostępne',
  BXN: 'Skocz jeśli RI < 0', BXP: 'Skocz jeśli RI > 0', BXZ: 'Skocz jeśli RI = 0', CMA: 'Uzupełnienie A do 2',
  CND: 'Podłącz urządzenie', DEX: 'Zmniejsz modyfikator RI', DIV: 'Dzielenie', ENI: 'Zezwolenie na przerwania',
  EOR: 'Różnica symetryczna A i komórki', INX: 'Zwiększ modyfikator RI', LAI: 'Ładuj A bezpośrednio',
  LCA: 'Przesunięcie cykliczne A w lewo', LDA: 'Ładuj akumulator A', LDS: 'Podaj status',
  LDX: 'Ładuj modyfikator RI', LIO: 'Ładuj licznik słów WE-WY', LLA: 'Przesunięcie logiczne A w lewo',
  LLQ: 'Przesunięcie logiczne A || MQ w lewo', LNG: 'Negacja logiczna A', LOR: 'Suma logiczna A i komórki',
  LAND: 'Iloczyn logiczny A i komórki', LRA: 'Przesunięcie logiczne A w prawo',
  LRQ: 'Przesunięcie logiczne A || MQ w prawo', LXI: 'Ładuj RI bezpośrednio', MUL: 'Mnożenie',
  NOP: 'Nic nie rób', SIO: 'Start operacji WE-WY', SRJ: 'Skok ze śladem', STA: 'Zapamiętaj akumulator A',
  STC: 'Zapamiętaj LR', STP: 'Stop dynamiczny', STQ: 'Zapamiętaj rejestr MQ', STX: 'Zapamiętaj modyfikator RI',
  SUB: 'Odejmowanie', TLD: 'RI = RI - 1 i Skocz jeśli RI > 0', TMQ: 'Prześlij MQ do A', TXA: 'Prześlij RI do A',
  UNB: 'Skok bezwarunkowy',
};

const INSTR_EN = {
  ADD: 'Addition', ADX: 'Add to RI', ALA: 'Arithmetic left shift A', ARA: 'Arithmetic right shift A',
  BAN: 'Jump if A < 0', BAO: 'Jump if overflow A', BAP: 'Jump if A > 0', BAZ: 'Jump if A = 0',
  BDN: 'Jump if device not available', BXN: 'Jump if RI < 0', BXP: 'Jump if RI > 0', BXZ: 'Jump if RI = 0',
  CMA: "Two's complement A", CND: 'Connect device', DEX: 'Decrease RI', DIV: 'Divide', ENI: 'Enable interrupts',
  EOR: 'Exclusive OR A and cell', INX: 'Increase RI', LAI: 'Load A immediately', LCA: 'Cyclic left shift A',
  LDA: 'Load A', LDS: 'Provide status', LDX: 'Load RI', LIO: 'Load IO word counter', LLA: 'Logic left shift A',
  LLQ: 'Logic left shift A||MQ', LNG: 'Logic negation A', LOR: 'Logic OR A and cell',
  LAND: 'Logical AND A and cell', LRA: 'Logic right shift A', LRQ: 'Logic right shift A||MQ',
  LXI: 'Load RI immediately', MUL: 'Multiplication', NOP: 'No operation', SIO: 'Start IO operation',
  SRJ: 'Jump with a trace', STA: 'Save A', STC: 'Save LR', STP: 'Stop', STQ: 'Save MQ', STX: 'Save RI',
  SUB: 'Subtraction', TLD: 'RI = RI - 1; Jump if RI > 0', TMQ: 'Send MQ to A', TXA: 'Send RI to A',
  UNB: 'Unconditional branch',
};

export function instructionDescription(mnemo, lang) {
  return (lang === 'en' ? INSTR_EN : INSTR_PL)[mnemo] ?? '';
}

export const MEM_EMPTY = 0;
export const MEM_DATA = 1;
export const MEM_SIMPLE = 2;
export const MEM_COMPLEX = 3;

/** Builds a memory cell from a 16-bit value and its type. */
export function memoryCell(value, type) {
  return { bin: bin16(value), hex: hex4(value), type };
}

export function emptyCell() {
  return { bin: '', hex: '', type: MEM_EMPTY };
}

export function cellValue(cell) {
  return cell.hex === '' ? 0 : s16(parseInt(cell.hex, 16));
}

/** Decodes the fields of a memory cell (MemoryRecord.cs). */
export function decodeCell(cell) {
  const b = cell.bin;
  if (b === '') return null;
  const complex = cell.type === MEM_COMPLEX || (cell.type !== MEM_SIMPLE && b.slice(0, 5) === '00000');
  if (complex) {
    const aop = parseInt(b.slice(5, 9), 2);
    return { complex: true, aop, n: parseInt(b.slice(9), 2), mnemo: COMPLEX_OPS[aop] };
  }
  const op = parseInt(b.slice(0, 5), 2);
  return { complex: false, op, x: b[5], s: b[6], i: b[7], da: parseInt(b.slice(8), 2), mnemo: SIMPLE_OPS[op] };
}

/** Encodes a simple instruction: OP(5) X S I DA(8). */
export function encodeSimple(op, x, s, i, da) {
  return (op << 11) | (x << 10) | (s << 9) | (i << 8) | (da & 255);
}

/** Encodes a complex instruction: 00000 AOP(4) N(7). */
export function encodeComplex(aop, n) {
  return ((aop & 15) << 7) | (n & 127);
}

/**
 * Parses a register value typed by the user: decimal (optionally negative),
 * hexadecimal with an `h` suffix, or bare hex digits. Returns null when invalid.
 */
export function parseValue(text) {
  const t = text.trim().replace(/\s+/g, '');
  if (t === '') return null;
  let m = /^(-?)([0-9a-f]{1,4})h$/i.exec(t);
  if (m) return s16((m[1] ? -1 : 1) * parseInt(m[2], 16));
  if (/^-?\d+$/.test(t)) {
    const n = parseInt(t, 10);
    return n >= -32768 && n <= 32767 ? n : null;
  }
  if (/^[0-9a-f]{1,4}$/i.test(t)) return s16(parseInt(t, 16));
  return null;
}
