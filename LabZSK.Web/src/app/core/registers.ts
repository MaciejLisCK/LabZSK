import { hex16 } from './int16';

export const REGISTER_NAMES = [
  'LK',
  'A',
  'MQ',
  'X',
  'RAP',
  'LALU',
  'RALU',
  'RBP',
  'ALU',
  'BUS',
  'RR',
  'LR',
  'RI',
  'RAPS',
  'RAE',
  'L',
  'R',
  'SUMA',
] as const;
export type RegName = (typeof REGISTER_NAMES)[number];

export const FLAG_NAMES = ['MAV', 'IA', 'INT', 'ZNAK', 'XRO', 'OFF'] as const;
export type FlagName = (typeof FLAG_NAMES)[number];

/** Registers which cannot be changed in the register edit mode (SimView.AEnterEditMode). */
export const NON_EDITABLE: readonly RegName[] = ['BUS', 'LALU', 'RALU', 'L', 'R', 'SUMA'];

/**
 * State of a register – port of NumericTextBox without the UI.
 *  - `value`    – what is currently "in" the register (innerValue, what the student typed),
 *  - `expected` – value which should be moved to the register (valueWhichShouldBeMovedToRegister),
 *  - `needCheck`– the student has to enter a new value.
 */
export class Register {
  value = 0;
  expected = 0;
  needCheck = false;

  constructor(readonly name: RegName) {}

  /** clampValue(): LK is 7-bit (expected only), RAP/RAPS/SUMA are 8-bit. */
  private clamp(): void {
    if (this.name === 'LK') this.expected &= 127;
    else if (this.name === 'RAPS' || this.name === 'RAP' || this.name === 'SUMA') {
      this.value &= 255;
      this.expected &= 255;
    }
  }

  reset(): void {
    this.value = this.expected = 0;
    this.needCheck = false;
  }

  setValue(v: number): void {
    this.value = v;
    this.clamp();
  }

  setExpected(v: number): void {
    this.expected = v;
    this.clamp();
  }

  setValueAndExpected(v: number): void {
    this.value = this.expected = v;
    this.needCheck = false;
    this.clamp();
  }

  /** validateRegisterValue(): returns the wrong value or null when the student was right. */
  validate(): { ok: true } | { ok: false; bad: number } {
    this.needCheck = false;
    this.clamp();
    if (this.expected !== this.value) {
      const bad = this.value;
      this.value = this.expected;
      return { ok: false, bad };
    }
    return { ok: true };
  }

  /** Text of the register box: `1Fh\t31`. */
  get text(): string {
    return `${hex16(this.value)}h\t${this.value}`;
  }
}
