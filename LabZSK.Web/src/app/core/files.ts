import { computeLogChecksum, computePAOChecksum, computePMChecksum } from './crc';
import { BinaryReader, BinaryWriter } from './dotnet-binary';
import { parseHex16 } from './int16';
import { CellType, cellBinary, cellHex, MemCell, PAO_SIZE, emptyCell } from './memory';
import { MicroOp, PM_SIZE, emptyMicroOp } from './microcode';

/** Error thrown when a file cannot be read; `message` is meant for the user. */
export class FileFormatError extends Error {}

function appendCrc(bytes: Uint8Array, crc: number): Uint8Array {
  const out = new Uint8Array(bytes.length + 4);
  out.set(bytes);
  for (let i = 0; i < 4; i++) out[bytes.length + i] = (crc >>> (8 * i)) & 0xff;
  return out;
}

/* ------------------------------------------------------------------ PM (.pm) */

/** Serialises the microprogram exactly like PMView.SaveTable (12 columns x 256 rows + CRC). */
export function writePmFile(pm: readonly MicroOp[]): Uint8Array {
  const w = new BinaryWriter();
  w.writeInt32(12);
  w.writeInt32(PM_SIZE);
  for (const row of pm) {
    for (let j = 0; j < 12; j++) {
      w.writeBoolean(true);
      w.writeString(row[j] ?? '');
    }
  }
  const bytes = w.toBytes();
  return appendCrc(bytes, computePMChecksum(bytes));
}

/** Reads a .pm file (PMView.LoadTable). */
export function readPmFile(bytes: Uint8Array): MicroOp[] {
  if (bytes.length < 6814 || computePMChecksum(bytes) !== 0)
    throw new FileFormatError('Wykryto niespójność pliku mikroprogramu!');
  const r = new BinaryReader(bytes);
  const n = r.readInt32();
  const m = r.readInt32();
  if (m !== PM_SIZE || n !== 12) throw new FileFormatError('To nie jest poprawny plik mikroprogramu!');
  const pm: MicroOp[] = [];
  for (let i = 0; i < m; i++) {
    const row = emptyMicroOp(i);
    for (let j = 0; j < n; j++) {
      if (r.readBoolean()) {
        let s = r.readString();
        if (s === 'ADS') s = 'ADD';
        else if (s === 'SUS') s = 'SUB';
        if (j > 0) row[j] = s;
      } else r.readBoolean();
    }
    pm.push(row);
  }
  return pm;
}

/* ----------------------------------------------------------------- PAO (.po) */

/** Serialises the operating memory like MemView.SaveTable (4 columns: addr, binary, hex, type). */
export function writePoFile(pao: readonly MemCell[]): Uint8Array {
  const w = new BinaryWriter();
  w.writeInt32(4);
  w.writeInt32(PAO_SIZE);
  pao.forEach((cell, addr) => {
    for (const value of [String(addr), cellBinary(cell), cellHex(cell), String(cell.type)]) {
      w.writeBoolean(true);
      w.writeString(value);
    }
  });
  const bytes = w.toBytes();
  return appendCrc(bytes, computePAOChecksum(bytes));
}

/** Reads a .po file (MemView.LoadTable). */
export function readPoFile(bytes: Uint8Array): MemCell[] {
  if (bytes.length < 2974 || computePAOChecksum(bytes) !== 0)
    throw new FileFormatError('Wykryto niespójność pliku pamięci operacyjnej!');
  const r = new BinaryReader(bytes);
  const n = r.readInt32();
  const m = r.readInt32();
  if (m !== PAO_SIZE || n !== 4) throw new FileFormatError('To nie jest poprawny plik pamięci operacyjnej!');
  const pao: MemCell[] = [];
  for (let i = 0; i < m; i++) {
    const cols = ['', '', '', '0'];
    for (let j = 0; j < n; j++) {
      if (r.readBoolean()) cols[j] = r.readString();
      else r.readBoolean();
    }
    const word = cols[2] === '' ? null : parseHex16(cols[2]);
    const type = Number.parseInt(cols[3], 10);
    if (word === null || !(type >= 0 && type <= 3)) pao.push(emptyCell());
    else pao.push({ word, type: type === 0 ? CellType.Data : (type as CellType) });
  }
  return pao;
}

/* ---------------------------------------------------------------- log (.log) */

/** Encodes log text like LogManager: UTF-16LE text followed by a CRC (log polynomial). */
export function writeLogFile(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    bytes[2 * i] = c & 0xff;
    bytes[2 * i + 1] = c >>> 8;
  }
  return appendCrc(bytes, computeLogChecksum(bytes));
}

/** Decodes a .log file. `valid` is false when the checksum does not match (log was modified). */
export function readLogFile(bytes: Uint8Array): { text: string; valid: boolean } {
  const valid = bytes.length >= 4 && computeLogChecksum(bytes) === 0;
  const body = bytes.subarray(0, Math.max(0, bytes.length - 4));
  let text = '';
  for (let i = 0; i + 1 < body.length; i += 2) text += String.fromCharCode(body[i] | (body[i + 1] << 8));
  return { text, valid };
}
