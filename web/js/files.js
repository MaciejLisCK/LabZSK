// Binary .pm / .po files, compatible with the desktop application
// (System.IO.BinaryWriter layout followed by a CRC-32 that makes the whole file check to zero).

import { emptyCell } from './isa.js';

function crcTable(poly) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let v = i;
    for (let j = 0; j < 8; j++) v = v & 1 ? (v >>> 1) ^ poly : v >>> 1;
    table[i] = v >>> 0;
  }
  return table;
}

const PM_TABLE = crcTable(0x04c11db7);
const PO_TABLE = crcTable(0xedb88320);

function crc(table, bytes) {
  let c = 0;
  for (const b of bytes) c = (c >>> 8) ^ table[(b ^ c) & 0xff];
  return c >>> 0;
}

class Writer {
  constructor() {
    this.bytes = [];
  }
  int32(v) {
    this.bytes.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  }
  bool(v) {
    this.bytes.push(v ? 1 : 0);
  }
  string(s) {
    const data = new TextEncoder().encode(s);
    let n = data.length;
    do {
      let b = n & 0x7f;
      n >>>= 7;
      if (n) b |= 0x80;
      this.bytes.push(b);
    } while (n);
    this.bytes.push(...data);
  }
  finish(table) {
    this.int32(crc(table, this.bytes));
    return new Uint8Array(this.bytes);
  }
}

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
  }
  byte() {
    if (this.pos >= this.bytes.length) throw new Error('eof');
    return this.bytes[this.pos++];
  }
  int32() {
    const v = this.byte() | (this.byte() << 8) | (this.byte() << 16) | (this.byte() << 24);
    return v;
  }
  bool() {
    return this.byte() !== 0;
  }
  string() {
    let n = 0;
    let shift = 0;
    let b;
    do {
      b = this.byte();
      n |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    if (this.pos + n > this.bytes.length) throw new Error('eof');
    const s = new TextDecoder().decode(this.bytes.subarray(this.pos, this.pos + n));
    this.pos += n;
    return s;
  }
}

function readTable(bytes, table, minLength, columns) {
  if (bytes.length < minLength || crc(table, bytes) !== 0) throw new Error('inconsistent');
  const r = new Reader(bytes);
  const n = r.int32();
  const m = r.int32();
  if (n !== columns || m !== 256) throw new Error('invalid');
  const rows = [];
  for (let i = 0; i < m; i++) {
    const row = [];
    for (let j = 0; j < n; j++) {
      if (r.bool()) row.push(r.string());
      else {
        r.bool();
        row.push('');
      }
    }
    rows.push(row);
  }
  return rows;
}

export function savePM(pm) {
  const w = new Writer();
  w.int32(12);
  w.int32(256);
  pm.forEach((row, i) => {
    for (let j = 0; j < 12; j++) {
      w.bool(true);
      w.string(j === 0 ? String(i) : row[j]);
    }
  });
  return w.finish(PM_TABLE);
}

/** Returns 256 rows of 12 strings; throws Error('inconsistent' | 'invalid'). */
export function loadPM(bytes) {
  return readTable(bytes, PM_TABLE, 6814, 12).map((row, i) => {
    row[0] = String(i);
    return row.map((v) => (v === 'ADS' ? 'ADD' : v === 'SUS' ? 'SUB' : v));
  });
}

export function savePO(po) {
  const w = new Writer();
  w.int32(4);
  w.int32(256);
  po.forEach((cell, i) => {
    for (const v of [String(i), cell.bin, cell.hex, String(cell.type ?? 0)]) {
      w.bool(true);
      w.string(v);
    }
  });
  return w.finish(PO_TABLE);
}

/** Returns 256 memory cells { bin, hex, type }; throws Error('inconsistent' | 'invalid'). */
export function loadPO(bytes) {
  return readTable(bytes, PO_TABLE, 2974, 4).map(([, bin, hex, type]) => {
    if (!/^[01]{1,16}$/.test(bin) || !/^[0-9A-Fa-f]{1,4}$/.test(hex)) return emptyCell();
    return { bin: bin.padStart(16, '0'), hex: hex.toUpperCase().padStart(4, '0'), type: parseInt(type, 10) || 0 };
  });
}
