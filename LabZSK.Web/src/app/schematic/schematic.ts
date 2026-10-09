import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject } from '@angular/core';
import { hex16, parseRegisterInput } from '../core/int16';
import { FLAG_NAMES, FlagName, NON_EDITABLE, RegName } from '../core/registers';
import { SimService } from '../sim.service';

const W = 1000;
const H = 520;
const BW = 150;
const BH = 34;
const FW = 40;
const FH = 30;

type Box = { x: number; y: number };

/** Positions follow SimView.rearrangeTextBoxes for a 1000 x 500 panel (shifted 10 px down). */
const REG_POS: Record<RegName | 'RBPS', Box> = {
  LK: { x: 50, y: 46 },
  A: { x: 300, y: 46 },
  MQ: { x: 550, y: 46 },
  X: { x: 800, y: 46 },
  RAP: { x: 50, y: 128 },
  LALU: { x: 300, y: 128 },
  RALU: { x: 550, y: 128 },
  RBP: { x: 50, y: 228 },
  ALU: { x: 425, y: 228 },
  BUS: { x: 50, y: 310 },
  RR: { x: 300, y: 346 },
  LR: { x: 550, y: 346 },
  RI: { x: 800, y: 346 },
  RBPS: { x: 300, y: 428 },
  RAPS: { x: 550, y: 428 },
  RAE: { x: 800, y: 428 },
  L: { x: 400, y: 410 },
  R: { x: 650, y: 410 },
  SUMA: { x: 525, y: 471 },
};
const RAE_CEA: Box = { x: 800, y: 471 };

const FLAG_POS: Record<FlagName, Box> = {
  ZNAK: { x: 760, y: 183 },
  XRO: { x: 840, y: 183 },
  OFF: { x: 920, y: 183 },
  MAV: { x: 760, y: 246 },
  IA: { x: 840, y: 246 },
  INT: { x: 920, y: 246 },
};

const NORMAL_REGS: RegName[] = [
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
];
const CEA_REGS: RegName[] = [
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
  'L',
  'R',
  'SUMA',
  'RAE',
];

const cx = (b: Box) => b.x + BW / 2;
const cy = (b: Box) => b.y + BH / 2;
const P = REG_POS;

/** Bus lines – port of Drawings.drawSkin. */
function busPaths(cea: boolean): { thick: string[]; thin: string[]; fill: string[] } {
  const bus = cy(P.BUS);
  const top = 8;
  const left = 25;
  const thick = [
    `M ${cx(P.BUS)} ${bus} H ${W}`,
    ...(['RR', 'LR', 'RI'] as const).map((r) => `M ${cx(P[r])} ${bus} V ${cy(P[r])}`),
    `M ${left} ${H} V ${top} H ${W}`,
    ...(['LK', 'A', 'MQ', 'X'] as const).map((r) => `M ${cx(P[r])} ${top} V ${cy(P[r])}`),
    ...(['RAP', 'RBP', 'BUS'] as const).map((r) => `M ${left} ${cy(P[r])} H ${P[r].x + 10}`),
    `M ${cx(P.A)} ${cy(P.A)} V ${cy(P.LALU)}`,
    `M ${cx(P.ALU)} ${cy(P.ALU)} V ${bus}`,
  ];
  const gap = (P.RALU.y - P.X.y) / 2;
  thick.push(`M ${cx(P.RALU)} ${cy(P.RALU)} V ${cy(P.RALU) - gap} H ${cx(P.X)} V ${cy(P.X)}`);
  const trapezoid = (from: Box, to: Box) =>
    `M ${from.x} ${from.y + BH} H ${from.x + BW} L ${to.x + BW} ${to.y} H ${to.x} Z`;
  const fill = [trapezoid(P.LALU, P.ALU), trapezoid(P.RALU, P.ALU)];
  if (cea) {
    thick.push(`M ${cx(P.RR)} ${cy(P.RR)} V ${cy(P.L)} H ${P.L.x + BH / 2}`);
    thick.push(`M ${cx(P.RI)} ${cy(P.RI)} V ${cy(P.R)} H ${cx(P.R)}`);
    thick.push(`M ${cx(P.LR)} ${cy(P.LR)} V ${cy(P.R)} H ${cx(P.R)}`);
    fill.push(trapezoid(P.L, P.SUMA), trapezoid(P.R, P.SUMA));
    thick.push(`M ${cx(P.SUMA)} ${cy(P.SUMA)} V ${P.SUMA.y + BH - 6} H ${RAE_CEA.x}`);
  } else {
    thick.push(`M ${cx(P.RAE)} ${cy(P.RAE)} V ${cy(P.RAE) + (H - P.RAE.y) / 2} H ${left}`);
  }
  return { thick, thin: [`M ${cx(P.A)} ${cy(P.A)} H ${cx(P.MQ)}`], fill };
}

const pct = (v: number, total: number) => `${(v / total) * 100}%`;

/** Deterministic pseudo-random generator, so the Christmas decorations look the same on every render. */
function rng(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const BULB_COLORS = ['#ff4d4d', '#ffd23f', '#4dd2ff', '#ff8cf0', '#ffffff'];

/** Light bulbs hanging from the top bus of the Christmas skin. */
const BULBS = Array.from({ length: 24 }, (_, i) => ({
  x: 45 + i * 40,
  color: BULB_COLORS[i % BULB_COLORS.length],
  delay: `${(i % 7) * -0.35}s`,
}));

/** Snowflakes of the Christmas skin. */
const FLAKES = (() => {
  const r = rng(2412);
  return Array.from({ length: 45 }, () => ({
    left: r() * 100,
    size: 8 + r() * 12,
    duration: 7 + r() * 9,
    delay: -r() * 16,
    drift: (r() - 0.5) * 80,
    char: r() < 0.6 ? '❄' : '•',
  }));
})();

@Component({
  selector: 'app-schematic',
  templateUrl: './schematic.html',
  styleUrl: './schematic.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Schematic {
  protected readonly svc = inject(SimService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly W = W;
  protected readonly H = H;
  protected readonly flagNames = FLAG_NAMES;
  protected readonly cea = computed(() => {
    this.svc.version();
    return this.svc.sim.ceaLayout;
  });
  protected readonly paths = computed(() => busPaths(this.cea()));
  protected readonly regNames = computed(() => (this.cea() ? CEA_REGS : NORMAL_REGS));
  protected readonly xmas = computed(() => this.svc.skin() === 'xmas');
  protected readonly bulbs = BULBS;
  protected readonly flakes = FLAKES;
  private lastFocused = '';
  private dragValue: number | null = null;

  constructor() {
    // Move the keyboard focus to the register the student has to fill in.
    effect(() => {
      this.svc.version();
      const sim = this.svc.sim;
      const key =
        sim.waitingFor === 'ok' && sim.registerToCheck
          ? `${sim.cycle}:${sim.currentTact}:${sim.registerToCheck}:${sim.regs[sim.registerToCheck].expected}`
          : '';
      if (key && key !== this.lastFocused) {
        this.lastFocused = key;
        setTimeout(() => this.host.nativeElement.querySelector<HTMLInputElement>('input[data-check]')?.focus());
      }
      if (!key) this.lastFocused = '';
    });
  }

  protected boxStyle(name: RegName | 'RBPS') {
    const b = name === 'RAE' && this.cea() ? RAE_CEA : REG_POS[name];
    return { left: pct(b.x, W), top: pct(b.y, H), width: pct(BW, W), height: pct(BH, H) };
  }

  protected flagStyle(name: FlagName) {
    const b = FLAG_POS[name];
    return { left: pct(b.x, W), top: pct(b.y, H), width: pct(FW, W), height: pct(FH, H) };
  }

  protected display(name: RegName): string {
    const v = this.svc.sim.regs[name].value;
    return `${hex16(v)}h`;
  }

  protected isEditable(name: RegName): boolean {
    const sim = this.svc.sim;
    return sim.regs[name].needCheck || (sim.inEditMode && !NON_EDITABLE.includes(name));
  }

  protected onInput(name: RegName, text: string): void {
    const value = parseRegisterInput(text);
    if (value !== null) this.svc.sim.setRegisterInput(name, value);
  }

  protected onEnter(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const sim = this.svc.sim;
    if (sim.waitingFor === 'ok') sim.confirm();
  }

  protected toggleFlag(name: FlagName): void {
    const sim = this.svc.sim;
    if (sim.inEditMode) sim.setFlagInput(name, sim.flags[name] ? 0 : 1);
  }

  protected onDragStart(event: DragEvent, name: RegName): void {
    this.dragValue = this.svc.sim.regs[name].value;
    event.dataTransfer?.setData('text/plain', String(this.dragValue));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  }

  protected onDragOver(event: DragEvent, name: RegName): void {
    if (this.isEditable(name)) event.preventDefault();
  }

  protected onDrop(event: DragEvent, name: RegName): void {
    event.preventDefault();
    const input = (event.currentTarget as HTMLElement).querySelector('input');
    const text = event.dataTransfer?.getData('text/plain') ?? '';
    const value = this.dragValue ?? Number.parseInt(text, 10);
    if (Number.isFinite(value)) {
      this.svc.sim.setRegisterInput(name, value);
      if (input) input.value = String(value);
    }
    this.dragValue = null;
  }
}
