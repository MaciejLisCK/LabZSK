import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { REGISTER_NAMES, RegName } from '../core/registers';
import { SimService } from '../sim.service';

/** Developer console (Simulation/DevConsole.cs): runs cycles automatically until a condition holds. */
@Component({
  selector: 'app-auto-run-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="dialog">
      <form method="dialog" (submit)="ok($event)">
        <h2>Konsola deweloperska</h2>
        <p class="hint">Symulator sam wpisuje poprawne wartości. Przebieg jest oznaczony w logu jako AUTO.</p>
        <div class="grid2">
          <label class="field">
            <span>Warunek stopu</span>
            <select #r (change)="target.set($any(r.value))">
              <option value="cycles" [selected]="target() === 'cycles'">Cykle+&gt; (liczba cykli)</option>
              @for (n of names; track n) {
                <option [value]="n" [selected]="target() === n">{{ n }} =</option>
              }
            </select>
          </label>
          <label class="field">
            <span>Wartość</span>
            <input #v type="number" [value]="value()" (input)="value.set(+v.value)" />
          </label>
        </div>
        <div class="actions">
          <button type="button" (click)="dlg.close()">Anuluj</button>
          <button type="submit" class="primary">Start</button>
        </div>
      </form>
    </dialog>
  `,
})
export class AutoRunDialog {
  private readonly svc = inject(SimService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly names = REGISTER_NAMES;
  protected readonly target = signal<RegName | 'cycles'>('cycles');
  protected readonly value = signal(1);

  open(): void {
    this.dlg().nativeElement.showModal();
  }

  /** DevConsole.validateValue – limits the value to the register width. */
  private normalized(): number {
    let v = Math.trunc(this.value()) || 0;
    const t = this.target();
    if (t === 'RAPS' || t === 'RAP' || t === 'L' || t === 'R' || t === 'SUMA') v = Math.min(Math.abs(v), 255);
    else if (t === 'LK') v = Math.min(Math.abs(v), 127);
    else if (t === 'cycles') v = Math.min(Math.abs(v), 250);
    else v = ((v % 0xffff) << 16) >> 16;
    return v;
  }

  protected ok(event: Event): void {
    event.preventDefault();
    this.dlg().nativeElement.close();
    this.svc.start(false, { register: this.target(), value: this.normalized() });
  }
}
