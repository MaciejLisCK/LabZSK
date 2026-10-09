import { Injectable, signal } from '@angular/core';
import {
  FileFormatError,
  readLogFile,
  readPmFile,
  readPoFile,
  writeLogFile,
  writePmFile,
  writePoFile,
} from './core/files';
import { MemCell, emptyCell, printPAO } from './core/memory';
import { MicroOp, emptyPM, pmEdit, printPM } from './core/microcode';
import { AutoRunTarget, SavedState, SimSettings, Simulator, StudentInfo } from './core/simulator';

const STORAGE_KEY = 'labzsk-web-state-v1';
const SKIN_KEY = 'labzsk-web-skin';

export type Skin = 'light' | 'green' | 'blue' | 'red' | 'grey' | 'xmas';

function download(name: string, data: Uint8Array | string, type = 'application/octet-stream'): void {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable – the app keeps working without it */
  }
}

/** Angular wrapper around the framework-free {@link Simulator}. */
@Injectable({ providedIn: 'root' })
export class SimService {
  readonly sim = new Simulator();
  /** Incremented on every change of the simulator – templates read it to re-render. */
  readonly version = signal(0);
  readonly message = signal<{ text: string; error: boolean } | null>(null);
  readonly skin = signal<Skin>((readStorage(SKIN_KEY) as Skin) || 'light');
  /** Event counters for the decorations of the Christmas skin. */
  readonly correctCount = signal(0);
  readonly mistakeCount = signal(0);
  readonly startCount = signal(0);
  /** Last state saved while the simulation was idle (registers are consistent only then). */
  private lastIdle: SavedState | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const raw = readStorage(STORAGE_KEY);
    if (raw) {
      try {
        this.sim.restore(JSON.parse(raw) as SavedState);
      } catch {
        /* corrupted state – start from scratch */
      }
    }
    this.sim.onChange = () => {
      this.version.update((v) => v + 1);
      this.scheduleSave();
    };
    this.sim.onMistake = () => {
      this.beep();
      this.mistakeCount.update((n) => n + 1);
    };
    this.sim.onCorrect = () => this.correctCount.update((n) => n + 1);
    this.lastIdle = this.sim.toSaved();
    window.addEventListener('pagehide', () => this.save());
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.save(), 300);
  }

  private save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const sim = this.sim;
    if (!sim.isRunning) this.lastIdle = sim.toSaved();
    // While running only the log and the result are updated, so a reload cannot erase mistakes.
    const state: SavedState = sim.isRunning
      ? { ...this.lastIdle!, log: sim.log, mistakes: sim.mistakes, mark: sim.mark, canSimulate: sim.canSimulate }
      : this.lastIdle!;
    writeStorage(STORAGE_KEY, JSON.stringify(state));
  }

  private beep(): void {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      osc.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
      osc.onended = () => void ctx.close();
    } catch {
      /* no audio */
    }
  }

  /** Returns the simulator; templates call it with `version()` so they re-render on every change. */
  at(_version: number): Simulator {
    return this.sim;
  }

  notify(text: string, error = false): void {
    this.message.set({ text, error });
  }

  setSkin(skin: Skin): void {
    this.skin.set(skin);
    writeStorage(SKIN_KEY, skin);
  }

  /* ----------------------------------------------------------- simulation */

  get needsLog(): boolean {
    return this.sim.log === null;
  }

  openLog(student: StudentInfo): void {
    this.sim.openLog(student, navigator.userAgent);
  }

  start(micro: boolean, autoRun: AutoRunTarget | null = null): void {
    this.startCount.update((n) => n + 1);
    void this.sim.start(micro, autoRun);
  }

  updateSettings(settings: SimSettings): void {
    const before = this.sim.settings;
    this.sim.settings = settings;
    if (JSON.stringify(before) !== JSON.stringify(settings)) {
      this.sim.addTextToLog(
        `\n==Zmiana ustawień: progi ocen ${settings.firstMark}/${settings.secondMark}/${settings.thirdMark}` +
          `, zamykanie logu: ${settings.canCloseLog ? 'tak' : 'nie'}, konsola: ${settings.devConsole ? 'tak' : 'nie'}==\n`,
      );
      this.sim.logSettingsInfo();
    }
    this.version.update((v) => v + 1);
    this.scheduleSave();
  }

  /* ------------------------------------------------------------------ PM */

  editPm(row: number, col: number, value: string): void {
    for (const c of pmEdit(this.sim.pm, row, col, value)) this.sim.setPmCell(c.row, c.col, c.value);
  }

  clearPmRow(row: number): void {
    for (let col = 1; col < 12; col++) this.sim.setPmCell(row, col, '');
  }

  clearPm(): void {
    this.sim.loadPm(emptyPM());
  }

  async loadPmFile(file: File): Promise<void> {
    try {
      const pm: MicroOp[] = readPmFile(new Uint8Array(await file.arrayBuffer()));
      this.sim.loadPm(pm);
      this.notify(`Wczytano mikroprogram „${file.name}”.`);
    } catch (e) {
      this.notify(e instanceof FileFormatError ? e.message : 'Nie udało się wczytać pliku mikroprogramu.', true);
    }
  }

  savePmFile(): void {
    download(`mikroprogram-${timestamp()}.pm`, writePmFile(this.sim.pm));
  }

  printPm(): void {
    download(`PM-${timestamp()}.txt`, printPM(this.sim.pm), 'text/plain;charset=utf-8');
  }

  /* ----------------------------------------------------------------- PAO */

  editPao(addr: number, cell: MemCell): void {
    this.sim.setPaoCell(addr, cell);
  }

  clearPao(): void {
    this.sim.pao.forEach((_, i) => this.sim.setPaoCell(i, emptyCell()));
  }

  async loadPoFile(file: File): Promise<void> {
    try {
      this.sim.loadPao(readPoFile(new Uint8Array(await file.arrayBuffer())));
      this.notify(`Wczytano pamięć operacyjną „${file.name}”.`);
    } catch (e) {
      this.notify(e instanceof FileFormatError ? e.message : 'Nie udało się wczytać pliku pamięci.', true);
    }
  }

  savePoFile(): void {
    download(`pamiec-${timestamp()}.po`, writePoFile(this.sim.pao));
  }

  printPao(): void {
    download(`PAO-${timestamp()}.txt`, printPAO(this.sim.pao), 'text/plain;charset=utf-8');
  }

  /* ----------------------------------------------------------------- log */

  downloadLog(text = this.sim.log): void {
    if (text === null) return;
    download(`labzsk-${timestamp()}.log`, writeLogFile(text));
  }

  closeLog(): void {
    const text = this.sim.closeLog();
    this.downloadLog(text);
  }

  async readLog(file: File): Promise<{ text: string; valid: boolean }> {
    return readLogFile(new Uint8Array(await file.arrayBuffer()));
  }
}
