/**
 * Port of LabZSK.StaticClasses.CRC – three table driven, reflected CRC-32 variants
 * (init 0, no final xor). Files store the CRC little-endian at the end, so the CRC of a
 * whole valid file equals 0.
 */
function makeTable(polynomial: number): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let j = 0; j < 8; j++) value = value & 1 ? (value >>> 1) ^ polynomial : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
}

const pmTable = makeTable(0x04c11db7);
const paoTable = makeTable(0xedb88320);
const logTable = makeTable(0x82608edb);

function compute(table: Uint32Array, bytes: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ table[(bytes[i] ^ crc) & 0xff];
  return crc >>> 0;
}

export const computePMChecksum = (bytes: Uint8Array) => compute(pmTable, bytes);
export const computePAOChecksum = (bytes: Uint8Array) => compute(paoTable, bytes);
export const computeLogChecksum = (bytes: Uint8Array) => compute(logTable, bytes);
