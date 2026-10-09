import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { AboutDialog } from './dialogs/about-dialog';
import { AutoRunDialog } from './dialogs/auto-run-dialog';
import { LogDialog } from './dialogs/log-dialog';
import { MemCellDialog } from './dialogs/mem-cell-dialog';
import { PmCellDialog } from './dialogs/pm-cell-dialog';
import { SettingsDialog } from './dialogs/settings-dialog';
import { StartLogDialog } from './dialogs/start-log-dialog';
import { PaoTable } from './pao-table/pao-table';
import { PmTable } from './pm-table/pm-table';
import { Schematic } from './schematic/schematic';
import { SimService } from './sim.service';

type FileKind = 'pm' | 'po' | 'log';

/** Sizes of the resizable panes: right column width [px], heights of the top panes [% of the column]. */
interface PaneSizes {
  rightW: number;
  simH: number;
  ctrlH: number;
}
type PaneKey = keyof PaneSizes;

const SIZES_KEY = 'labzsk-web-layout';
const DEFAULT_SIZES: PaneSizes = { rightW: 380, simH: 60, ctrlH: 55 };
const LIMITS: Record<PaneKey, [number, number]> = { rightW: [260, 900], simH: [15, 85], ctrlH: [15, 85] };

const clampSize = (key: PaneKey, v: number) => Math.round(Math.min(LIMITS[key][1], Math.max(LIMITS[key][0], v)));

function loadSizes(): PaneSizes {
  try {
    const saved = JSON.parse(localStorage.getItem(SIZES_KEY) ?? '{}') as Partial<PaneSizes>;
    const out = { ...DEFAULT_SIZES };
    for (const k of Object.keys(out) as PaneKey[]) if (typeof saved[k] === 'number') out[k] = clampSize(k, saved[k]!);
    return out;
  } catch {
    return { ...DEFAULT_SIZES };
  }
}

@Component({
  selector: 'app-root',
  imports: [
    Schematic,
    PmTable,
    PaoTable,
    PmCellDialog,
    MemCellDialog,
    StartLogDialog,
    SettingsDialog,
    AutoRunDialog,
    LogDialog,
    AboutDialog,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)', '(document:click)': 'closeMenus($event)' },
})
export class App {
  protected readonly svc = inject(SimService);
  protected readonly pmDialog = viewChild.required(PmCellDialog);
  protected readonly memDialog = viewChild.required(MemCellDialog);
  protected readonly startLog = viewChild.required(StartLogDialog);
  protected readonly settings = viewChild.required(SettingsDialog);
  protected readonly autoRun = viewChild.required(AutoRunDialog);
  protected readonly logDialog = viewChild.required(LogDialog);
  protected readonly about = viewChild.required(AboutDialog);
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('file');
  private fileKind: FileKind = 'pm';
  private pendingStart: boolean | null = null;
  protected readonly now = signal(Date.now());
  private readonly layout = viewChild.required<ElementRef<HTMLElement>>('layout');
  protected readonly sizes = signal<PaneSizes>(loadSizes());
  protected readonly dragging = signal(false);

  constructor() {
    setInterval(() => this.now.set(Date.now()), 1000);
  }

  protected elapsed(from: Date | null): string {
    if (!from) return '–';
    const s = Math.max(0, Math.floor((this.now() - from.getTime()) / 1000));
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  }

  protected clock(d: Date | null): string {
    return d ? d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '–';
  }

  /* ---------------------------------------------------------- pane sizes */

  private setSize(key: PaneKey, value: number): void {
    this.sizes.update((s) => ({ ...s, [key]: clampSize(key, value) }));
    try {
      localStorage.setItem(SIZES_KEY, JSON.stringify(this.sizes()));
    } catch {
      /* storage unavailable */
    }
  }

  protected resetSize(key: PaneKey): void {
    this.setSize(key, DEFAULT_SIZES[key]);
  }

  /** Drag of a splitter: the right column width follows the pointer, top pane heights are a % of their column. */
  protected startDrag(event: PointerEvent, key: PaneKey): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.target as HTMLElement;
    const column = handle.parentElement!;
    const layout = this.layout().nativeElement;
    handle.setPointerCapture(event.pointerId);
    this.dragging.set(true);
    const move = (e: PointerEvent) => {
      if (key === 'rightW') {
        const rect = layout.getBoundingClientRect();
        this.setSize(key, rect.right - 12 - e.clientX - 5);
      } else {
        const rect = column.getBoundingClientRect();
        this.setSize(key, ((e.clientY - rect.top) / rect.height) * 100);
      }
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      this.dragging.set(false);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  /** Keyboard resizing of a focused splitter (arrows, Shift = bigger step, Home = default). */
  protected keyResize(event: KeyboardEvent, key: PaneKey): void {
    const step = (key === 'rightW' ? 20 : 2) * (event.shiftKey ? 5 : 1);
    const cur = this.sizes()[key];
    const delta: Record<string, number> =
      key === 'rightW' ? { ArrowLeft: step, ArrowRight: -step } : { ArrowUp: -step, ArrowDown: step };
    if (event.key in delta) this.setSize(key, cur + delta[event.key]);
    else if (event.key === 'Home') this.resetSize(key);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  /* ------------------------------------------------------------ simulation */

  protected start(micro: boolean): void {
    const sim = this.svc.sim;
    if (sim.isRunning || sim.inEditMode) return;
    if (!sim.canSimulate) {
      this.svc.notify('Procesor zatrzymany (RAPS = 255). Dalsza symulacja wymaga zamknięcia logu.', true);
      return;
    }
    if (this.svc.needsLog) {
      this.pendingStart = micro;
      this.startLog().open();
      return;
    }
    this.svc.start(micro);
  }

  protected logCreated(): void {
    if (this.pendingStart !== null) {
      const micro = this.pendingStart;
      this.pendingStart = null;
      this.svc.start(micro);
    }
  }

  protected toggleEdit(): void {
    const sim = this.svc.sim;
    if (sim.inEditMode) sim.leaveEditMode();
    else sim.enterEditMode();
  }

  protected clearRegisters(): void {
    if (confirm('Wyzerować rejestry, licznik cykli i ocenę?')) this.svc.sim.clearRegisters();
  }

  protected closeLog(): void {
    if (!this.svc.sim.settings.canCloseLog) {
      this.svc.notify('Nie posiadasz uprawnień do wykonania tej operacji (zamykanie logu wyłączone w opcjach).', true);
      return;
    }
    if (confirm('Czy chcesz zakończyć pracę z obecnym logiem? Log zostanie pobrany na dysk.')) this.svc.closeLog();
  }

  protected showLog(): void {
    const log = this.svc.sim.log;
    if (log !== null) this.logDialog().open(log);
  }

  protected openAutoRun(): void {
    const sim = this.svc.sim;
    if (sim.isRunning || sim.inEditMode) return;
    if (this.svc.needsLog) {
      this.svc.notify('Najpierw utwórz log (uruchom MAKRO lub MIKRO).', true);
      return;
    }
    this.autoRun().open();
  }

  /* ----------------------------------------------------------------- files */

  protected pickFile(kind: FileKind): void {
    if (kind !== 'log' && this.svc.sim.isRunning) return;
    this.fileKind = kind;
    const input = this.fileInput().nativeElement;
    input.accept = kind === 'pm' ? '.pm' : kind === 'po' ? '.po' : '.log';
    input.value = '';
    input.click();
  }

  protected async fileChosen(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    if (this.fileKind === 'pm') await this.svc.loadPmFile(file);
    else if (this.fileKind === 'po') await this.svc.loadPoFile(file);
    else {
      const { text, valid } = await this.svc.readLog(file);
      this.logDialog().open(text, valid);
    }
  }

  protected loadExample(): void {
    if (!this.svc.sim.isRunning && confirm('Zastąpić mikroprogram i pamięć operacyjną przykładem?')) this.svc.loadExample();
  }

  protected clearPm(): void {
    if (!this.svc.sim.isRunning && confirm('Czy na pewno chcesz wyczyścić cały mikroprogram?')) this.svc.clearPm();
  }

  protected clearPao(): void {
    if (!this.svc.sim.isRunning && confirm('Czy na pewno chcesz wyczyścić całą pamięć?')) this.svc.clearPao();
  }

  /* ------------------------------------------------------------- keyboard */

  protected onKey(event: KeyboardEvent): void {
    if (document.querySelector('dialog[open]')) return;
    const sim = this.svc.sim;
    if (event.key === 'Escape') {
      if (sim.inEditMode) sim.leaveEditMode();
      if (sim.autoRun) sim.autoRunStopRequested = true;
      return;
    }
    if (event.key !== 'Enter' || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest('td, tr[tabindex], button, select, textarea, summary')) return;
    if (sim.inEditMode && target.tagName === 'INPUT') return;
    event.preventDefault();
    if (sim.waitingFor === 'ok') sim.confirm();
    else if (sim.waitingFor === 'tact') sim.nextTact();
    else if (!sim.isRunning && !sim.inEditMode) this.start(false);
  }

  /** Closes open drop-down menus when clicking outside of them or on a menu item. */
  protected closeMenus(event: Event): void {
    const target = event.target as HTMLElement;
    for (const d of Array.from(document.querySelectorAll<HTMLDetailsElement>('details.menu[open]'))) {
      if (!d.contains(target) || target.closest('.menu-items button')) d.open = false;
    }
  }
}
