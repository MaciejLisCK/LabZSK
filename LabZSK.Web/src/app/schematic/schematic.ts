import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject } from '@angular/core';
import { hex16, parseRegisterInput } from '../core/int16';
import { FLAG_NAMES, FlagName, NON_EDITABLE, RegName } from '../core/registers';
import { Flow } from '../core/simulator';
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

type Seg = { key: string; d: string };

/** Bus lines – port of Drawings.drawSkin. Every segment has a key used to highlight the active transfer. */
function busPaths(cea: boolean): { thick: Seg[]; thin: Seg[]; fill: Seg[] } {
  const bus = cy(P.BUS);
  const top = 8;
  const left = 25;
  const thick: Seg[] = [
    { key: 'trunk:bus', d: `M ${cx(P.BUS)} ${bus} H ${W}` },
    ...(['RR', 'LR', 'RI'] as const).map((r) => ({
      key: `stub:${r}`,
      d: `M ${cx(P[r])} ${bus} V ${cy(P[r])}`,
    })),
    { key: 'trunk:left', d: `M ${left} ${H} V ${top} H ${W}` },
    ...(['LK', 'A', 'MQ', 'X'] as const).map((r) => ({
      key: `stub:${r}`,
      d: `M ${cx(P[r])} ${top} V ${cy(P[r])}`,
    })),
    ...(['RAP', 'RBP', 'BUS'] as const).map((r) => ({
      key: `stub:${r}`,
      d: `M ${left} ${cy(P[r])} H ${P[r].x + 10}`,
    })),
    { key: 'A>LALU', d: `M ${cx(P.A)} ${cy(P.A)} V ${cy(P.LALU)}` },
    { key: 'stub:ALU', d: `M ${cx(P.ALU)} ${cy(P.ALU)} V ${bus}` },
  ];
  const gap = (P.RALU.y - P.X.y) / 2;
  thick.push({
    key: 'X>RALU',
    d: `M ${cx(P.RALU)} ${cy(P.RALU)} V ${cy(P.RALU) - gap} H ${cx(P.X)} V ${cy(P.X)}`,
  });
  const trapezoid = (from: Box, to: Box) =>
    `M ${from.x} ${from.y + BH} H ${from.x + BW} L ${to.x + BW} ${to.y} H ${to.x} Z`;
  const fill: Seg[] = [
    { key: 'LALU>ALU', d: trapezoid(P.LALU, P.ALU) },
    { key: 'RALU>ALU', d: trapezoid(P.RALU, P.ALU) },
  ];
  if (cea) {
    thick.push({ key: 'RR>L', d: `M ${cx(P.RR)} ${cy(P.RR)} V ${cy(P.L)} H ${P.L.x + BH / 2}` });
    thick.push({ key: 'RI>R', d: `M ${cx(P.RI)} ${cy(P.RI)} V ${cy(P.R)} H ${cx(P.R)}` });
    thick.push({ key: 'LR>R', d: `M ${cx(P.LR)} ${cy(P.LR)} V ${cy(P.R)} H ${cx(P.R)}` });
    fill.push({ key: 'L>SUMA', d: trapezoid(P.L, P.SUMA) }, { key: 'R>SUMA', d: trapezoid(P.R, P.SUMA) });
    thick.push({
      key: 'SUMA>RAE',
      d: `M ${cx(P.SUMA)} ${cy(P.SUMA)} V ${P.SUMA.y + BH - 6} H ${RAE_CEA.x}`,
    });
  } else {
    thick.push({
      key: 'stub:RAE',
      d: `M ${cx(P.RAE)} ${cy(P.RAE)} V ${cy(P.RAE) + (H - P.RAE.y) / 2} H ${left}`,
    });
  }
  return { thick, thin: [{ key: 'A-MQ', d: `M ${cx(P.A)} ${cy(P.A)} H ${cx(P.MQ)}` }], fill };
}

/** Segments joining a register with the BUS register (both bus lines meet in the BUS box). */
function busRoute(reg: string): string[] {
  if (['RR', 'LR', 'RI', 'ALU'].includes(reg)) return [`stub:${reg}`, 'trunk:bus'];
  if (['LK', 'A', 'MQ', 'X', 'RAP', 'RBP', 'RAE'].includes(reg)) return [`stub:${reg}`, 'trunk:left', 'stub:BUS'];
  return [];
}

/** Keys of the segments used by a transfer: a direct link if there is one, otherwise the bus. */
function flowSegments(flow: Flow, all: ReadonlySet<string>): Set<string> {
  const keys = new Set<string>();
  for (const from of flow.from) {
    if (from === flow.to) continue;
    const direct = `${from}>${flow.to}`;
    if (all.has(direct)) keys.add(direct);
    else if (from === 'BUS') busRoute(flow.to).forEach((k) => keys.add(k));
    else if (flow.to === 'BUS') busRoute(from).forEach((k) => keys.add(k));
  }
  return keys;
}

const pct = (v: number, total: number) => `${(v / total) * 100}%`;

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
  protected readonly captionStyle = {
    left: pct(50, W),
    top: pct(384, H),
    width: pct(230, W),
    height: pct(BH, H),
  };
  protected readonly cea = computed(() => {
    this.svc.version();
    return this.svc.sim.ceaLayout;
  });
  protected readonly paths = computed(() => busPaths(this.cea()));
  protected readonly regNames = computed(() => (this.cea() ? CEA_REGS : NORMAL_REGS));
  /** Transfer of the current micro-operation: highlighted segments, source and target registers. */
  protected readonly flow = computed(() => {
    this.svc.version();
    const flow = this.svc.sim.flow;
    if (!flow) return null;
    const p = this.paths();
    const all = new Set([...p.thick, ...p.thin, ...p.fill].map((s) => s.key));
    return {
      segments: flowSegments(flow, all),
      from: new Set(flow.from),
      to: flow.to,
      text: `${flow.op}: ${flow.from.length ? flow.from.join(', ') : 'stała'} → ${flow.to}`,
    };
  });
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

  /** Role of a register in the current transfer – shown as a text tag, not only as a colour. */
  protected flowRole(name: string): string {
    const f = this.flow();
    if (!f) return '';
    const src = f.from.has(name);
    const dst = f.to === name;
    return src && dst ? 'źródło i cel' : src ? 'źródło' : dst ? 'cel' : '';
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
