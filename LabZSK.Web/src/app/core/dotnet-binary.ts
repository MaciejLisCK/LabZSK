/** Minimal emulation of .NET BinaryWriter / BinaryReader used by the original file formats. */
export class BinaryWriter {
  private bytes: number[] = [];

  writeInt32(value: number): void {
    this.writeUInt32(value >>> 0);
  }

  writeUInt32(value: number): void {
    for (let i = 0; i < 4; i++) this.bytes.push((value >>> (8 * i)) & 0xff);
  }

  writeBoolean(value: boolean): void {
    this.bytes.push(value ? 1 : 0);
  }

  /** Length-prefixed (7-bit encoded) UTF-8 string, like BinaryWriter.Write(string). */
  writeString(value: string): void {
    const encoded = new TextEncoder().encode(value);
    let length = encoded.length;
    while (length >= 0x80) {
      this.bytes.push((length & 0x7f) | 0x80);
      length >>>= 7;
    }
    this.bytes.push(length);
    for (const b of encoded) this.bytes.push(b);
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export class BinaryReader {
  private pos = 0;

  constructor(private readonly bytes: Uint8Array) {}

  private ensure(count: number): void {
    if (this.pos + count > this.bytes.length) throw new Error('Unexpected end of file');
  }

  readInt32(): number {
    this.ensure(4);
    const b = this.bytes;
    const v = b[this.pos] | (b[this.pos + 1] << 8) | (b[this.pos + 2] << 16) | (b[this.pos + 3] << 24);
    this.pos += 4;
    return v;
  }

  readBoolean(): boolean {
    this.ensure(1);
    return this.bytes[this.pos++] !== 0;
  }

  readString(): string {
    let length = 0;
    let shift = 0;
    for (;;) {
      this.ensure(1);
      const b = this.bytes[this.pos++];
      length |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 28) throw new Error('Invalid string length');
    }
    this.ensure(length);
    const s = new TextDecoder().decode(this.bytes.subarray(this.pos, this.pos + length));
    this.pos += length;
    return s;
  }
}
