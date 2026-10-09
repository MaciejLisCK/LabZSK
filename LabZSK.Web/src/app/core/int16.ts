/** Helpers emulating C# `short` (Int16) arithmetic. */

/** Truncates any integer to a signed 16-bit value (like a C# `(short)` cast). */
export function s16(value: number): number {
  return (value << 16) >> 16;
}

/** True when the value does not fit in a signed 16-bit integer (C# `checked` overflow). */
export function overflows16(value: number): boolean {
  return value > 32767 || value < -32768;
}

/** Hex representation like C# `Convert.ToString(short, 16).ToUpper()` / `short.ToString("X")`. */
export function hex16(value: number): string {
  return (value & 0xffff).toString(16).toUpperCase();
}

/** 16-character binary representation of a 16-bit value. */
export function bin16(value: number): string {
  return (value & 0xffff).toString(2).padStart(16, '0');
}

/** Equivalent of C# `Convert.ToInt16(text, 16)`: accepts up to 4 hex digits, returns null on failure. */
export function parseHex16(text: string): number | null {
  if (!/^[0-9a-fA-F]{1,4}$/.test(text)) return null;
  return s16(parseInt(text, 16));
}

/** Equivalent of C# `Convert.ToInt16(text)` for decimal input, returns null on failure / overflow. */
export function parseDec16(text: string): number | null {
  if (!/^-?\d+$/.test(text)) return null;
  const v = parseInt(text, 10);
  return overflows16(v) ? null : v;
}

/** Equivalent of C# `Convert.ToInt16(text, 2)`: up to 16 binary digits. */
export function parseBin16(text: string): number | null {
  if (!/^[01]{1,16}$/.test(text)) return null;
  return s16(parseInt(text, 2));
}

/**
 * Parses a value typed into a register box, exactly like NumericTextBox did:
 * `1Fh` -> hex, `-12` / `12` -> decimal, `1F` -> hex. Returns null when the text is not valid.
 */
export function parseRegisterInput(raw: string): number | null {
  const text = raw.trim();
  if (text.length === 0) return null;
  if (text.endsWith('h') || text.endsWith('H')) return parseHex16(text.slice(0, -1));
  if (/^-?\d+$/.test(text)) return parseDec16(text);
  if (/^[0-9a-fA-F]+$/.test(text)) return parseHex16(text);
  return null;
}
