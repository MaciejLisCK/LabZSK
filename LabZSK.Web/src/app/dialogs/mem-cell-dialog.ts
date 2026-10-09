import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { bin16, hex16, parseBin16, parseDec16, parseHex16 } from '../core/int16';
import {
  COMPLEX_OPS,
  CellType,
  SIMPLE_OPS,
  decodeComplex,
  decodeSimple,
  encodeComplex,
  encodeSimple,
  instructionDescription,
} from '../core/memory';
import { SimService } from '../sim.service';

type Base = 'bin' | 'dec' | 'hex';

/** Editing of a PAO cell – port of MemSubmit (data / simple instruction / complex instruction). */
@Component({
  selector: 'app-mem-cell-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="dialog wide">
      <form method="dialog" (submit)="ok($event)">
        <h2>PAO[{{ addr() }}]</h2>
        <div class="tabs" role="tablist">
          @for (t of tabs; track t.type) {
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="type() === t.type"
              [class.active]="type() === t.type"
              (click)="type.set(t.type)"
            >
              {{ t.label }}
            </button>
          }
        </div>

        @switch (type()) {
          @case (1) {
            <fieldset class="row">
              <legend>System liczbowy</legend>
              @for (b of bases; track b.id) {
                <label
                  ><input type="radio" name="base" [checked]="base() === b.id" (change)="changeBase(b.id)" />
                  {{ b.label }}</label
                >
              }
            </fieldset>
            <label class="field">
              <span>Wartość</span>
              <input
                #data
                [value]="dataText()"
                (input)="dataText.set(data.value)"
                autocomplete="off"
                spellcheck="false"
              />
            </label>
          }
          @case (2) {
            <label class="field">
              <span>OP</span>
              <select #op (change)="simple.set({ ...simple(), op: +op.value })">
                @for (m of simpleOps; track $index; let i = $index) {
                  @if (i > 0) {
                    <option [value]="i" [selected]="simple().op === i">{{ i }} – {{ m }} – {{ idesc(m) }}</option>
                  }
                }
              </select>
            </label>
            <fieldset class="row">
              <legend>Tryb adresowania</legend>
              <label
                ><input type="checkbox" [checked]="simple().x === 1" (change)="flip('x')" /> X =
                {{ simple().x }} (indeksowe)</label
              >
              <label
                ><input type="checkbox" [checked]="simple().s === 1" (change)="flip('s')" /> S =
                {{ simple().s }} (względne)</label
              >
              <label
                ><input type="checkbox" [checked]="simple().i === 1" (change)="flip('i')" /> I =
                {{ simple().i }} (pośrednie)</label
              >
            </fieldset>
            <label class="field">
              <span>DA (0–255)</span>
              <input
                #da
                type="number"
                min="0"
                max="255"
                [value]="simple().da"
                (input)="simple.set({ ...simple(), da: clamp(+da.value, 255) })"
              />
            </label>
          }
          @case (3) {
            <label class="field">
              <span>AOP</span>
              <select #aop (change)="complex.set({ ...complex(), aop: +aop.value })">
                @for (m of complexOps; track $index; let i = $index) {
                  <option [value]="i" [selected]="complex().aop === i">{{ i }} – {{ m }} – {{ idesc(m) }}</option>
                }
              </select>
            </label>
            <label class="field">
              <span>N (0–127)</span>
              <input
                #n
                type="number"
                min="0"
                max="127"
                [value]="complex().n"
                (input)="complex.set({ ...complex(), n: clamp(+n.value, 127) })"
              />
            </label>
          }
          @default {
            <p class="hint">Komórka zostanie wyczyszczona.</p>
          }
        }

        <p class="preview" aria-live="polite">
          @if (word() === null) {
            <span class="error">✗ Niepoprawna wartość (zakres 16 bitów: −32768…32767 / 0…FFFFh)</span>
          } @else if (type() !== 0) {
            {{ bin(word()!) }}b &nbsp; {{ hex(word()!) }}h &nbsp; {{ word() }}d
          }
        </p>
        <div class="actions">
          <button type="button" (click)="dlg.close()">Anuluj</button>
          <button type="submit" class="primary" [disabled]="word() === null">Zatwierdź</button>
        </div>
      </form>
    </dialog>
  `,
})
export class MemCellDialog {
  private readonly svc = inject(SimService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly tabs = [
    { type: CellType.Data, label: 'Dana' },
    { type: CellType.Simple, label: 'Rozkaz zwykły' },
    { type: CellType.Complex, label: 'Rozkaz rozszerzony' },
    { type: CellType.Empty, label: 'Pusta' },
  ];
  protected readonly bases: { id: Base; label: string }[] = [
    { id: 'bin', label: 'binarnie' },
    { id: 'dec', label: 'dziesiętnie' },
    { id: 'hex', label: 'szesnastkowo' },
  ];
  protected readonly simpleOps = SIMPLE_OPS;
  protected readonly complexOps = COMPLEX_OPS;
  protected readonly idesc = instructionDescription;
  protected readonly bin = bin16;
  protected readonly hex = (v: number) => hex16(v).padStart(4, '0');
  protected readonly addr = signal(0);
  protected readonly type = signal<CellType>(CellType.Data);
  protected readonly base = signal<Base>('dec');
  protected readonly dataText = signal('');
  protected readonly simple = signal({ op: 1, x: 0, s: 0, i: 0, da: 0 });
  protected readonly complex = signal({ aop: 0, n: 0 });

  protected readonly word = computed<number | null>(() => {
    switch (this.type()) {
      case CellType.Data: {
        const t = this.dataText().trim();
        if (t === '') return null;
        return this.base() === 'bin' ? parseBin16(t) : this.base() === 'dec' ? parseDec16(t) : parseHex16(t);
      }
      case CellType.Simple:
        return encodeSimple(this.simple());
      case CellType.Complex:
        return encodeComplex(this.complex());
      default:
        return 0;
    }
  });

  open(addr: number): void {
    const cell = this.svc.sim.pao[addr];
    this.addr.set(addr);
    this.type.set(cell.type === CellType.Empty ? CellType.Data : cell.type);
    this.base.set('dec');
    this.dataText.set(cell.type === CellType.Empty ? '' : String(cell.word));
    const s = decodeSimple(cell.word);
    this.simple.set(cell.type === CellType.Simple ? s : { op: 1, x: 0, s: 0, i: 0, da: 0 });
    this.complex.set(cell.type === CellType.Complex ? decodeComplex(cell.word) : { aop: 0, n: 0 });
    this.dlg().nativeElement.showModal();
  }

  protected clamp(v: number, max: number): number {
    return Number.isFinite(v) ? Math.min(max, Math.max(0, Math.trunc(v))) : 0;
  }

  protected flip(k: 'x' | 's' | 'i'): void {
    const s = this.simple();
    this.simple.set({ ...s, [k]: s[k] ? 0 : 1 });
  }

  /** Converts the typed value when the numeral base changes (MemSubmit radio buttons). */
  protected changeBase(b: Base): void {
    const w = this.word();
    this.base.set(b);
    if (w !== null) this.dataText.set(b === 'bin' ? bin16(w) : b === 'dec' ? String(w) : hex16(w));
  }

  protected ok(event: Event): void {
    event.preventDefault();
    const w = this.word();
    if (w === null) return;
    this.svc.editPao(this.addr(), { word: this.type() === CellType.Empty ? 0 : w, type: this.type() });
    this.dlg().nativeElement.close();
  }
}
