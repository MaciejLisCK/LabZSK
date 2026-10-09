import { bin16, hex16, overflows16, s16 } from './int16';
import { CellType, MemCell, cellHex, emptyPAO } from './memory';
import { COL, MicroOp, PM_COLUMNS, emptyPM, formatRbps, isShiftOp, microOpDescription, rbpsValue } from './microcode';
import { FLAG_NAMES, FlagName, NON_EDITABLE, REGISTER_NAMES, RegName, Register } from './registers';

/**
 * Port of the simulation logic from SimView.cs / Execution.cs.
 *
 * The original code waited for the student with busy loops (`while (!clicked) Application.DoEvents()`).
 * Here every such place is an `await` on a promise which is resolved by {@link Simulator.confirm}
 * ("Zatwierdź") or {@link Simulator.nextTact} ("Następny takt"). Apart from that the structure and the
 * order of operations follow the C# code, so the produced log is the same.
 */

export interface SimSettings {
  /** Number of mistakes giving mark 4 / 3 / 2 (Settings.FirstMark / SecondMark / ThirdMark). */
  firstMark: number;
  secondMark: number;
  thirdMark: number;
  /** Delay between automatic steps in the dev console mode [ms]. */
  delay: number;
  canCloseLog: boolean;
  canEditOptions: boolean;
  devConsole: boolean;
}

export const DEFAULT_SETTINGS: SimSettings = {
  firstMark: 2,
  secondMark: 6,
  thirdMark: 10,
  delay: 200,
  canCloseLog: false,
  canEditOptions: false,
  devConsole: false,
};

export type WaitingFor = 'none' | 'ok' | 'tact';

export interface MiniLogEntry {
  tact: string;
  mnemo: string;
  description: string;
}

/** Target for the automatic run (DevConsole). `register === 'cycles'` means "run N more cycles". */
export interface AutoRunTarget {
  register: RegName | 'cycles';
  value: number;
}

export interface StudentInfo {
  name: string;
  group: string;
}

export interface SavedState {
  regs: Record<string, number>;
  flags: Record<string, number>;
  pm: MicroOp[];
  pao: MemCell[];
  settings: SimSettings;
  cycle: number;
  mark: number;
  mistakes: number;
  canSimulate: boolean;
  log: string | null;
  logStartedAt: string | null;
  simStartedAt: string | null;
}

export const APP_VERSION = '1.2.3.0-web';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const nowHMS = (d = new Date()) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}.${String(d.getSeconds()).padStart(2, '0')}`;
const formatDateTime = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

export class Simulator {
  readonly regs = Object.fromEntries(REGISTER_NAMES.map((n) => [n, new Register(n)])) as Record<RegName, Register>;
  readonly flags = Object.fromEntries(FLAG_NAMES.map((n) => [n, n === 'MAV' ? 1 : 0])) as Record<FlagName, number>;
  pm: MicroOp[] = emptyPM();
  pao: MemCell[] = emptyPAO();
  settings: SimSettings = { ...DEFAULT_SETTINGS };

  /* ---- public simulation state (read by the UI) ---- */
  isRunning = false;
  inMicroMode = false;
  inEditMode = false;
  canSimulate = true;
  waitingFor: WaitingFor = 'none';
  currentTact = 0;
  cycle = 0;
  mark = 5;
  mistakes = 0;
  rbps = '000000000000h';
  /** true while CEA is executed – L, R and SUMA are shown instead of RBPS and RAPS (switchLayOut). */
  ceaLayout = false;
  registerToCheck: RegName | '' = '';
  flagToCheck: FlagName | '' = '';
  /** Currently executed PM cell (Grid_PM.CurrentCell). */
  pmCursor: { row: number; col: number } | null = null;
  /** PAO row selected by the simulation (RRC / CWC / IWC). */
  paoCursor: number | null = null;
  miniLog: MiniLogEntry[] = [];
  /** Text of the log (null = no log open). */
  log: string | null = null;
  logStartedAt: Date | null = null;
  simStartedAt: Date | null = null;
  autoRun: AutoRunTarget | null = null;
  /** Set by the UI to stop the automatic run after the current cycle (DEVEND). */
  autoRunStopRequested = false;

  /** Called after every visible change of the state. */
  onChange: () => void = () => {};
  /** Called when the student gave a wrong value (the original played a beep). */
  onMistake: () => void = () => {};
  /** Called when the student gave a correct value. */
  onCorrect: () => void = () => {};

  private cells: boolean[][] = Array.from({ length: 11 }, () => new Array<boolean>(8).fill(false));
  private raps = 0;
  private na = 0;
  private microOpMnemo = '';
  private isTestPositive = false;
  private isOverflow = false;
  private resetBus = false;
  private layoutChange = false;
  private halt = false;
  private resolveWait: (() => void) | null = null;
  private oldRegs: Record<string, number> | null = null;
  private oldFlags: Record<string, number> | null = null;

  private changed(): void {
    this.onChange();
  }

  /* ================================================================== log */

  addTextToLog(text: string): void {
    if (this.log !== null) this.log += text;
  }

  /** Opens a new log (SimView.initLogInformation). */
  openLog(student: StudentInfo, environment: string): void {
    this.log = '';
    this.logStartedAt = new Date();
    this.addTextToLog(`Start symulatora ${formatDateTime(this.logStartedAt)}\n`);
    this.addTextToLog(
      `Student: "${student.name}"\n` +
        `Grupa: "${student.group}"\n` +
        `Wersja aplikacji: ${APP_VERSION}\n` +
        `Środowisko: ${environment}\n\n`,
    );
    this.logSettingsInfo();
    this.changed();
  }

  /** Writes the "not for students" warnings exactly like the original log header. */
  logSettingsInfo(): void {
    if (this.settings.canCloseLog) this.addTextToLog('Można zamykać log\n');
    if (this.settings.canEditOptions) this.addTextToLog('Edycja ustawień dozwolona!\n');
    if (this.settings.devConsole || this.settings.canEditOptions)
      this.addTextToLog('Aplikacja nie jest w trybie dla studenta!\n');
  }

  /** SimView.ACloseLog – returns the final log text. */
  closeLog(): string | null {
    this.addTextToLog(
      `\n${nowHMS().padStart(20, ' ')}\n======Stop  symulacji======\nOcena: ${this.mark}   Błędy: ${this.mistakes}\n`,
    );
    const text = this.log;
    this.log = null;
    this.logStartedAt = this.simStartedAt = null;
    this.canSimulate = true;
    this.changed();
    return text;
  }

  private addToLogAndMiniLog(tact: string, mnemo: string, description: string): void {
    if (mnemo === 'END')
      this.addTextToLog(
        `${tact.padStart(8, ' ')} | ${mnemo.padStart(4, ' ')} : (Cykl ${this.cycle}) ${description} (${nowHMS()})\n`,
      );
    else if (mnemo === 'TINT')
      this.addTextToLog(`${tact.padStart(8, ' ')} | ${mnemo.padStart(4, ' ')} : ${description}(INT ?= 0)\n`);
    else this.addTextToLog(`${tact.padStart(8, ' ')} | ${mnemo.padStart(4, ' ')} : ${description}\n`);
    this.miniLog = [...this.miniLog, { tact, mnemo, description }];
  }

  /* ======================================================= PM / PAO changes */

  /** Changes a PM cell and logs it (SimView.PmView_AUpdateData). */
  setPmCell(row: number, col: number, value: string): void {
    const old = this.pm[row][col];
    if (old === value) return;
    this.addTextToLog(
      `${'PM['.padStart(14, ' ')}${row}][${PM_COLUMNS[col]}] = "${old}"  -zmiana->  PM[${row}][${PM_COLUMNS[col]}] = "${value}"\n`,
    );
    this.pm = this.pm.map((r, i) => (i === row ? r.map((c, j) => (j === col ? value : c)) : r));
    this.changed();
  }

  /** Changes a PAO cell and logs it (SimView.MemView_AUpdateForm). */
  setPaoCell(addr: number, cell: MemCell, force = false): void {
    const old = this.pao[addr];
    if (!force && old.type === cell.type && (old.word === cell.word || cell.type === CellType.Empty)) return;
    this.addTextToLog(
      `${`PAO[${addr}]`.padStart(17, ' ')} = 0x${cellHex(old).padStart(4, '0')}  -zmiana->  PAO[${addr}] = 0x${cellHex(cell)}\n`,
    );
    this.pao = this.pao.map((c, i) => (i === addr ? { ...cell } : c));
    this.changed();
  }

  /** Replaces whole memories (file load) – logged cell by cell, like the original. */
  loadPm(pm: MicroOp[]): void {
    for (let r = 0; r < pm.length; r++) for (let c = 1; c < 12; c++) this.setPmCell(r, c, pm[r][c]);
  }

  loadPao(pao: MemCell[]): void {
    pao.forEach((cell, addr) => this.setPaoCell(addr, cell));
  }

  /* =================================================== registers / editing */

  /** Value typed by the student into a register box (or dropped onto it). */
  setRegisterInput(name: RegName, value: number): void {
    const reg = this.regs[name];
    if (!(reg.needCheck || (this.inEditMode && !NON_EDITABLE.includes(name)))) return;
    reg.setValue(value);
    this.changed();
  }

  setFlagInput(name: FlagName, value: number): void {
    if (!this.inEditMode || (value !== 0 && value !== 1)) return;
    this.flags[name] = value;
    this.changed();
  }

  enterEditMode(): void {
    if (this.isRunning || this.inEditMode) return;
    this.oldRegs = Object.fromEntries(REGISTER_NAMES.map((n) => [n, this.regs[n].value]));
    this.oldFlags = { ...this.flags };
    this.inEditMode = true;
    this.changed();
  }

  /** SimView.ALeaveEditMode – LK is limited to 7 bits and every change is written to the log. */
  leaveEditMode(): void {
    if (!this.inEditMode) return;
    this.regs.LK.setValueAndExpected(this.regs.LK.value & 127);
    for (const name of REGISTER_NAMES) {
      const before = this.oldRegs?.[name] ?? 0;
      const after = this.regs[name].value;
      if (before !== after)
        this.addTextToLog(`${''.padStart(11, ' ')}${name} = ${before}  -zmiana->  ${name} = ${after}\n`);
    }
    for (const name of FLAG_NAMES) {
      const before = this.oldFlags?.[name] ?? 0;
      if (before !== this.flags[name])
        this.addTextToLog(`${''.padStart(11, ' ')}${name} = ${before}  -zmiana->  ${name} = ${this.flags[name]}\n`);
    }
    this.inEditMode = false;
    this.changed();
  }

  /** "Zeruj rejestry". */
  clearRegisters(): void {
    if (this.isRunning) return;
    this.addTextToLog('\n====Zerowanie rejestrów====\n');
    this.mark = 5;
    this.mistakes = this.cycle = 0;
    for (const n of REGISTER_NAMES) this.regs[n].reset();
    for (const f of FLAG_NAMES) this.flags[f] = f === 'MAV' ? 1 : 0;
    this.changed();
  }

  /* ========================================================= persistence */

  /** State saved in the browser between page reloads (only while the simulation is not running). */
  toSaved(): SavedState {
    return {
      regs: Object.fromEntries(REGISTER_NAMES.map((n) => [n, this.regs[n].value])),
      flags: { ...this.flags },
      pm: this.pm,
      pao: this.pao,
      settings: this.settings,
      cycle: this.cycle,
      mark: this.mark,
      mistakes: this.mistakes,
      canSimulate: this.canSimulate,
      log: this.log,
      logStartedAt: this.logStartedAt?.toISOString() ?? null,
      simStartedAt: this.simStartedAt?.toISOString() ?? null,
    };
  }

  restore(saved: SavedState): void {
    for (const n of REGISTER_NAMES) this.regs[n].setValueAndExpected(saved.regs[n] ?? 0);
    for (const f of FLAG_NAMES) this.flags[f] = saved.flags[f] ?? this.flags[f];
    if (saved.pm?.length === 256) this.pm = saved.pm;
    if (saved.pao?.length === 256) this.pao = saved.pao;
    this.settings = { ...DEFAULT_SETTINGS, ...saved.settings };
    this.cycle = saved.cycle ?? 0;
    this.mark = saved.mark ?? 5;
    this.mistakes = saved.mistakes ?? 0;
    this.canSimulate = saved.canSimulate ?? true;
    this.log = saved.log ?? null;
    this.logStartedAt = saved.logStartedAt ? new Date(saved.logStartedAt) : null;
    this.simStartedAt = saved.simStartedAt ? new Date(saved.simStartedAt) : null;
    this.addTextToLog(`\n${nowHMS().padStart(20, ' ')}\n==Wznowienie pracy (ponowne otwarcie strony)==\n`);
    this.changed();
  }

  /* ================================================================ buttons */

  /** "Zatwierdź" – validates the register the student had to fill in and resumes the simulation. */
  confirm(): void {
    if (this.waitingFor !== 'ok') return;
    this.validateRegisters();
    this.release();
  }

  /** "Następny takt" (micro mode). */
  nextTact(): void {
    if (this.waitingFor !== 'tact') return;
    this.release();
  }

  private release(): void {
    this.waitingFor = 'none';
    const resolve = this.resolveWait;
    this.resolveWait = null;
    resolve?.();
    this.changed();
  }

  private waitFor(what: WaitingFor): Promise<void> {
    this.waitingFor = what;
    this.changed();
    return new Promise<void>((resolve) => (this.resolveWait = resolve));
  }

  /** SimView.waitForButton – in the automatic mode the correct value is entered by the program. */
  private async waitForButton(): Promise<void> {
    if (!this.autoRun) {
      await this.waitFor('ok');
      return;
    }
    this.changed();
    await sleep(this.settings.delay);
    if (this.registerToCheck !== '') this.regs[this.registerToCheck].setValue(this.regs[this.registerToCheck].expected);
    this.validateRegisters();
    this.changed();
  }

  private async validateRegister(): Promise<void> {
    await this.waitForButton();
  }

  /** SimView.validateRegisters – compares the value typed by the student, counts mistakes, writes the log. */
  validateRegisters(): void {
    if (this.registerToCheck !== '') {
      const name = this.registerToCheck;
      const reg = this.regs[name];
      const result = reg.validate();
      const prefix = name === 'RAPS' ? '\n' : '';
      if (!result.ok) {
        this.onMistake();
        this.addTextToLog(
          `${prefix}${'Błąd'.padStart(14, ' ')}(${this.mistakes + 1}): ${name} = ${result.bad} / ${hex16(result.bad)}h ` +
            `(Poprawna ${name} = ${reg.value} / ${hex16(reg.value)}h)\n\n`,
        );
        this.mistakes++;
        const s = this.settings;
        if (this.mistakes >= s.thirdMark) this.mark = 2;
        else if (this.mistakes >= s.secondMark) this.mark = 3;
        else if (this.mistakes >= s.firstMark) this.mark = 4;
        else this.mark = 5;
      } else {
        this.onCorrect();
        this.addTextToLog(`${prefix}${name.padStart(15, ' ')} = ${reg.value} / ${hex16(reg.value)}h\n`);
      }
      this.registerToCheck = '';
    }
    if (this.flagToCheck !== '') {
      this.addTextToLog(`${this.flagToCheck.padStart(15, ' ')} = ${this.flags[this.flagToCheck]}\n`);
      this.flagToCheck = '';
    }
  }

  private testAndSet(register: RegName, value: number): void {
    const reg = this.regs[register];
    reg.setExpected(value);
    reg.needCheck = true;
    this.registerToCheck = register;
  }

  private setCursor(col: number): void {
    this.pmCursor = { row: this.raps, col };
  }

  private cell(col: number): string {
    return this.pm[this.raps][col];
  }

  /* ============================================================ simulation */

  /**
   * Starts one cycle (one microinstruction) – "MAKRO" (micro = false) or "MIKRO" (micro = true,
   * the student also confirms every tact). Resolves when the cycle (or the automatic run) ends.
   */
  async start(micro: boolean, autoRun: AutoRunTarget | null = null): Promise<void> {
    if (this.isRunning || this.inEditMode || !this.canSimulate || this.log === null) return;
    this.autoRun = autoRun;
    this.autoRunStopRequested = false;
    if (autoRun && autoRun.register === 'cycles')
      autoRun = this.autoRun = { register: 'cycles', value: this.cycle + autoRun.value };
    let first = true;
    do {
      this.prepareSimulation(micro, first);
      first = false;
      await this.simulateCPU();
    } while (this.isRunning);
    this.changed();
  }

  /** SimView.prepareSimulation (the log is already open). */
  private prepareSimulation(micro: boolean, first: boolean): void {
    this.inMicroMode = micro;
    if (this.simStartedAt === null) {
      this.simStartedAt = new Date();
      this.addTextToLog(
        `======Start symulacji======\n${nowHMS().padStart(20, ' ')}\n======Zawartość rejestrów======\n`,
      );
      for (const n of REGISTER_NAMES) this.addTextToLog(`${n.padEnd(6, ' ')} = ${this.regs[n].text}\n`);
      this.addTextToLog('\n');
      FLAG_NAMES.forEach((f, i) => {
        this.addTextToLog(`${f.padStart(5, ' ')} = ${this.flags[f]}`);
        this.addTextToLog((i + 1) % 3 === 0 ? '\n' : ', ');
      });
      this.addTextToLog('\n');
    }
    if (this.autoRun) {
      if (first) {
        if (this.autoRun.register === 'cycles') this.addTextToLog(`\nAUTO: CYKLE+> ?= ${this.autoRun.value}\n`);
        else this.addTextToLog(`\nAUTO: ${this.autoRun.register} ?= ${this.autoRun.value}\n`);
      }
    } else this.addTextToLog(micro ? 'MIKRO\n' : 'MAKRO\n');
    this.cycle++;
  }

  private async simulateCPU(): Promise<void> {
    this.startSim();
    if (this.currentTact === 0) await this.instructionFetch();
    this.switchLayOut();
    while (this.isRunning && this.currentTact > 0) await this.executeInstruction();
  }

  private startSim(): void {
    this.isRunning = true;
    for (const row of this.cells) row.fill(true);
    for (const n of REGISTER_NAMES) this.regs[n].setExpected(this.regs[n].value);
    this.changed();
  }

  private stopSim(): void {
    this.miniLog = [];
    this.isRunning = false;
    this.inMicroMode = false;
    this.autoRun = null;
    this.pmCursor = null;
    this.changed();
  }

  private async nextTactStep(): Promise<void> {
    if (this.inMicroMode && !this.autoRun) await this.waitFor('tact');
    this.currentTact = (this.currentTact + 1) % 8;
    this.changed();
  }

  /** Execution.instructionFetch – tact 0: reads the microinstruction pointed by RAPS. */
  private async instructionFetch(): Promise<void> {
    const c = this.cells;
    for (let i = 0; i < 8; i++) c[0][i] = false;
    for (let i = 0; i < 11; i++) c[i][0] = false;

    this.raps = this.regs.RAPS.value;
    const row = this.pm[this.raps];
    this.setCursor(1);
    const na = row[COL.NA] === '' ? 0 : Number.parseInt(row[COL.NA], 10);
    this.na = Number.isFinite(na) ? s16(na) : 0;
    this.rbps = formatRbps(rbpsValue(row) + this.na);

    this.addTextToLog(`===============${this.raps}================\nTakt0: RBPS=${this.rbps}\n`);
    for (let i = 1; i < 11; i++) for (let j = 1; j < 8; j++) c[i][j] = row[i] !== '';

    if (row[COL.C1] === 'SHT') {
      for (let j = 1; j < 8; j++) c[3][j] = false;
      for (let j = 1; j < 8; j++) c[10][j] = false;
    }
    if (c[1][1]) for (let j = 2; j < 8; j++) c[1][j] = false;
    if (c[2][1]) for (let j = 2; j < 8; j++) c[2][j] = false;
    if (c[3][1]) {
      for (let j = 1; j < 8; j++) c[3][j] = false;
      c[3][6] = true;
    }
    if (c[4][1]) {
      for (let j = 1; j < 8; j++) c[4][j] = false;
      if (isShiftOp(row[COL.D2])) c[4][1] = true;
      else c[4][6] = true;
    }
    if (c[5][1]) for (let j = 1; j < 7; j++) c[5][j] = false;
    if (c[6][1]) for (let j = 1; j < 7; j++) c[6][j] = false;
    if (c[7][1]) {
      for (let j = 1; j < 8; j++) c[7][j] = false;
      c[7][1] = true;
      const c1 = row[COL.C1];
      if (c1 === 'CWC' || c1 === 'IWC' || c1 === 'END') {
        c[7][7] = true;
        c[7][1] = false;
      }
      if (c1 === 'RRC') c[7][6] = true;
      if (c1 === 'SHT') c[7][1] = false;
    }
    if (c[8][1]) {
      for (let j = 1; j < 8; j++) c[8][j] = false;
      const c2 = row[COL.C2];
      if (c2 === 'RINT' || c2 === 'ENI') c[8][7] = true;
      else if (c2 === 'OPC') {
        c[8][7] = true;
        for (let j = 1; j < 8; j++) c[9][j] = false;
      } else if (c2 === 'CEA') c[8][1] = true;
      else c[8][6] = true;
    }
    if (c[9][1]) {
      for (let j = 1; j < 8; j++) c[9][j] = false;
      c[9][7] = true;
    }
    if (c[10][1]) {
      for (let j = 1; j < 8; j++) c[10][j] = false;
      c[10][2] = true;
    }
    await this.nextTactStep();
  }

  /** Execution.executeInstruction – tacts 1..7 of one cycle. */
  private async executeInstruction(): Promise<void> {
    const c = this.cells;
    if (this.currentTact === 1 && (c[1][1] || c[2][1] || c[4][1] || c[7][1])) this.addTextToLog('Takt1:\n');
    while (this.currentTact === 1 && (c[1][1] || c[2][1] || c[4][1] || c[7][1] || c[8][1])) await this.exeTact1();
    if (this.currentTact === 1) await this.nextTactStep();
    if (this.currentTact === 2 && c[10][2]) this.addTextToLog('Takt2:\n');
    while (this.currentTact === 2 && c[10][2]) await this.exeTact2();
    while (this.currentTact >= 2 && this.currentTact <= 5) await this.nextTactStep();
    if (this.currentTact === 6 && (c[3][6] || c[4][6] || c[8][6])) this.addTextToLog('Takt6:\n');
    while (this.currentTact === 6 && (c[3][6] || c[4][6] || c[8][6])) await this.exeTact6();
    if (this.currentTact === 6) await this.nextTactStep();
    if (this.currentTact === 7 && (c[5][7] || c[6][7] || c[7][7] || c[8][7] || c[9][7])) this.addTextToLog('Takt7:\n');
    while (this.currentTact === 7 && (c[5][7] || c[6][7] || c[7][7] || c[8][7])) await this.exeTact7();

    if (this.currentTact === 7 && c[9][7]) await this.exeTest();
    else if (this.currentTact === 7 && !this.isTestPositive) {
      this.halt = false;
      if (this.regs.RAPS.value === 255) {
        this.testAndSet('RAPS', 255);
        this.canSimulate = false;
        this.halt = true;
      } else this.testAndSet('RAPS', this.regs.RAPS.value + 1);
      this.setCursor(COL.NA);
      await this.waitForButton();
      this.currentTact = 0;
      this.endingCycle();
    } else if (this.currentTact === 8) {
      this.regs.LALU.setValueAndExpected(0);
      this.regs.RALU.setValueAndExpected(0);
      this.currentTact = 0;
      this.endingCycle();
    } else if (this.currentTact === 9) {
      this.currentTact = 0;
      this.endingCycle();
    }
  }

  /** Execution.endingCycle – decides whether the (automatic) run continues. */
  private endingCycle(): void {
    this.miniLog = [];
    if (this.halt) {
      this.addTextToLog(`${''.padStart(11, ' ')}RAPS = 255, STOP - BŁĄD KRYTYCZNY PROCESORA \n`);
      this.canSimulate = false;
      this.halt = false;
      this.stopSim();
      return;
    }
    const auto = this.autoRun;
    if (!auto || this.autoRunStopRequested) this.stopSim();
    else if (auto.register !== 'cycles' && this.regs[auto.register].expected === auto.value) this.stopSim();
    else if (auto.register === 'cycles' && this.cycle >= auto.value) this.stopSim();
    // otherwise isRunning stays true and start() runs the next cycle
  }

  private switchLayOut(): void {
    this.ceaLayout = this.layoutChange;
    this.layoutChange = false;
    this.changed();
  }

  /** Decodes RR: returns [address of the microprogram for OPC/TIND, isIndirect] (getRRRegisterOP). */
  private getRRRegisterOP(): [number, boolean] {
    const tmp = bin16(this.regs.RR.value);
    if (tmp.substring(0, 5) === '00000') return [Number.parseInt(tmp.substring(5, 9), 2) + 32, true];
    const op = Number.parseInt(tmp.substring(0, 5), 2);
    return [op, tmp.substring(7, 8) === '1'];
  }

  /* --------------------------------------------------------------- tact 1 */

  private async exeTact1(): Promise<void> {
    const c = this.cells;
    const r = this.regs;
    let setXro = -1;
    if (c[1][1]) {
      this.setCursor(COL.S1);
      const m = (this.microOpMnemo = this.cell(COL.S1));
      if (m === 'IXRE') this.testAndSet('LALU', r.RI.value);
      else if (m === 'OLR') this.testAndSet('BUS', r.LR.value);
      else if (m === 'ORR') this.testAndSet('BUS', r.RR.value);
      else if (m === 'ORAE') this.testAndSet('BUS', r.RAE.value);
      else if (m === 'IALU') this.testAndSet('LALU', r.A.value);
      else if (m === 'OXE') this.testAndSet('RALU', r.X.value);
      else if (m === 'OX') this.testAndSet('BUS', r.X.value);
      c[1][1] = false;
      this.addToLogAndMiniLog('S1', m, microOpDescription(m));
    } else if (c[2][1]) {
      this.setCursor(COL.D1);
      const m = (this.microOpMnemo = this.cell(COL.D1));
      if (m === 'ILK') this.testAndSet('LK', r.BUS.value);
      else if (m === 'IRAP') this.testAndSet('RAP', r.BUS.value);
      else if (m === 'OXE') this.testAndSet('RALU', r.X.value);
      c[2][1] = false;
      this.resetBus = true;
      this.addToLogAndMiniLog('D1', m, microOpDescription(m));
    } else if (c[4][1]) {
      this.setCursor(COL.D2);
      const m = (this.microOpMnemo = this.cell(COL.D2));
      this.addToLogAndMiniLog('D2', m, microOpDescription(m));
      this.addToLogAndMiniLog('C1', 'SHT', microOpDescription('SHT'));
      let A = r.A.value;
      const signBit = (A & 0x8000) === 0x8000;
      const lastBit = (A & 0x0001) === 0x0001;
      if (m === 'ALA') {
        A <<= 1;
        if (signBit) A |= 0x8000;
        else A &= 0x7fff;
        this.testAndSet('A', s16(A));
      } else if (m === 'ARA') {
        A >>= 1;
        if (signBit) A |= 0x8000;
        this.testAndSet('A', s16(A));
      } else if (m === 'LRQ') {
        A = (A & 0xffff) >> 1;
        this.testAndSet('A', s16(A));
        this.changed();
        await this.validateRegister();
        if (lastBit) this.testAndSet('MQ', s16(((r.MQ.value & 0xffff) >> 1) | 0x8000));
        else this.testAndSet('MQ', s16((r.MQ.value & 0xffff) >> 1));
      } else if (m === 'LLQ') {
        A = (A & 0xffff) << 1;
        if ((r.MQ.value & 0x8000) === 0x8000) this.testAndSet('A', s16((A & 0xffff) + 1));
        else this.testAndSet('A', s16(A & 0xffff));
        this.changed();
        await this.validateRegister();
        this.testAndSet('MQ', s16(r.MQ.value << 1));
      } else if (m === 'LLA') this.testAndSet('A', s16((A & 0xffff) << 1));
      else if (m === 'LRA') this.testAndSet('A', s16((A & 0xffff) >> 1));
      else if (m === 'LCA') {
        if (signBit) this.testAndSet('A', s16(((A & 0xffff) << 1) + 1));
        else this.testAndSet('A', s16((A & 0xffff) << 1));
      }
      c[4][1] = false;
    } else if (c[7][1]) {
      this.setCursor(COL.C1);
      const m = (this.microOpMnemo = this.cell(COL.C1));
      if (m === 'RRC') {
        const rap = r.RAP.value;
        if (rap > 255) this.testAndSet('RBP', 0);
        else {
          this.paoCursor = rap;
          const cell = this.pao[rap];
          this.testAndSet('RBP', cell.type === CellType.Empty ? 0 : cell.word);
          this.flags.MAV = 0;
          this.flags.IA = 1;
        }
      } else if (m === 'MUL') this.testAndSet('LK', 16);
      else if (m === 'DIV') this.testAndSet('LK', 15);
      c[7][1] = false;
      this.addToLogAndMiniLog('C1', m, microOpDescription(m));
    } else if (c[8][1]) {
      this.setCursor(COL.C2);
      const m = (this.microOpMnemo = this.cell(COL.C2));
      if (m === 'CEA') {
        this.layoutChange = true;
        this.switchLayOut();
        let leftValue = 0;
        let rightValue = 0;
        const tmp = bin16(r.RR.value);
        if (tmp.substring(0, 5) !== '00000') {
          const xsi = tmp.substring(5, 8);
          const da = Number.parseInt(tmp.substring(8, 16), 2);
          setXro = 0;
          if (xsi === '110' || xsi === '111') {
            leftValue = rightValue = 0;
            setXro = 1;
          } else if (xsi === '010' || xsi === '011') {
            rightValue = r.LR.value;
            leftValue = da;
          } else if (xsi === '100' || xsi === '101') {
            rightValue = r.RI.value;
            leftValue = da;
          } else leftValue = da;
        } else leftValue = Number.parseInt(tmp.substring(9, 16), 2);
        this.addToLogAndMiniLog('C2', m, microOpDescription(m));
        this.testAndSet('L', leftValue);
        this.changed();
        await this.validateRegister();
        this.testAndSet('R', rightValue);
        this.changed();
        await this.validateRegister();
        this.testAndSet('SUMA', (leftValue + rightValue) & 255);
        if (leftValue + rightValue > 255 || leftValue + rightValue < 0) setXro = 1;
      }
      c[8][1] = false;
    }

    await this.waitForButton();
    if (setXro === 0 || setXro === 1) {
      this.flags.XRO = setXro;
      this.addTextToLog(`${'XRO'.padStart(15, ' ')} = ${setXro}\n`);
    }
    if (this.resetBus) {
      r.BUS.setValueAndExpected(0);
      this.resetBus = false;
    }
    this.flags.IA = 0;
    this.flags.MAV = 1;
    this.switchLayOut();
  }

  /* --------------------------------------------------------------- tact 2 */

  private async exeTact2(): Promise<void> {
    const r = this.regs;
    if (this.cells[10][2]) {
      this.setCursor(COL.ALU);
      const m = (this.microOpMnemo = this.cell(COL.ALU));
      const L = r.LALU.value;
      const R = r.RALU.value;
      this.isOverflow = false;
      const withOverflow = (v: number) => {
        this.isOverflow = overflows16(v);
        this.testAndSet('ALU', s16(v));
      };
      if (m === 'ADD') withOverflow(L + R);
      else if (m === 'SUB') withOverflow(L - R);
      else if (m === 'CMX') this.testAndSet('ALU', s16(1 + ~R));
      else if (m === 'CMA') this.testAndSet('ALU', s16(1 + ~L));
      else if (m === 'OR') this.testAndSet('ALU', s16(L | R));
      else if (m === 'AND') this.testAndSet('ALU', s16(L & R));
      else if (m === 'EOR') this.testAndSet('ALU', s16(L ^ R));
      else if (m === 'NOTL') this.testAndSet('ALU', s16(~L));
      else if (m === 'NOTR') this.testAndSet('ALU', s16(~R));
      else if (m === 'L') this.testAndSet('ALU', L);
      else if (m === 'R') this.testAndSet('ALU', R);
      else if (m === 'INCL') withOverflow(L + 1);
      else if (m === 'INCR') withOverflow(R + 1);
      else if (m === 'DECL') withOverflow(L - 1);
      else if (m === 'DECR') withOverflow(R - 1);
      else if (m === 'ONE') this.testAndSet('ALU', 1);
      else if (m === 'ZERO') this.testAndSet('ALU', 0);
      this.cells[10][2] = false;
      this.addToLogAndMiniLog('ALU', m, microOpDescription(m));
    }

    await this.waitForButton();
    const sign = (r.ALU.expected & 0x8000) === 0x8000 ? 1 : 0;
    this.flags.ZNAK = sign;
    this.addTextToLog(`\t\tZNAK = ${sign}, `);
    this.flags.OFF = this.isOverflow ? 1 : 0;
    this.addTextToLog(`OFF = ${this.flags.OFF}\n`);
    this.isOverflow = false;
    r.LALU.setValue(0);
    r.RALU.setValue(0);
    this.changed();
  }

  /* --------------------------------------------------------------- tact 6 */

  private setSignFrom(value: number): void {
    const sign = (value & 0x8000) === 0x8000 ? 1 : 0;
    this.flags.ZNAK = sign;
    this.addTextToLog(`\t\tZNAK = ${sign}\n`);
  }

  private async exeTact6(): Promise<void> {
    const c = this.cells;
    const r = this.regs;
    if (c[3][6]) {
      this.setCursor(COL.S2);
      const m = (this.microOpMnemo = this.cell(COL.S2));
      if (m === 'IXRE') this.testAndSet('LALU', r.RI.value);
      else if (m === 'ORR') this.testAndSet('BUS', r.RR.value);
      else if (m === 'ORI') this.testAndSet('BUS', r.RI.value);
      else if (m === 'OBE') this.testAndSet('BUS', r.ALU.value);
      else if (m === 'IRAE') this.testAndSet('RAE', r.SUMA.value);
      else if (m === 'ORAE') this.testAndSet('BUS', r.RAE.value);
      else if (m === 'IALU') this.testAndSet('LALU', r.A.value);
      else if (m === 'OXE') this.testAndSet('RALU', r.X.value);
      else if (m === 'OX') this.testAndSet('BUS', r.X.value);
      else if (m === 'OA') this.testAndSet('BUS', r.A.value);
      else if (m === 'OMQ') this.testAndSet('BUS', r.MQ.value);
      c[3][6] = false;
      this.addToLogAndMiniLog('S2', m, microOpDescription(m));
    } else if (c[4][6]) {
      this.setCursor(COL.D2);
      const m = (this.microOpMnemo = this.cell(COL.D2));
      if (m === 'ORI') this.testAndSet('BUS', r.RI.value);
      else if (m === 'OXE') this.testAndSet('RALU', r.X.value);
      else if (m === 'ILR') this.testAndSet('LR', r.BUS.value);
      else if (m === 'IRI') this.testAndSet('RI', r.BUS.value);
      else if (m === 'IX') this.testAndSet('X', r.BUS.value);
      else if (m === 'IBE') this.testAndSet('RALU', r.BUS.value);
      else if (m === 'IBI') this.testAndSet('RAE', r.BUS.value);
      else if (m === 'IA') this.testAndSet('A', r.BUS.value);
      else if (m === 'IMQ') this.testAndSet('MQ', r.BUS.value);
      else if (m === 'NSI') this.testAndSet('LR', s16(r.LR.value + 1));
      else if (m === 'IAS') this.setSignFrom(r.A.value);
      else if (m === 'SGN') this.setSignFrom(r.X.value);
      c[4][6] = false;
      this.resetBus = true;
      this.addToLogAndMiniLog('D2', m, microOpDescription(m));
    } else if (c[8][6]) {
      this.setCursor(COL.C2);
      const m = (this.microOpMnemo = this.cell(COL.C2));
      if (m === 'DLK') this.testAndSet('LK', s16(r.LK.value - 1));
      else if (m === 'DRI') this.testAndSet('RI', s16(r.RI.value - 1));
      else if (m === 'SOFF') this.setFlag('OFF', 1);
      else if (m === 'ROFF') this.setFlag('OFF', 0);
      else if (m === 'SXRO') this.setFlag('XRO', 1);
      else if (m === 'RXRO') this.setFlag('XRO', 0);
      else if (m === 'AQ15') {
        if ((r.A.value & 0x8000) === 0x8000) this.testAndSet('MQ', s16(r.MQ.value & 0xfffe));
        else this.testAndSet('MQ', s16(r.MQ.value | 0x0001));
      } else if (m === 'RA') this.testAndSet('A', 0);
      else if (m === 'RMQ') this.testAndSet('MQ', 0);
      c[8][6] = false;
      this.addToLogAndMiniLog('C2', m, microOpDescription(m));
    }
    await this.waitForButton();
    if (this.resetBus) {
      r.BUS.setValueAndExpected(0);
      this.resetBus = false;
    }
    this.changed();
  }

  private setFlag(flag: FlagName, value: number): void {
    this.flags[flag] = value;
    this.flagToCheck = flag;
  }

  /* --------------------------------------------------------------- tact 7 */

  private async exeTact7(): Promise<void> {
    const c = this.cells;
    const r = this.regs;
    if (c[5][7]) {
      this.setCursor(COL.S3);
      const m = (this.microOpMnemo = this.cell(COL.S3));
      if (m === 'ORI') this.testAndSet('BUS', r.RI.value);
      else if (m === 'ORAE') this.testAndSet('BUS', r.RAE.value);
      else if (m === 'OXE') this.testAndSet('RALU', r.X.value);
      else if (m === 'OA') this.testAndSet('BUS', r.A.value);
      else if (m === 'OMQ') this.testAndSet('BUS', r.MQ.value);
      else if (m === 'OLR') this.testAndSet('BUS', r.LR.value);
      else if (m === 'ORBP') this.testAndSet('BUS', r.RBP.value);
      c[5][7] = false;
      this.addToLogAndMiniLog('S3', m, microOpDescription(m));
    } else if (c[6][7]) {
      this.setCursor(COL.D3);
      const m = (this.microOpMnemo = this.cell(COL.D3));
      if (m === 'OXE') this.testAndSet('RALU', r.X.value);
      else if (m === 'ILR') this.testAndSet('LR', r.BUS.value);
      else if (m === 'IX') this.testAndSet('X', r.BUS.value);
      else if (m === 'IBE') this.testAndSet('RALU', r.BUS.value);
      else if (m === 'IBI') this.testAndSet('RAE', r.BUS.value);
      else if (m === 'IA') this.testAndSet('A', r.BUS.value);
      else if (m === 'IMQ') this.testAndSet('MQ', r.BUS.value);
      else if (m === 'NSI') this.testAndSet('LR', s16(r.LR.value + 1));
      else if (m === 'IAS') this.setSignFrom(r.A.value);
      else if (m === 'SGN') this.setSignFrom(r.X.value);
      else if (m === 'IRI') this.testAndSet('RI', r.BUS.value);
      else if (m === 'IRR') this.testAndSet('RR', r.BUS.value);
      else if (m === 'IRBP' || m === 'SRBP') this.testAndSet('RBP', r.BUS.value);
      c[6][7] = false;
      this.resetBus = true;
      this.addToLogAndMiniLog('D3', m, microOpDescription(m));
    } else if (c[7][7]) {
      let newCell: { addr: number; cell: MemCell } | null = null;
      this.setCursor(COL.C1);
      const m = (this.microOpMnemo = this.cell(COL.C1));
      if (m === 'END') this.testAndSet('RAPS', 0);
      else if (m === 'CWC') {
        this.flags.MAV = 0;
        this.flags.IA = 1;
        newCell = { addr: r.RAP.value, cell: { word: r.RBP.value, type: CellType.Data } };
      } else if (m === 'IWC') {
        this.flags.MAV = 0;
        this.flags.IA = 1;
        r.RAP.setValueAndExpected(255);
        this.pao = this.pao.map((cell, i) => (i === 255 ? { word: r.LR.value, type: CellType.Data } : cell));
        this.paoCursor = 255;
        this.registerToCheck = 'RAP';
      }
      if (m === 'END') this.currentTact = 9;
      c[7][7] = false;
      this.addToLogAndMiniLog('C1', m, microOpDescription(m));
      if (newCell) {
        this.paoCursor = newCell.addr;
        this.setPaoCell(newCell.addr, newCell.cell, true);
      }
    } else if (c[8][7]) {
      this.setCursor(COL.C2);
      const m = (this.microOpMnemo = this.cell(COL.C2));
      if (m === 'RINT') this.setFlag('INT', 0);
      else if (m === 'ENI') this.setFlag('INT', 1);
      else if (m === 'OPC') {
        this.testAndSet('RAPS', this.getRRRegisterOP()[0]);
        this.currentTact = 8;
      }
      c[8][7] = false;
      this.addToLogAndMiniLog('C2', m, microOpDescription(m));
    }

    await this.waitForButton();
    if (this.resetBus) {
      r.BUS.setValueAndExpected(0);
      this.resetBus = false;
    }
    this.changed();
  }

  /** Execution.exeTest – TEST column, computes the next RAPS. */
  private async exeTest(): Promise<void> {
    const r = this.regs;
    const f = this.flags;
    this.setCursor(COL.TEST);
    const m = (this.microOpMnemo = this.cell(COL.TEST));
    let otherValue = false;
    if (m === 'UNB') this.isTestPositive = true;
    else if (m === 'TINT') {
      this.addTextToLog(`${'INT = '.padStart(18, ' ')}${f.INT}\n`);
      if (f.INT === 0) this.isTestPositive = true;
      else {
        otherValue = true;
        f.INT = 0;
        this.testAndSet('RAP', 255);
        this.changed();
        await this.waitForButton();
        r.RAPS.setExpected(254);
      }
    } else if (m === 'TIND') {
      const [a, indirect] = this.getRRRegisterOP();
      if (indirect) this.isTestPositive = true;
      else {
        otherValue = true;
        r.RAPS.setExpected(a);
      }
    } else if (m === 'TAS') this.isTestPositive = r.A.value >= 0;
    else if (m === 'TXS') this.isTestPositive = r.RI.value >= 0;
    else if (m === 'TQ15') this.isTestPositive = (r.MQ.value & 0x0001) !== 0x0001;
    else if (m === 'TLK') {
      if (this.cell(COL.C1) === 'SHT') this.isTestPositive = r.LK.value === 0;
      else this.isTestPositive = r.LK.value !== 0;
    } else if (m === 'TSD') this.isTestPositive = f.ZNAK === 0;
    else if (m === 'TAO') this.isTestPositive = f.OFF === 0;
    else if (m === 'TXP') this.isTestPositive = r.RI.value <= 0;
    else if (m === 'TXZ') {
      const op = bin16(r.RR.value).substring(0, 5);
      if (op === '10101')
        this.isTestPositive = r.RI.value === 0; // TLD
      else if (op === '10011') this.isTestPositive = r.RI.value !== 0; // BXZ
    } else if (m === 'TXRO') this.isTestPositive = f.XRO === 0;
    else if (m === 'TAP') this.isTestPositive = r.A.value <= 0;
    else if (m === 'TAZ') this.isTestPositive = r.A.value === 0;

    this.cells[9][7] = false;
    this.addToLogAndMiniLog('TEST', m, microOpDescription(m));

    if (this.isTestPositive) {
      r.RAPS.setExpected(this.na);
      this.isTestPositive = false;
    } else if (!otherValue) r.RAPS.setExpected((r.RAPS.value + 1) & 255);
    r.RAPS.needCheck = true;
    this.registerToCheck = 'RAPS';
    this.setCursor(COL.NA);

    await this.waitForButton();
    this.currentTact = 9;
  }
}
