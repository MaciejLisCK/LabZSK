import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { COL, PM_COLUMNS, isShiftOp, microOpDescription, optionsFor } from '../core/microcode';
import { SimService } from '../sim.service';

/** Choice of a microoperation for a PM cell – port of PMSubmit. */
@Component({
  selector: 'app-pm-cell-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="dialog" (cancel)="onCancel($event)" (close)="closed()">
      <form method="dialog" (submit)="ok($event)">
        <h2>PM[{{ row() }}] – {{ title() }}</h2>
        @if (isNa()) {
          <label class="field">
            <span>Adres następnej mikroinstrukcji (0 ≤ NA ≤ 255)</span>
            <input #na type="number" min="0" max="255" [value]="value()" (input)="value.set(na.value)" autofocus />
          </label>
        } @else if (options().length === 0) {
          <p class="hint">Pole {{ title() }} jest niedostępne, gdy w C1 jest SHT.</p>
        } @else {
          <div class="options" role="radiogroup" [attr.aria-label]="title()">
            @if (!required()) {
              <label class="opt">
                <input
                  type="radio"
                  name="op"
                  value=""
                  [checked]="value() === ''"
                  (change)="value.set('')"
                  (dblclick)="ok()"
                />
                <b>—</b><span>(puste)</span>
              </label>
            }
            @for (o of options(); track o) {
              <label class="opt">
                <input
                  type="radio"
                  name="op"
                  [value]="o"
                  [checked]="value() === o"
                  (change)="value.set(o)"
                  (dblclick)="ok()"
                />
                <b>{{ o }}</b
                ><span>{{ describe(o) }}</span>
              </label>
            }
          </div>
        }
        <div class="actions">
          @if (!required()) {
            <button type="button" (click)="dlg.close()">Anuluj</button>
          }
          <button type="submit" class="primary">Zatwierdź</button>
        </div>
      </form>
    </dialog>
  `,
})
export class PmCellDialog {
  private readonly svc = inject(SimService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly row = signal(0);
  protected readonly col = signal(1);
  protected readonly value = signal('');
  protected readonly options = signal<readonly string[]>([]);
  protected readonly required = signal(false);
  protected readonly title = signal('');
  protected readonly isNa = signal(false);
  protected readonly describe = microOpDescription;

  open(row: number, col: number): void {
    const r = this.svc.sim.pm[row];
    const { options, required } = optionsFor(col, r);
    this.row.set(row);
    this.col.set(col);
    this.title.set(PM_COLUMNS[col]);
    this.isNa.set(col === COL.NA);
    this.options.set(options);
    this.required.set(required);
    this.value.set(required && !options.includes(r[col]) ? options[0] : r[col]);
    this.dlg().nativeElement.showModal();
    setTimeout(() =>
      this.dlg().nativeElement.querySelector<HTMLInputElement>('input:checked, input[type=number]')?.focus(),
    );
  }

  protected onCancel(event: Event): void {
    if (this.required()) event.preventDefault();
  }

  protected closed(): void {}

  protected ok(event?: Event): void {
    event?.preventDefault();
    const row = this.row();
    const col = this.col();
    const value = this.value();
    this.dlg().nativeElement.close();
    if (this.options().length === 0 && !this.isNa()) return;
    this.svc.editPm(row, col, value);
    // SHT requires a shift operation in D2 (PMView.NewMicroOperation).
    if (col === COL.C1 && value === 'SHT' && !isShiftOp(this.svc.sim.pm[row][COL.D2]))
      setTimeout(() => this.open(row, COL.D2));
  }
}
