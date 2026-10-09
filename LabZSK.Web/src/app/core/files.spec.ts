import { computeLogChecksum } from './crc';
import { FileFormatError, readLogFile, readPmFile, readPoFile, writeLogFile, writePmFile, writePoFile } from './files';
import { parseRegisterInput } from './int16';
import { CellType, emptyPAO, encodeSimple } from './memory';
import { emptyPM, formatRbps, pmEdit, rbpsValue } from './microcode';

describe('file formats', () => {
  it('round-trips the microprogram (.pm)', () => {
    const pm = emptyPM();
    pm[0] = ['0', 'OLR', 'IRAP', '', '', '', '', 'RRC', 'OPC', '', '', ''];
    pm[255] = ['255', '', '', '', '', '', '', 'END', '', 'UNB', '', '12'];
    const bytes = writePmFile(pm);
    expect(bytes.length).toBeGreaterThanOrEqual(6814);
    expect(readPmFile(bytes)).toEqual(pm);
  });

  it('rejects a modified .pm file', () => {
    const bytes = writePmFile(emptyPM());
    bytes[20] ^= 1;
    expect(() => readPmFile(bytes)).toThrow(FileFormatError);
  });

  it('maps legacy ADS / SUS mnemonics', () => {
    const pm = emptyPM();
    pm[1][10] = 'ADS';
    pm[2][10] = 'SUS';
    const loaded = readPmFile(writePmFile(pm));
    expect(loaded[1][10]).toBe('ADD');
    expect(loaded[2][10]).toBe('SUB');
  });

  it('round-trips the operating memory (.po)', () => {
    const pao = emptyPAO();
    pao[0] = { word: encodeSimple({ op: 8, x: 1, s: 0, i: 1, da: 200 }), type: CellType.Simple };
    pao[1] = { word: -5, type: CellType.Data };
    pao[2] = { word: 130, type: CellType.Complex };
    const bytes = writePoFile(pao);
    expect(bytes.length).toBeGreaterThanOrEqual(2974);
    expect(readPoFile(bytes)).toEqual(pao);
  });

  it('writes .po rows in the original column layout', () => {
    const pao = emptyPAO();
    pao[0] = { word: -1, type: CellType.Data };
    const text = new TextDecoder().decode(writePoFile(pao));
    expect(text).toContain('1111111111111111');
    expect(text).toContain('FFFF');
  });

  it('protects the log with a CRC', () => {
    const bytes = writeLogFile('Start symulatora\nBłąd(1)\n');
    expect(computeLogChecksum(bytes)).toBe(0);
    expect(readLogFile(bytes)).toEqual({ text: 'Start symulatora\nBłąd(1)\n', valid: true });
    bytes[2] ^= 1;
    expect(readLogFile(bytes).valid).toBe(false);
  });
});

describe('microcode helpers', () => {
  it('computes RBPS like Translator.GetRbpsValue', () => {
    const row = ['0', 'OLR', 'IRAP', '', '', '', '', 'RRC', 'OPC', '', '', ''];
    expect(formatRbps(rbpsValue(row))).toBe('500005600000h');
  });

  it('SHT clears S2, S3, D3 and a non-shift D2', () => {
    const pm = emptyPM();
    pm[0] = ['0', '', '', 'ORR', 'ILR', 'OA', 'IX', '', '', '', '', ''];
    const changes = pmEdit(pm, 0, 7, 'SHT').map((c) => c.col);
    expect(changes.sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it('NA 0 becomes empty and is limited to 255', () => {
    expect(pmEdit(emptyPM(), 0, 11, '0')[0].value).toBe('');
    expect(pmEdit(emptyPM(), 0, 11, '300')[0].value).toBe('44');
  });
});

describe('register input', () => {
  it.each([
    ['1Fh', 31],
    ['FFFFh', -1],
    ['-12', -12],
    ['12', 12],
    ['A', 10],
    ['40000', null],
    ['12345h', null],
    ['xyz', null],
  ])('%s -> %s', (text, value) => {
    expect(parseRegisterInput(text)).toBe(value);
  });
});
